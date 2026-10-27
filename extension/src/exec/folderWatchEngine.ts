import * as vscode from "vscode";
import * as path from "path";

import {
  FolderWatch,
  FolderSnapshot,
  FolderWatchDelta,
  FolderWatchStore,
  diffSnapshots,
  isEmptyDelta,
  watchAlertsIn,
  watchKind,
  watchDisplayName,
} from "../model/folderWatch";

import { scanFolderTarget, scanRepoTarget, repoPollIntervalMs } from "./folderWatchScan";
import { toastFolderDelta, toastRepoItems } from "./folderWatchToast";
import { l10n } from "../i18n/l10n";
import { repoIssuesUrl } from "../github/githubClient";
import { GitHubWatchItem } from "../github/githubTypes";

// Engine for the folder/file watches (PLAN_FILE_AND_FOLDER_WATCH). Two jobs:
//   1. On startup, scan each enabled watch and diff it against the cached baseline,
//      so files written while the window was closed are surfaced the moment it
//      opens (the explicit "must be on startup" requirement).
//   2. While the window is open, a FileSystemWatcher per watch reacts to new/
//      changed files and toasts the delta live.
// Both paths funnel through the same scan -> diff -> toast -> re-cache routine, so
// there is one definition of "what changed" and the baseline stays authoritative
// for the next startup. Disposable so every watcher and timer is torn down on
// deactivation (a leaked FileSystemWatcher survives a reload and double-fires).

// Delay before the startup scan runs, so it lands after activation completes rather
// than competing with it for IO. Short enough that a closed-window arrival is
// surfaced promptly once the window is up.
const STARTUP_SCAN_DELAY_MS = 1500;

// Coalesce a burst of filesystem events into one rescan. A single save or a
// multi-file write (a report generator, a git operation) touches the tree several
// times in quick succession; 500 ms absorbs the burst while still feeling prompt.
const DEBOUNCE_MS = 500;

interface ArmedWatch {
  watcher: vscode.FileSystemWatcher;
  debounce?: NodeJS.Timeout;
}

// Runs both halves of the folder/file watch feature: the deferred startup scan that
// surfaces changes made while the window was closed, and the live FileSystemWatcher
// per enabled watch while it stays open. Disposable so every watcher and pending
// timer is torn down on deactivation.
export class FolderWatchEngine implements vscode.Disposable {
  // Live watchers keyed by watch id, so a store change re-arms only what changed.
  private readonly armed = new Map<string, ArmedWatch>();
  private readonly storeSub: vscode.Disposable;
  private readonly folderSub: vscode.Disposable;
  private startupTimer?: NodeJS.Timeout;
  private repoPollTimer?: NodeJS.Timeout;
  private disposed = false;

  // Last-fetched items for each repo watch, keyed by watch id. FolderSnapshot only
  // stores key->timestamp (for diffSnapshots), which loses the title/URL a toast or
  // a row click needs — this cache is where that detail lives between scans. In
  // memory only: a stale/empty cache after a reload just falls back to the repo's
  // issues page (see repoIssuesUrl), never a crash.
  private readonly repoItemsCache = new Map<string, GitHubWatchItem[]>();

  // Repo watch ids with a seed fetch currently in flight — see seedRepoWatchIfNew.
  private readonly seedingRepoIds = new Set<string>();

  constructor(
    private readonly store: FolderWatchStore,
    private readonly output: vscode.OutputChannel
  ) {
    // Re-arm live watchers whenever the watch list changes (add/remove/toggle).
    this.storeSub = store.onDidChange(() => this.reconcileWatchers());
    // The set of projects open in this window decides which watches alert here
    // (watchAlertsIn). When a folder is added/removed, a watch can move in or out
    // of scope, so rescan: this re-arms live watchers AND surfaces files that landed
    // in a newly-in-scope watch while it was not being watched here.
    this.folderSub = vscode.workspace.onDidChangeWorkspaceFolders(() => {
      if (!this.disposed) {
        void this.scanAllEnabled();
      }
    });
    this.scheduleRepoPoll();
  }

