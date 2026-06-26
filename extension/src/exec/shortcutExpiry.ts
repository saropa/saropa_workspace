import * as vscode from "vscode";
import { Shortcut } from "../model/shortcut";
import { ShortcutStore } from "../model/shortcutStore";
import { runStatusRegistry } from "./runStatus";
import { readCurrentBranch } from "./gitBranch";
import { l10n } from "../i18n/l10n";

// Time-bomb / ephemeral shortcuts (WOW #9). A shortcut the user explicitly time-bombed
// (Shortcut.expires) removes itself once its condition is met: a wall-clock instant
// (`at`) or leaving the git branch it was bombed on (`onBranchAway`). This module
// owns the detection — a low-frequency sweep timer for the `at` case, a per-folder
// .git/HEAD watcher for the branch case, and one sweep on activation — plus the
// single summary toast (with Undo) shown after a sweep removes anything.
//
// Safety invariant: ONLY shortcuts carrying `expires` are ever touched, and a branch
// condition is skipped (the shortcut kept) whenever the branch cannot be read, so an
// unreadable / detached / worktree repo never silently loses shortcuts.

// How often the wall-clock sweep runs. A minute is fine: an expiry is a cleanup
// convenience, not a deadline, so the shortcut lingering up to a minute past `at`
// before it vanishes is acceptable, and a single shared timer (not one per shortcut)
// keeps the cost flat regardless of how many shortcuts are bombed.
const SWEEP_INTERVAL_MS = 60_000;

// The branch reader now lives in gitBranch.ts as the single source shared with
// branch-linked shortcuts (WOW #3); the sweep treats its undefined return as "do not
// remove", so an unreadable repo never loses a shortcut.

// A shortcut removed by the sweep, paired with the folder that owned it (captured before
// removal, since the store's shortcut->folder map no longer holds a removed id). Used to
// restore the exact shortcut to the right folder on Undo.
interface RemovedShortcut {
  shortcut: Shortcut;
  folder?: vscode.WorkspaceFolder;
}

// Examine every shortcut and remove the time-bombed ones whose condition is now met,
// returning the removed snapshots so the caller can offer a single Undo. The
// candidate list is captured up front, so the per-removal refresh does not disturb
// iteration. Branch reads are cached per folder for the duration of one sweep.
async function sweepExpired(store: ShortcutStore): Promise<RemovedShortcut[]> {
  const now = Date.now();
  const branchCache = new Map<string, string | undefined>();
  const branchOf = async (
    folder: vscode.WorkspaceFolder
  ): Promise<string | undefined> => {
    const key = folder.uri.toString();
    if (!branchCache.has(key)) {
      branchCache.set(key, await readCurrentBranch(folder));
    }
    return branchCache.get(key);
  };

  const candidates = [...store.getProjectShortcuts(), ...store.getGlobalShortcuts()].filter(
    (p) => p.expires !== undefined
  );

  const victims: RemovedShortcut[] = [];
  for (const shortcut of candidates) {
    const expires = shortcut.expires;
    if (!expires) {
      continue;
    }
    // Wall-clock condition: due once now has reached the instant.
    if (expires.at !== undefined && now >= expires.at) {
      victims.push({ shortcut, folder: store.folderOf(shortcut) });
      continue;
    }
    // Branch condition: removed only when the owning folder's branch is readable
    // AND differs from the one the shortcut was bombed on. An unreadable branch (or no
    // owning folder) keeps the shortcut — the safety invariant.
    if (expires.onBranchAway !== undefined) {
      const folder = store.folderOf(shortcut) ?? vscode.workspace.workspaceFolders?.[0];
      if (!folder) {
        continue;
      }
      const current = await branchOf(folder);
      if (current !== undefined && current !== expires.onBranchAway) {
        victims.push({ shortcut, folder: store.folderOf(shortcut) });
      }
    }
  }

  for (const victim of victims) {
    await store.removeShortcut(victim.shortcut);
    // Drop any last-run badge so it does not outlive the shortcut (mirrors the remove
    // command's cleanup).
    runStatusRegistry.clear(victim.shortcut.id);
  }
  return victims;
}

// The display name shown in the summary toast for a removed shortcut.
function shortcutName(shortcut: Shortcut): string {
  return shortcut.label ?? (shortcut.path.split("/").pop() ?? shortcut.path);
}

// Drives time-bomb expiry: one sweep on construction, a low-frequency timer for the
// wall-clock case, and a .git/HEAD watcher per folder for the branch case. Disposable
// so the timer and every watcher are cleared on deactivation (a leaked timer would
// keep firing after reload).
export class ShortcutExpiry implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private readonly timer: NodeJS.Timeout;

  constructor(private readonly store: ShortcutStore) {
    // Sweep once now: a shortcut whose `at` passed while the window was closed, or a
    // branch switched on another machine, should clear on open.
    void this.sweep();

    // Wall-clock sweeps on a single shared interval (never one timer per shortcut).
    this.timer = setInterval(() => void this.sweep(), SWEEP_INTERVAL_MS);

    // Branch-change detection: a checkout rewrites .git/HEAD, so watching that one
    // file per folder fires the branch sweep immediately. The 60s timer is the
    // backstop for repos this watch misses (a `.git`-file worktree whose HEAD lives
    // elsewhere).
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      this.watchFolder(folder);
    }
    this.disposables.push(
      vscode.workspace.onDidChangeWorkspaceFolders((e) => {
        for (const folder of e.added) {
          this.watchFolder(folder);
        }
      })
    );
  }

  private watchFolder(folder: vscode.WorkspaceFolder): void {
    const headPattern = new vscode.RelativePattern(folder, ".git/HEAD");
    const watcher = vscode.workspace.createFileSystemWatcher(headPattern);
    watcher.onDidChange(() => void this.sweep());
    watcher.onDidCreate(() => void this.sweep());
    this.disposables.push(watcher);
  }

  // Run a sweep and, when it removed anything, show ONE summary toast naming what
  // went and offering Undo. Removal is otherwise irreversible for a project shortcut
  // shared via the repo, so the Undo (re-add the snapshot with the bomb defused) is
  // the safety net for an unintended expiry.
  private async sweep(): Promise<void> {
    const removed = await sweepExpired(this.store);
    if (removed.length === 0) {
      return;
    }
    const names = removed.map((r) => shortcutName(r.shortcut)).join(", ");
    const message =
      removed.length === 1
        ? l10n("expiry.sweptOne", { name: names })
        : l10n("expiry.sweptMany", { count: removed.length, names });
    const undo = l10n("expiry.undo");
    const choice = await vscode.window.showInformationMessage(message, undo);
    if (choice !== undo) {
      return;
    }
    for (const r of removed) {
      await this.store.restoreShortcut(r.shortcut, r.folder);
    }
    vscode.window.showInformationMessage(
      l10n("expiry.restored", { count: removed.length })
    );
  }

  dispose(): void {
    clearInterval(this.timer);
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}
