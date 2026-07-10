import * as vscode from "vscode";
import * as path from "path";

// Folder/file watches (PLAN_FILE_AND_FOLDER_WATCH): the user asks to be told when
// new files appear in a folder (e.g. "tell me when a new bug report lands in
// bugs/"), or when a specific file changes. Distinct from the cross-file watch
// LINKS in ShortcutExecConfig.runOnSaveGlobs, which RUN a shortcut on save — these
// only NOTIFY (a toast), carry no run, and crucially fire on STARTUP for files
// written while the window was closed. That startup capability is the whole reason
// a baseline snapshot is cached: without a remembered file list there is nothing to
// diff the current contents against when the window opens.

// What a watch reports:
//   - "new"     only files that appeared since the last snapshot (the common
//               "alert me to a new file" case).
//   - "changed" new files AND existing files whose modified-time advanced (also
//               covers the single-file "tell me when this file changes" case).
export type FolderWatchMode = "new" | "changed";

// One user-configured folder/file watch: what to watch, in which mode, and which
// projects it alerts in. Persisted verbatim in FolderWatchStore (globalState), read
// by the scan/diff engine and the Watches tree, and mutated via add/update/remove.
export interface FolderWatch {
  // Stable id, used as the live-watcher key and the baseline-cache key.
  id: string;
  // Absolute fsPath of the watched folder or file. Absolute (not workspace-
  // relative) because a watch may target a path outside any open folder, and a
  // global watch must resolve identically across windows.
  target: string;
  // Whether `target` is a single file (snapshot is just that file) or a folder
  // (snapshot is its contained files). Resolved once at add time so the engine
  // does not re-stat the target's type on every scan.
  isFile: boolean;
  // Display label; defaults to the target basename when absent.
  label?: string;
  // Optional glob (POSIX subset, see globMatch) matched against each contained
  // file's folder-relative forward-slashed path, e.g. "*.md" or "reports/**".
  // Folder watches only; absent means every contained file counts.
  glob?: string;
  mode: FolderWatchMode;
  // A disabled watch is kept (so its config and baseline survive) but neither
  // scanned on startup nor armed with a live watcher.
  enabled: boolean;
  // EXTRA projects this watch alerts in, beyond the project that owns its target, as
  // workspace-folder fsPaths. A watch is ALWAYS local to the project containing its
  // target ("projects watch their own"); alertScopes only adds further projects the
  // user opted in by hand (e.g. a watch on a folder outside any open project, shared
  // into a specific window). undefined and [] are equivalent (no extra projects) —
  // the containing project still alerts either way; to silence a watch entirely,
  // disable it. See watchAlertsIn for the full rule. The gate exists because the
  // watch list lives in window-independent globalState, so without it a single watch
  // toasted in EVERY open window — the "you blasted every project I am running"
  // report (2026-06-28).
  alertScopes?: string[];
  // A global watch alerts in EVERY project window, not just the one owning its
  // target. The deliberate cross-project case and the ONLY reason a watch appears
  // outside its own project; the Watches view marks it distinctly (a globe glyph and
  // a "global" note) so it is never mistaken for a local watch. Absent/false: local
  // to the project(s) that own or opted into it.
  global?: boolean;
}

// One scan result: each watched file's folder-relative path mapped to its
// last-modified time in epoch ms. The cached "watched file list" the plan calls
// for — diffing a fresh scan against the stored one is how new/changed files are
// found, on startup and live.
export type FolderSnapshot = Record<string, number>;

// What a diff turns up: files that are new since the baseline, and (for "changed"
// mode) existing files whose mtime advanced. Deletions are intentionally not
// reported — the feature alerts to arrivals and edits, not removals.
export interface FolderWatchDelta {
  added: string[];
  changed: string[];
}

// Pure diff of two snapshots. `added` = paths in current but not baseline.
// `changed` (mode "changed" only) = paths in both whose current mtime is strictly
// greater than the baseline mtime; "new" mode returns no changed entries. Both
// lists are sorted so the toast lists files deterministically. A first-ever scan
// (no baseline yet) is the ENGINE's concern, not this function's — it must seed the
// baseline silently rather than diff against an empty map and announce every file
// as new; this function faithfully reports everything-as-added for an empty
// baseline, which is exactly what the seed path must avoid calling it for.
export function diffSnapshots(
  baseline: FolderSnapshot,
  current: FolderSnapshot,
  mode: FolderWatchMode
): FolderWatchDelta {
  const added: string[] = [];
  const changed: string[] = [];
  for (const [path, mtime] of Object.entries(current)) {
    const prior = baseline[path];
    if (prior === undefined) {
      added.push(path);
    } else if (mode === "changed" && mtime > prior) {
      changed.push(path);
    }
  }
  added.sort();
  changed.sort();
  return { added, changed };
}