  // The items fetched for a repo watch on its most recent scan (this session only),
  // used by the row-click open action to deep-link to the newest unseen item.
  getCachedRepoItems(watchId: string): GitHubWatchItem[] {
    return this.repoItemsCache.get(watchId) ?? [];
  }

  // Re-arms itself after every tick (rather than setInterval) so a config edit
  // changes the cadence starting from the NEXT tick instead of only after the
  // current interval finishes.
  private scheduleRepoPoll(): void {
    if (this.disposed) {
      return;
    }
    this.repoPollTimer = setTimeout(() => {
      // pollAllRepoWatches() itself never throws (see below), but wrap the call
      // too: a rejection reaching `finally` would still surface as an unhandled
      // promise rejection (finally re-throws, it doesn't swallow), which would
      // silently break the self-rescheduling chain — the timer is only re-armed
      // in `finally`, so one unlogged failure would stop polling forever.
      void this.pollAllRepoWatches()
        .catch((err) => {
          this.output.appendLine(
            l10n("github.pollError", {
              error: err instanceof Error ? err.message : String(err),
            })
          );
        })
        .finally(() => this.scheduleRepoPoll());
    }, repoPollIntervalMs());
  }

  private async pollAllRepoWatches(): Promise<void> {
    const folders = this.folderPaths();
    const due = this.store
      .list()
      .filter(
        (watch) =>
          !this.disposed &&
          watchKind(watch) === "repo" &&
          watch.enabled &&
          watchAlertsIn(watch, folders)
      );
    // Each repo watch's scan is a fully independent fetch (separate API base URL,
    // its own id-keyed baseline/cache entries) — run them concurrently rather than
    // one full poll-and-diff cycle at a time, so N watched repos cost one round
    // trip's latency instead of N. scanAndReport already catches and logs its own
    // scan errors (per-watch, via this.output), so one repo's failure never aborts
    // the others, with or without Promise.all.
    await Promise.all(due.map((watch) => this.scanAndReport(watch, false)));
  }

  // The current window's workspace folders as fsPaths — the input to the per-project
  // alert gate. Empty in a window with no folder open.
  private folderPaths(): string[] {
    return (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);
  }

  // Arm a deferred startup scan: seeds a baseline silently the first time a watch is
  // seen, and diffs against the cache on every subsequent open so files written
  // while the window was closed surface now. Deferred via a timer so it never does
  // file IO in the activation path; the live watchers are armed once the scan ends.
  runStartupScan(): void {
    if (this.disposed) {
      return;
    }
    this.startupTimer = setTimeout(() => {
      this.startupTimer = undefined;
      void this.scanAllEnabled();
    }, STARTUP_SCAN_DELAY_MS);
  }

  private async scanAllEnabled(): Promise<void> {
    const folders = this.folderPaths();
    for (const watch of this.store.list()) {
      // Skip watches not opted into this project — they alert in their own
      // window(s), never here (the "blasted every project" fix).
      if (!watch.enabled || this.disposed || !watchAlertsIn(watch, folders)) {
        continue;
      }
      await this.scanAndReport(watch, true);
    }
    this.reconcileWatchers();
  }

