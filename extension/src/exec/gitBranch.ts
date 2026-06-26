import * as vscode from "vscode";

// Git branch awareness, shared by branch-linked shortcuts (WOW #3) and time-bomb
// "until branch changes" expiry (WOW #9). The reader and the live tracker both
// read .git/HEAD directly — no `git` process, no dependency — mirroring the log-
// watch approach in systemEvents.ts. Reading is best-effort: every failure path
// returns undefined, and every consumer treats undefined as "do not hide / do not
// remove", so an unreadable / detached / worktree repo never silently loses shortcuts.

// Read the current git branch of a folder, or undefined when it cannot be
// determined (no repo, unreadable, or a shape this minimal reader does not handle).
// `.git` is usually a directory; in a worktree / submodule it is a file pointing at
// the real gitdir ("gitdir: <path>"), which is followed once. A symbolic-ref HEAD
// ("ref: refs/heads/<branch>") yields the branch name; a detached HEAD yields the
// raw commit hash, so checking out a different commit still reads as a branch change.
export async function readCurrentBranch(
  folder: vscode.WorkspaceFolder
): Promise<string | undefined> {
  try {
    let gitDir = vscode.Uri.joinPath(folder.uri, ".git");
    const stat = await vscode.workspace.fs.stat(gitDir);
    if (stat.type === vscode.FileType.File) {
      // A `.git` file points at the real gitdir (worktree / submodule).
      const pointer = Buffer.from(
        await vscode.workspace.fs.readFile(gitDir)
      ).toString("utf8");
      const match = pointer.match(/^gitdir:\s*(.+)\s*$/m);
      if (!match) {
        return undefined;
      }
      const target = match[1].trim();
      gitDir = target.match(/^([a-zA-Z]:[\\/]|[\\/])/)
        ? vscode.Uri.file(target)
        : vscode.Uri.joinPath(folder.uri, target);
    }
    const head = Buffer.from(
      await vscode.workspace.fs.readFile(vscode.Uri.joinPath(gitDir, "HEAD"))
    )
      .toString("utf8")
      .trim();
    const ref = head.match(/^ref:\s*refs\/heads\/(.+)$/);
    return ref ? ref[1].trim() : head;
  } catch {
    // No repo, unreadable, or an unexpected shape — caller keeps the shortcut.
    return undefined;
  }
}

// Tracks each workspace folder's current branch and fires onDidChangeBranch when a
// checkout rewrites .git/HEAD, so the Shortcuts view can re-filter branch-linked
// shortcuts live (WOW #3). The cache is read synchronously by the tree's branch predicate
// (getChildren is synchronous), so the value is held here and only refreshed by the
// watcher / init — never read off disk in the paint path. Disposable so every
// FileSystemWatcher and debounce timer is torn down on deactivation (a leaked
// watcher survives a reload and double-fires).
export class BranchTracker implements vscode.Disposable {
  private readonly _onDidChangeBranch = new vscode.EventEmitter<void>();
  // Fires after a folder's branch is (re)read, so the provider repaints and the
  // branch context keys re-sync.
  readonly onDidChangeBranch = this._onDidChangeBranch.event;

  private readonly disposables: vscode.Disposable[] = [];
  // Per-folder debounce timer keyed by folder uri, so a burst of HEAD touches from a
  // single checkout re-reads once.
  private readonly debounce = new Map<string, NodeJS.Timeout>();
  // Cached active branch per folder uri. A missing key means "not yet read"; a stored
  // undefined means "read, but unreadable" — both are treated as "show on all
  // branches" by the predicate, so the distinction is informational only.
  private readonly branches = new Map<string, string | undefined>();

  constructor() {
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      this.watchFolder(folder);
    }
    // Track a folder added later, and drop the cache for one removed, then notify so
    // the view re-filters against the new folder set.
    this.disposables.push(
      vscode.workspace.onDidChangeWorkspaceFolders((e) => {
        for (const folder of e.added) {
          this.watchFolder(folder);
          void this.refreshFolder(folder);
        }
        for (const folder of e.removed) {
          this.branches.delete(folder.uri.toString());
        }
        this._onDidChangeBranch.fire();
      })
    );
  }

  // Populate the branch cache for every folder, then notify once so the first paint
  // applies branch filtering. Called after the store's initial load; until it runs,
  // the cache is empty and every branch-linked shortcut shows (the safe default).
  async init(): Promise<void> {
    await Promise.all(
      (vscode.workspace.workspaceFolders ?? []).map((f) => this.refreshFolder(f))
    );
    this._onDidChangeBranch.fire();
  }

  // The cached current branch for a folder, or undefined when not yet read or
  // unreadable. The predicate treats undefined as "show on all branches".
  branchOf(folder: vscode.WorkspaceFolder): string | undefined {
    return this.branches.get(folder.uri.toString());
  }

  // The first workspace folder's branch, used to scope global branch-linked shortcuts
  // (a global shortcut is not owned by any folder; global shortcuts are rarely branch-linked).
  primaryBranch(): string | undefined {
    const first = vscode.workspace.workspaceFolders?.[0];
    return first ? this.branchOf(first) : undefined;
  }

  private watchFolder(folder: vscode.WorkspaceFolder): void {
    // A checkout rewrites .git/HEAD; watching that one file per folder fires the
    // re-read. onDidChange covers the rewrite, onDidCreate the first commit in a
    // fresh repo, onDidDelete a repo removed/reinitialized under the folder.
    const headPattern = new vscode.RelativePattern(folder, ".git/HEAD");
    const watcher = vscode.workspace.createFileSystemWatcher(headPattern);
    watcher.onDidChange(() => this.signal(folder));
    watcher.onDidCreate(() => this.signal(folder));
    watcher.onDidDelete(() => this.signal(folder));
    this.disposables.push(watcher);
  }

  // Coalesce a burst of HEAD touches into one re-read. 250 ms absorbs the multiple
  // writes a single checkout makes while still feeling immediate.
  private signal(folder: vscode.WorkspaceFolder): void {
    const key = folder.uri.toString();
    const existing = this.debounce.get(key);
    if (existing) {
      clearTimeout(existing);
    }
    this.debounce.set(
      key,
      setTimeout(() => {
        this.debounce.delete(key);
        void this.refreshFolder(folder).then(() =>
          this._onDidChangeBranch.fire()
        );
      }, 250)
    );
  }

  private async refreshFolder(folder: vscode.WorkspaceFolder): Promise<void> {
    this.branches.set(folder.uri.toString(), await readCurrentBranch(folder));
  }

  dispose(): void {
    for (const timer of this.debounce.values()) {
      clearTimeout(timer);
    }
    this.debounce.clear();
    for (const d of this.disposables) {
      d.dispose();
    }
    this._onDidChangeBranch.dispose();
  }
}
