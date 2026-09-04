import * as vscode from "vscode";
import * as path from "path";
import { promises as fs } from "fs";
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
  matchesRepoFilter,
} from "../model/folderWatch";
import { globToRegExp } from "./globMatch";
import { l10n } from "../i18n/l10n";
import { fetchOpenRepoItems, parseRepoSlug, repoIssuesUrl } from "../github/githubClient";
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

// Directories never worth crawling for a "new file" alert: VCS internals, package
// caches, and build output churn constantly and would bury a real new file in
// noise. Skipped during the recursive folder walk. A file watch (isFile) bypasses
// the walk entirely, so an explicit watch on a file inside one of these still works.
const SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  ".dart_tool",
  "build",
  "dist",
  "out",
  ".next",
  ".turbo",
  "coverage",
  "__pycache__",
  ".venv",
]);

// Hard ceiling on files captured per folder scan. A watch aimed at a huge tree
// would otherwise stat tens of thousands of files on every event; the cap keeps a
// misconfigured watch from stalling the window. Reaching it is logged once per
// scan, not toasted, so it never masquerades as a "new files" alert.
const MAX_FILES = 5000;

// How many filenames a toast lists before collapsing the rest into "+N more", so a
// burst of new files names the first few (UX: name the item) without an unbounded
// wall of text.
const MAX_LISTED = 5;

// Delay before the startup scan runs, so it lands after activation completes rather
// than competing with it for IO. Short enough that a closed-window arrival is
// surfaced promptly once the window is up.
const STARTUP_SCAN_DELAY_MS = 1500;

// Coalesce a burst of filesystem events into one rescan. A single save or a
// multi-file write (a report generator, a git operation) touches the tree several
// times in quick succession; 500 ms absorbs the burst while still feeling prompt.
const DEBOUNCE_MS = 500;