  // Arm a live FileSystemWatcher for every enabled folder watch and drop watchers
  // for watches that were removed or disabled. A repo watch has no live event
  // source (see repoPollTimer) — it only needs its baseline seeded on first sight,
  // which seedRepoWatchIfNew handles without creating a FileSystemWatcher.
  // Idempotent, so it is safe to call on every store change and once after the
  // startup scan.
  private reconcileWatchers(): void {
    if (this.disposed) {
      return;
    }
    // Only arm live watchers for watches enabled AND opted into this project; an
    // out-of-scope watch must do nothing in this window (no scan, no toast).
    const folders = this.folderPaths();
    const enabled = new Map(
      this.store
        .list()
        .filter((w) => w.enabled && watchAlertsIn(w, folders))
        .map((w) => [w.id, w])
    );
    // Drop watchers no longer wanted.
    for (const [id, armed] of this.armed) {
      if (!enabled.has(id)) {
        this.disarm(id, armed);
      }
    }
    // Drop repo-watch item caches no longer wanted. A repo watch never enters
    // `this.armed` (no FileSystemWatcher — see the seed/arm split below), so the
    // disarm() loop above can never reach it; without this, removing, disabling, or
    // scoping a repo watch out of this window left its cached issue/PR titles+URLs
    // in `repoItemsCache` for the rest of the extension host's session — the exact
    // leak this method's folder-watch half already prevents via disarm().
    for (const id of this.repoItemsCache.keys()) {
      const watch = enabled.get(id);
      if (!watch || watchKind(watch) !== "repo") {
        this.repoItemsCache.delete(id);
      }
    }
    // Arm watchers (or seed baselines) newly wanted.
    for (const [id, watch] of enabled) {
      if (watchKind(watch) === "repo") {
        this.seedRepoWatchIfNew(watch);
      } else if (!this.armed.has(id)) {
        this.arm(watch);
      }
    }
  }

  // Mirrors the tail of arm(): a repo watch added mid-session has no cached
  // baseline yet, so seed it silently on first sight rather than waiting for the
  // next poll tick to announce every currently-open issue/PR as new.
  //
  // `seedingRepoIds` guards against a re-entrant duplicate: reconcileWatchers()
  // (which calls this) reruns on every store change, but the seed fetch it
  // triggers is async and only writes the baseline (the signal this checks) once
  // it resolves. Two store mutations landing back-to-back while a watch's first
  // seed is still in flight — e.g. adding two repo watches at once, or a quick
  // enable/disable toggle — would otherwise each see "no baseline yet" and fire
  // their own concurrent fetch pair for the same repo.
  private seedRepoWatchIfNew(watch: FolderWatch): void {
    if (this.store.getBaseline(watch.id) === undefined && !this.seedingRepoIds.has(watch.id)) {
      this.seedingRepoIds.add(watch.id);
      void this.scanAndReport(watch, false).finally(() =>
        this.seedingRepoIds.delete(watch.id)
      );
    }
  }

  private arm(watch: FolderWatch): void {
    const targetUri = vscode.Uri.file(watch.target);
    // A folder watch globs within the folder; a file watch pins to the single
    // basename in its parent directory. RelativePattern receives .git-excluded
    // events too (the global files.watcherExclude governs only the default
    // watcher), which is why an explicit watch can still see those paths.
    const pattern = watch.isFile
      ? new vscode.RelativePattern(
          vscode.Uri.file(path.dirname(watch.target)),
          path.basename(watch.target)
        )
      : new vscode.RelativePattern(targetUri, watch.glob ?? "**/*");
    const watcher = vscode.workspace.createFileSystemWatcher(pattern);
    const armed: ArmedWatch = { watcher };
    const onEvent = (): void => this.schedule(watch.id);
    watcher.onDidCreate(onEvent);
    watcher.onDidChange(onEvent);
    // A delete shifts the baseline (so a re-created file reads as new again);
    // rescan on delete to keep the cache honest, but the rescan toasts nothing for
    // a pure removal because diffSnapshots never reports deletions.
    watcher.onDidDelete(onEvent);
    this.armed.set(watch.id, armed);

    // A watch added mid-session has no cached baseline yet (only the startup scan
    // seeds, and it ran before this watch existed). Seed it now so the FIRST file
    // that lands after the watch is created is detected — without this, that first
    // arrival would be consumed silently to establish the baseline. scanAndReport
    // seeds without toasting when there is no baseline, so this announces nothing.
    if (this.store.getBaseline(watch.id) === undefined) {
      void this.scanAndReport(watch, false);
    }
  }

