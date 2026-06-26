import * as vscode from "vscode";
import { Pin } from "../model/pin";
import { PinStore } from "../model/pinStore";
import { runStatusRegistry } from "./runStatus";
import { l10n } from "../i18n/l10n";

// Time-bomb / ephemeral pins (WOW #9). A pin the user explicitly time-bombed
// (Pin.expires) removes itself once its condition is met: a wall-clock instant
// (`at`) or leaving the git branch it was bombed on (`onBranchAway`). This module
// owns the detection — a low-frequency sweep timer for the `at` case, a per-folder
// .git/HEAD watcher for the branch case, and one sweep on activation — plus the
// single summary toast (with Undo) shown after a sweep removes anything.
//
// Safety invariant: ONLY pins carrying `expires` are ever touched, and a branch
// condition is skipped (the pin kept) whenever the branch cannot be read, so an
// unreadable / detached / worktree repo never silently loses pins.

// How often the wall-clock sweep runs. A minute is fine: an expiry is a cleanup
// convenience, not a deadline, so the pin lingering up to a minute past `at`
// before it vanishes is acceptable, and a single shared timer (not one per pin)
// keeps the cost flat regardless of how many pins are bombed.
const SWEEP_INTERVAL_MS = 60_000;

// Read the current git branch of a folder, or undefined when it cannot be
// determined (no repo, unreadable, or a shape this minimal reader does not handle).
// Reads .git/HEAD directly — no `git` process, no dependency — mirroring the log-
// watch approach in systemEvents.ts. `.git` is usually a directory; in a worktree /
// submodule it is a file pointing at the real gitdir ("gitdir: <path>"), which is
// followed once. A symbolic-ref HEAD ("ref: refs/heads/<branch>") yields the branch
// name; a detached HEAD yields the raw commit hash, so checking out a different
// commit still reads as a branch change. Any error returns undefined, which the
// sweep treats as "do not remove" — never losing a pin on a read failure.
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
    // No repo, unreadable, or an unexpected shape — caller keeps the pin.
    return undefined;
  }
}

// A pin removed by the sweep, paired with the folder that owned it (captured before
// removal, since the store's pin->folder map no longer holds a removed id). Used to
// restore the exact pin to the right folder on Undo.
interface RemovedPin {
  pin: Pin;
  folder?: vscode.WorkspaceFolder;
}

// Examine every pin and remove the time-bombed ones whose condition is now met,
// returning the removed snapshots so the caller can offer a single Undo. The
// candidate list is captured up front, so the per-removal refresh does not disturb
// iteration. Branch reads are cached per folder for the duration of one sweep.
async function sweepExpired(store: PinStore): Promise<RemovedPin[]> {
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

  const candidates = [...store.getProjectPins(), ...store.getGlobalPins()].filter(
    (p) => p.expires !== undefined
  );

  const victims: RemovedPin[] = [];
  for (const pin of candidates) {
    const expires = pin.expires;
    if (!expires) {
      continue;
    }
    // Wall-clock condition: due once now has reached the instant.
    if (expires.at !== undefined && now >= expires.at) {
      victims.push({ pin, folder: store.folderOf(pin) });
      continue;
    }
    // Branch condition: removed only when the owning folder's branch is readable
    // AND differs from the one the pin was bombed on. An unreadable branch (or no
    // owning folder) keeps the pin — the safety invariant.
    if (expires.onBranchAway !== undefined) {
      const folder = store.folderOf(pin) ?? vscode.workspace.workspaceFolders?.[0];
      if (!folder) {
        continue;
      }
      const current = await branchOf(folder);
      if (current !== undefined && current !== expires.onBranchAway) {
        victims.push({ pin, folder: store.folderOf(pin) });
      }
    }
  }

  for (const victim of victims) {
    await store.removePin(victim.pin);
    // Drop any last-run badge so it does not outlive the pin (mirrors the unpin
    // command's cleanup).
    runStatusRegistry.clear(victim.pin.id);
  }
  return victims;
}

// The display name shown in the summary toast for a removed pin.
function pinName(pin: Pin): string {
  return pin.label ?? (pin.path.split("/").pop() ?? pin.path);
}

// Drives time-bomb expiry: one sweep on construction, a low-frequency timer for the
// wall-clock case, and a .git/HEAD watcher per folder for the branch case. Disposable
// so the timer and every watcher are cleared on deactivation (a leaked timer would
// keep firing after reload).
export class PinExpiry implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private readonly timer: NodeJS.Timeout;

  constructor(private readonly store: PinStore) {
    // Sweep once now: a pin whose `at` passed while the window was closed, or a
    // branch switched on another machine, should clear on open.
    void this.sweep();

    // Wall-clock sweeps on a single shared interval (never one timer per pin).
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
  // went and offering Undo. Removal is otherwise irreversible for a project pin
  // shared via the repo, so the Undo (re-add the snapshot with the bomb defused) is
  // the safety net for an unintended expiry.
  private async sweep(): Promise<void> {
    const removed = await sweepExpired(this.store);
    if (removed.length === 0) {
      return;
    }
    const names = removed.map((r) => pinName(r.pin)).join(", ");
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
      await this.store.restorePin(r.pin, r.folder);
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