// A repo watch has no live filesystem event source, so it is polled on a fixed
// interval instead of arming a FileSystemWatcher. Read fresh from config on every
// tick (not cached at construction) so editing the setting takes effect on the next
// tick rather than requiring a reload.
function repoPollIntervalMs(): number {
  const minutes = vscode.workspace
    .getConfiguration("saropaWorkspace")
    .get<number>("github.pollIntervalMinutes", 5);
  return Math.max(1, minutes) * 60_000;
}

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
    for (const watch of this.store.list()) {
      if (
        this.disposed ||
        watchKind(watch) !== "repo" ||
        !watch.enabled ||
        !watchAlertsIn(watch, folders)
      ) {
        continue;
      }
      // scanAndReport already catches and logs its own scan errors (per-watch, via
      // this.output) so one repo's failure never aborts the rest of the poll pass.
      await this.scanAndReport(watch, false);
    }
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
  private seedRepoWatchIfNew(watch: FolderWatch): void {
    if (this.store.getBaseline(watch.id) === undefined) {
      void this.scanAndReport(watch, false);
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

  // Build the snapshot for a watch: a single-entry map for a file watch, a bounded
  // recursive walk for a folder watch (glob-filtered, heavy dirs skipped), or a
  // GitHub fetch for a repo watch.
  private async scanTarget(watch: FolderWatch): Promise<FolderSnapshot> {
    if (watchKind(watch) === "repo") {
      return this.scanRepoTarget(watch);
    }
    if (watch.isFile) {
      const stat = await fs.stat(watch.target);
      return { [path.basename(watch.target)]: stat.mtimeMs };
    }
    const snapshot: FolderSnapshot = {};
    const matcher = watch.glob ? this.compileGlob(watch.glob) : undefined;
    await this.walk(watch.target, watch.target, matcher, snapshot);
    return snapshot;
  }

  // Fetch a repo's open issues/PRs and build a snapshot keyed by item ("issue:123"
  // / "pr:45") mapped to its updated_at timestamp, so diffSnapshots reports newly-
  // opened items exactly like a newly-arrived file (mode is fixed at "new" for repo
  // watches — GitHub already has its own notion of "updated"; re-alerting on every
  // edit to an existing issue would be noise, not signal). The fetched items are
  // also cached (title/URL) for the toast and the row-click open action.
  private async scanRepoTarget(watch: FolderWatch): Promise<FolderSnapshot> {
    const slug = parseRepoSlug(watch.target);
    if (!slug) {
      throw new Error(`invalid repo slug: ${watch.target}`);
    }
    const fetched = await fetchOpenRepoItems(slug, false);
    // Filter BEFORE caching/snapshotting: a filtered-out item must never enter the
    // baseline or the toast cache, so it can neither trigger a toast now nor appear
    // via the row-click "open newest unseen" action later.
    const items = fetched.filter((item) => matchesRepoFilter(watch, item));
    this.repoItemsCache.set(watch.id, items);
    const snapshot: FolderSnapshot = {};
    for (const item of items) {
      snapshot[item.key] = Date.parse(item.updatedAt) || 0;
    }
    return snapshot;
  }

  // Recursive directory walk into `snapshot`, keyed by forward-slashed paths
  // relative to the watch root. Stops adding once MAX_FILES is reached.
  private async walk(
    root: string,
    dir: string,
    matcher: RegExp | undefined,
    snapshot: FolderSnapshot
  ): Promise<void> {
    if (Object.keys(snapshot).length >= MAX_FILES) {
      return;
    }
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (Object.keys(snapshot).length >= MAX_FILES) {
        this.output.appendLine(
          l10n("folderWatch.tooManyFiles", { max: MAX_FILES, dir: root })
        );
        return;
      }
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) {
          continue;
        }
        await this.walk(root, full, matcher, snapshot);
      } else if (entry.isFile()) {
        const rel = path.relative(root, full).split(path.sep).join("/");
        if (matcher && !matcher.test(rel)) {
          continue;
        }
        try {
          const stat = await fs.stat(full);
          snapshot[rel] = stat.mtimeMs;
        } catch {
          // A file that vanished between readdir and stat is simply skipped — it is
          // not part of the current contents, so it neither adds nor changes.
        }
      }
    }
  }

  // Compile the folder-relative glob once per scan. A malformed pattern compiles to
  // a never-match so one bad glob disables only that watch's filter, never throws.
  private compileGlob(glob: string): RegExp {
    try {
      return globToRegExp(glob);
    } catch {
      return /$.^/;
    }
  }

  private async toast(
    watch: FolderWatch,
    delta: FolderWatchDelta,
    isStartup: boolean
  ): Promise<void> {
    if (watchKind(watch) === "repo") {
      await this.toastRepo(watch, delta);
      return;
    }
    const label = this.nameOf(watch);
    // Ordered new-then-changed so the listed filenames line up with the split
    // counts the message states.
    const files = [...delta.added, ...delta.changed];
    const summary = this.formatFiles(files);
    const hasAdded = delta.added.length > 0;
    const hasChanged = delta.changed.length > 0;
    // Name new vs changed precisely rather than collapsing both into one
    // ambiguous "new or changed" verb: a batch that is purely edits must read as
    // "changed" (not "new"), and a mixed batch states each count so the reader
    // knows which files arrived vs which were edited. The startup variants add
    // the "while you were away" framing for closed-window arrivals.
    let message: string;
    if (hasAdded && hasChanged) {
      message = l10n(
        isStartup ? "folderWatch.mixedFilesStartup" : "folderWatch.mixedFiles",
        {
          added: delta.added.length,
          changed: delta.changed.length,
          label,
          files: summary,
        }
      );
    } else if (hasChanged) {
      message = l10n(
        isStartup
          ? "folderWatch.changedFilesStartup"
          : "folderWatch.changedFiles",
        { count: delta.changed.length, label, files: summary }
      );
    } else {
      message = l10n(
        isStartup ? "folderWatch.newFilesStartup" : "folderWatch.newFiles",
        { count: delta.added.length, label, files: summary }
      );
    }

    const open = l10n("folderWatch.open");
    const choice = await vscode.window.showInformationMessage(message, open);
    if (choice !== open) {
      return;
    }
    // Open the first changed/new file (folder watch) or the target itself (file
    // watch), so the action lands the user on the thing the toast named.
    const first = files[0];
    const toOpen = watch.isFile
      ? vscode.Uri.file(watch.target)
      : vscode.Uri.file(path.join(watch.target, first));
    try {
      await vscode.window.showTextDocument(toOpen, { preview: true });
    } catch {
      // A binary or unopenable file: reveal it in the Explorer instead of failing.
      await vscode.commands.executeCommand("revealInExplorer", toOpen);
    }
  }

  // Toast for a repo watch: names the new issues/PRs by title (not just a count,
  // matching the folder-watch toast's "name the item" convention) and opens the
  // newest one on GitHub. delta.added holds the composite keys ("issue:123");
  // delta.changed is always empty for a repo watch (mode is fixed to "new").
  private async toastRepo(watch: FolderWatch, delta: FolderWatchDelta): Promise<void> {
    const label = this.nameOf(watch);
    const items = this.repoItemsCache.get(watch.id) ?? [];
    const byKey = new Map(items.map((i) => [i.key, i]));
    const newItems = delta.added
      .map((key) => byKey.get(key))
      .filter((i): i is GitHubWatchItem => i !== undefined);
    if (newItems.length === 0) {
      return;
    }
    const issueCount = newItems.filter((i) => i.kind === "issue").length;
    const prCount = newItems.filter((i) => i.kind === "pr").length;
    const summary = this.formatItems(newItems);

    let message: string;
    if (issueCount > 0 && prCount > 0) {
      message = l10n("github.newMixed", {
        issues: issueCount,
        prs: prCount,
        label,
        items: summary,
      });
    } else if (prCount > 0) {
      message = l10n("github.newPrs", { count: prCount, label, items: summary });
    } else {
      message = l10n("github.newIssues", { count: issueCount, label, items: summary });
    }

    const open = l10n("folderWatch.open");
    const choice = await vscode.window.showInformationMessage(message, open);
    if (choice !== open) {
      return;
    }
    const target = newItems[newItems.length - 1];
    await vscode.env.openExternal(vscode.Uri.parse(target.htmlUrl));
  }

  // List up to MAX_LISTED item titles as "#N title", then "+N more", mirroring
  // formatFiles for the repo-watch toast.
  private formatItems(items: GitHubWatchItem[]): string {
    const shown = items.slice(0, MAX_LISTED).map((i) => `#${i.number} ${i.title}`);
    const extra = items.length - shown.length;
    return extra > 0
      ? l10n("folderWatch.fileListMore", { files: shown.join(", "), more: extra })
      : shown.join(", ");
  }

  // List up to MAX_LISTED filenames, then "+N more", so the toast names files
  // without an unbounded list. Basename only — the folder is already named.
  private formatFiles(files: string[]): string {
    const shown = files
      .slice(0, MAX_LISTED)
      .map((f) => f.split("/").pop() ?? f);
    const extra = files.length - shown.length;
    return extra > 0
      ? l10n("folderWatch.fileListMore", { files: shown.join(", "), more: extra })
      : shown.join(", ");
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
    // Clean up any cached repo items so a removed watch does not leak memory for
    // the rest of the extension host's lifetime.
    this.repoItemsCache.delete(id);
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