  // Debounce a watch's events, then rescan-and-report. Re-reads the watch from the
  // store at fire time so a label/mode edit between the event and the fire is honored.
  private schedule(id: string): void {
    const armed = this.armed.get(id);
    if (!armed) {
      return;
    }
    if (armed.debounce) {
      clearTimeout(armed.debounce);
    }
    armed.debounce = setTimeout(() => {
      armed.debounce = undefined;
      const watch = this.store.find(id);
      if (
        watch &&
        watch.enabled &&
        !this.disposed &&
        watchAlertsIn(watch, this.folderPaths())
      ) {
        void this.scanAndReport(watch, false);
      }
    }, DEBOUNCE_MS);
  }

  // Scan the target, diff against the cached baseline, toast the delta, and re-cache.
  // `isStartup` only changes the wording of the toast (closed-window arrivals vs a
  // live change); the seed-silently-on-first-scan behavior applies to both so a
  // brand-new watch never announces its entire existing contents.
  private async scanAndReport(
    watch: FolderWatch,
    isStartup: boolean
  ): Promise<void> {
    let current: FolderSnapshot;
    try {
      current = await this.scanTarget(watch);
    } catch (err) {
      // An unreadable/removed target is logged, not toasted: a watch whose folder
      // was deleted must not nag on every event. The baseline is left intact so the
      // folder reappearing diffs against what was last seen.
      this.output.appendLine(
        l10n("folderWatch.scanError", {
          label: this.nameOf(watch),
          error: err instanceof Error ? err.message : String(err),
        })
      );
      return;
    }

    const baseline = this.store.getBaseline(watch.id);
    if (baseline === undefined) {
      // First time this watch is scanned: remember the contents as the baseline
      // without announcing them. Diffing against an empty baseline would report
      // every existing file as "new".
      await this.store.setBaseline(watch.id, current);
      return;
    }

    const delta = diffSnapshots(baseline, current, watch.mode);
    await this.store.setBaseline(watch.id, current);
    if (!isEmptyDelta(delta)) {
      // Record the detected files as unseen — this drives the per-row counter and
      // the activity-bar total until the user opens the watch — then toast the live
      // alert. The badge persists after the toast is dismissed; the toast is the
      // momentary nudge, the counter is the standing "you have N new files" cue.
      await this.store.addUnseen(watch.id, [...delta.added, ...delta.changed]);
      void this.toast(watch, delta, isStartup);
    }
  }

  private async scanTarget(watch: FolderWatch): Promise<FolderSnapshot> {
    if (watchKind(watch) === "repo") {
      const { snapshot, items } = await scanRepoTarget(watch);
      this.repoItemsCache.set(watch.id, items);
      return snapshot;
    }
    return scanFolderTarget(watch, this.output);
  }

  private async toast(
    watch: FolderWatch,
    delta: FolderWatchDelta,
    isStartup: boolean
  ): Promise<void> {
    if (watchKind(watch) === "repo") {
      // Repo watches name the new issues/PRs by title, from the fetched-items cache.
      await toastRepoItems(delta, this.repoItemsCache.get(watch.id) ?? [], this.nameOf(watch));
      return;
    }
    await toastFolderDelta(watch, delta, isStartup, this.nameOf(watch));
  }

  private nameOf(watch: FolderWatch): string {
    return watchDisplayName(watch);
  }

  private disarm(id: string, armed: ArmedWatch): void {
    if (armed.debounce) {
      clearTimeout(armed.debounce);
    }
    armed.watcher.dispose();
    this.armed.delete(id);
    // repoItemsCache cleanup for a removed/disabled/out-of-scope repo watch happens
    // in reconcileWatchers(), not here — a repo watch has no FileSystemWatcher, so
    // it never reaches disarm() (see reconcileWatchers's arm/seed split below).
  }

  dispose(): void {
    this.disposed = true;
    if (this.startupTimer) {
      clearTimeout(this.startupTimer);
    }
    if (this.repoPollTimer) {
      clearTimeout(this.repoPollTimer);
    }
    this.storeSub.dispose();
    this.folderSub.dispose();
    for (const [id, armed] of [...this.armed]) {
      this.disarm(id, armed);
    }
  }
}
