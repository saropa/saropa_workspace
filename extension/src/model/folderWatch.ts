import * as vscode from "vscode";
import * as path from "path";
import { FolderWatch, FolderSnapshot, watchKind, watchAlertsIn } from "./folderWatchModel";

export * from "./folderWatchModel";

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
  // A repo watch's target ("owner/repo") is compared case-insensitively — GitHub
  // slugs are case-insensitive, so "Facebook/react" and "facebook/REACT" are the
  // same target — while a folder watch's target (a filesystem path) stays an exact
  // match, since case sensitivity there is platform-dependent and this store must
  // not assume a case-insensitive filesystem. This is the store-level backstop for
  // the same rule the add/edit repo-watch command flows already enforce up front;
  // enforcing it here too means any OTHER path that calls add() directly (a future
  // import or sync feature, say) cannot silently reintroduce a case-duplicate.
  async add(watch: FolderWatch): Promise<FolderWatch> {
    const watches = this.list();
    const isRepo = watchKind(watch) === "repo";
    const existing = watches.find(
      (w) =>
        w.mode === watch.mode &&
        (isRepo && watchKind(w) === "repo"
          ? w.target.toLowerCase() === watch.target.toLowerCase()
          : w.target === watch.target)
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

  // Public (unlike the rest of the baseline internals) because editing a repo
  // watch's target needs to drop the old target's baseline too — the cached
  // "issue:123" keys belong to the repo that was just replaced, and diffing the new
  // repo's items against them would read every existing open item as unrelated
  // noise instead of seeding cleanly. Mirrors what `remove` already does.
  async clearBaseline(id: string): Promise<void> {
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
