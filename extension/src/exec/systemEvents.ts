import * as vscode from "vscode";
import { SystemEventName } from "../model/pin";

// In-process bus for system-level events that pins can chain off (WOW: special
// trigger events). Two sources feed it:
//   - The ChainRunner forwards a pin's `emits` (build / publish) when that pin
//     completes — there is no generic build system here, so "a build happened" is
//     defined as "a pin the user marked as the build step finished".
//   - GitEventWatcher (below) detects commits and pushes directly from the repo's
//     .git logs, so gitCommit / gitPush fire with no pin needed.
// The ChainRunner subscribes and runs every pin whose triggers name the event.
class SystemEventBus {
  private readonly _onDidFire = new vscode.EventEmitter<SystemEventName>();

  readonly onDidFire = this._onDidFire.event;

  fire(event: SystemEventName): void {
    this._onDidFire.fire(event);
  }
}

// Module-level singleton: the git watcher and the chain runner fire it, the chain
// runner subscribes to it.
export const systemEvents = new SystemEventBus();

// Watches each workspace folder's git logs and fires gitCommit / gitPush on the bus.
// Reads the log files only as a change SIGNAL (it never parses them), so it works
// without `git` on PATH and adds no dependency. A commit appends a line to
// .git/logs/HEAD; a push updates a remote-tracking ref log under
// .git/logs/refs/remotes/. Both are debounced because a single git operation can
// touch a file more than once in quick succession.
//
// Note on .git watching: VS Code's default files.watcherExclude hides **/.git/**
// from the workspace file events, but an explicit createFileSystemWatcher with a
// RelativePattern rooted at the folder still receives them — the exclude governs the
// global watcher, not a targeted one. Disposable so every watcher and timer is torn
// down on deactivation.
export class GitEventWatcher implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  // Per-event debounce timers, so a burst of file touches fires the bus once.
  private readonly debounce = new Map<SystemEventName, NodeJS.Timeout>();

  constructor() {
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      this.watchFolder(folder);
    }
    // Re-arm when the folder set changes so a folder opened later is also watched.
    this.disposables.push(
      vscode.workspace.onDidChangeWorkspaceFolders((e) => {
        for (const folder of e.added) {
          this.watchFolder(folder);
        }
      })
    );
  }

  private watchFolder(folder: vscode.WorkspaceFolder): void {
    // A commit appends to .git/logs/HEAD; watch that single file for the commit
    // signal. onDidChange covers the append; onDidCreate covers the first commit in
    // a fresh repo (the log file did not exist before).
    const commitLog = new vscode.RelativePattern(folder, ".git/logs/HEAD");
    const commitWatcher = vscode.workspace.createFileSystemWatcher(commitLog);
    commitWatcher.onDidChange(() => this.signal("gitCommit"));
    commitWatcher.onDidCreate(() => this.signal("gitCommit"));
    this.disposables.push(commitWatcher);

    // A push updates the remote-tracking ref logs under .git/logs/refs/remotes/**;
    // watch the subtree for the push signal.
    const pushLogs = new vscode.RelativePattern(
      folder,
      ".git/logs/refs/remotes/**"
    );
    const pushWatcher = vscode.workspace.createFileSystemWatcher(pushLogs);
    pushWatcher.onDidChange(() => this.signal("gitPush"));
    pushWatcher.onDidCreate(() => this.signal("gitPush"));
    this.disposables.push(pushWatcher);
  }

  // Coalesce a burst of touches into one fire. 400 ms is long enough to absorb the
  // multiple writes a single git operation makes, short enough to feel immediate.
  private signal(event: SystemEventName): void {
    const existing = this.debounce.get(event);
    if (existing) {
      clearTimeout(existing);
    }
    this.debounce.set(
      event,
      setTimeout(() => {
        this.debounce.delete(event);
        systemEvents.fire(event);
      }, 400)
    );
  }

  dispose(): void {
    for (const timer of this.debounce.values()) {
      clearTimeout(timer);
    }
    this.debounce.clear();
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}