// True when the delta has anything worth toasting. Centralized so the engine and
// any future consumer agree on "is this delta empty".
export function isEmptyDelta(delta: FolderWatchDelta): boolean {
  return delta.added.length === 0 && delta.changed.length === 0;
}

// True when `target` is `folder` itself or nested under it. path.relative yields a
// "../"-prefixed or absolute result when target escapes folder; neither is inside.
// Centralized so the alert-scope rule and its materialization agree on containment.
export function isPathInside(folder: string, target: string): boolean {
  const rel = path.relative(folder, target);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

// True when the watch is marked global (alerts in every project window).
// Centralized so the alert gate, the row marking, and the make-global toggle agree.
export function isGlobalWatch(watch: FolderWatch): boolean {
  return watch.global === true;
}

// Whether a watch should raise alerts in a window holding `folderPaths` (the current
// workspace folders). The single source of truth for "does this watch fire here",
// shared by the engine (which gates scanning/arming) and the Watches tree (which
// decides whether to list the row at all). The rule, in order:
//   1. A global watch alerts everywhere.
//   2. A project always watches files inside its own folders — automatic, regardless
//      of alertScopes. This is "projects watch their own": a watch on a project's own
//      bugs/ folder can never read as "not alerting" in that project.
//   3. Otherwise it alerts only in projects the user explicitly opted in
//      (alertScopes) — a watch whose target lives outside the opened project(s).
export function watchAlertsIn(
  watch: FolderWatch,
  folderPaths: string[]
): boolean {
  if (isGlobalWatch(watch)) {
    return true;
  }
  if (folderPaths.some((p) => isPathInside(p, watch.target))) {
    return true;
  }
  return (watch.alertScopes ?? []).some((p) => folderPaths.includes(p));
}

const WATCHES_KEY = "saropaWorkspace.folderWatches";
const BASELINES_KEY = "saropaWorkspace.folderWatchBaselines";
const UNSEEN_KEY = "saropaWorkspace.folderWatchUnseen";

// Persisted store for the watch list and the cached baselines. Both live in
// globalState: a watch on an absolute path is window-independent, and the baseline
// IS the cache that makes startup detection possible. The two are separate keys so
// reading the (small) watch list never deserializes the (potentially large)
// baselines, and a cleared baseline does not rewrite the watch list.
export class FolderWatchStore {
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  // Fires when the watch LIST changes (add/remove/update/toggle) so the engine
  // re-arms its live watchers. Baseline writes do not fire it — they happen
  // constantly during scanning and must not thrash the watcher reconciliation.
  readonly onDidChange = this._onDidChange.event;

  private readonly _onDidChangeCounts = new vscode.EventEmitter<void>();
  // Fires when a watch's unseen-files count changes (new files detected, or a
  // watch opened/cleared). Separate from onDidChange so the unseen badge + tree
  // repaint without re-arming the engine's file watchers on every detected file.
  readonly onDidChangeCounts = this._onDidChangeCounts.event;

  constructor(private readonly context: vscode.ExtensionContext) {}

  list(): FolderWatch[] {
    const data = this.context.globalState.get<FolderWatch[]>(WATCHES_KEY, []);
    return Array.isArray(data) ? data : [];
  }

  find(id: string): FolderWatch | undefined {
    return this.list().find((w) => w.id === id);
  }

  // Add a watch. A re-add of the same target+mode is a no-op so the same folder
  // is not watched twice; returns the existing or newly stored watch either way.
  async add(watch: FolderWatch): Promise<FolderWatch> {
    const watches = this.list();
    const existing = watches.find(
      (w) => w.target === watch.target && w.mode === watch.mode
    );
    if (existing) {
      return existing;
    }
    await this.context.globalState.update(WATCHES_KEY, [...watches, watch]);
    this._onDidChange.fire();
    return watch;
  }

  async remove(id: string): Promise<void> {
    const watches = this.list();
    const next = watches.filter((w) => w.id !== id);
    if (next.length === watches.length) {
      return;
    }
    await this.context.globalState.update(WATCHES_KEY, next);
    // Drop the orphaned baseline + unseen tally so a removed-then-readded watch
    // starts clean and the activity-bar total no longer counts it.
    await this.clearBaseline(id);
    await this.clearUnseen(id);
    this._onDidChange.fire();
  }

  async update(id: string, patch: Partial<FolderWatch>): Promise<void> {
    const watches = this.list();
    const at = watches.findIndex((w) => w.id === id);
    if (at === -1) {
      return;
    }
    const next = [...watches];
    next[at] = { ...next[at], ...patch, id };
    await this.context.globalState.update(WATCHES_KEY, next);
    this._onDidChange.fire();
  }

  private allBaselines(): Record<string, FolderSnapshot> {
    const data = this.context.globalState.get<Record<string, FolderSnapshot>>(
      BASELINES_KEY,
      {}
    );
    return data && typeof data === "object" ? data : {};
  }

  // The cached snapshot for a watch, or undefined when none has been recorded yet
  // (the signal the engine uses to seed silently on first scan instead of
  // announcing every existing file as new).
  getBaseline(id: string): FolderSnapshot | undefined {
    return this.allBaselines()[id];
  }

  async setBaseline(id: string, snapshot: FolderSnapshot): Promise<void> {
    await this.context.globalState.update(BASELINES_KEY, {
      ...this.allBaselines(),
      [id]: snapshot,
    });
  }

  private async clearBaseline(id: string): Promise<void> {
    const all = this.allBaselines();
    if (!(id in all)) {
      return;
    }
    const next = { ...all };
    delete next[id];
    await this.context.globalState.update(BASELINES_KEY, next);
  }

  // --- unseen-files tally (the per-watch counter + activity-bar total) ----------
  // The set of new/changed files detected for a watch that the user has not yet
  // looked at. Stored as deduped folder-relative paths (not just a count) so the
  // tree row can list them and opening the watch can act on them, and so a file
  // detected twice is not double-counted. Cleared when the user opens the watch.

  private allUnseen(): Record<string, string[]> {
    const data = this.context.globalState.get<Record<string, string[]>>(
      UNSEEN_KEY,
      {}
    );
    return data && typeof data === "object" ? data : {};
  }

  // The unseen paths recorded for a watch (empty when none / never detected).
  getUnseen(id: string): string[] {
    const list = this.allUnseen()[id];
    return Array.isArray(list) ? list : [];
  }

  // Number of unseen files for a watch — the per-row counter.
  unseenCount(id: string): number {
    return this.getUnseen(id).length;
  }

  // Sum of unseen files for the activity-bar badge. With `folderPaths` given, counts
  // only watches that alert in THIS window (owned-here, opted-in-here, or global), so
  // a window's badge never reflects another project's pending files — the badge form
  // of the "do not blast every project" rule. Without it, sums every watch (used by
  // store-level tests that do not model a window).
  totalUnseen(folderPaths?: string[]): number {
    const unseen = this.allUnseen();
    const inScope =
      folderPaths === undefined
        ? null
        : new Set(
            this.list()
              .filter((w) => watchAlertsIn(w, folderPaths))
              .map((w) => w.id)
          );
    return Object.entries(unseen).reduce((sum, [id, list]) => {
      if (inScope && !inScope.has(id)) {
        return sum;
      }
      return sum + (Array.isArray(list) ? list.length : 0);
    }, 0);
  }

  // Record newly detected files for a watch, merging and de-duplicating against
  // what is already unseen so a file that keeps changing is counted once until the
  // watch is opened. A no-op (no event) when every path is already recorded.
  async addUnseen(id: string, paths: string[]): Promise<void> {
    if (paths.length === 0) {
      return;
    }
    const all = this.allUnseen();
    const merged = new Set([...(all[id] ?? []), ...paths]);
    if (merged.size === (all[id]?.length ?? 0)) {
      return;
    }
    await this.context.globalState.update(UNSEEN_KEY, {
      ...all,
      [id]: [...merged].sort(),
    });
    this._onDidChangeCounts.fire();
  }

  // Clear a watch's unseen tally (the user opened it). A no-op when already empty,
  // so clicking an already-clear watch does not churn the badge.
  async clearUnseen(id: string): Promise<void> {
    const all = this.allUnseen();
    if (!(id in all)) {
      return;
    }
    const next = { ...all };
    delete next[id];
    await this.context.globalState.update(UNSEEN_KEY, next);
    this._onDidChangeCounts.fire();
  }
}
