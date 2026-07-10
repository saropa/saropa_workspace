import * as vscode from "vscode";
import { FolderWatchStore } from "../model/folderWatch";
import { WatchTreeItem } from "../views/watchesTreeProvider";
import { addFolderWatch, addFileWatch } from "./folderWatchAddCommands";
import { manageWatches } from "./folderWatchManageCommands";
import {
  openWatch,
  toggleWatchRow,
  removeWatchRow,
} from "./folderWatchRowCommands";

// Commands that let the user set up and manage folder/file watches
// (PLAN_FILE_AND_FOLDER_WATCH). These are the "suggest a watch" entry points the
// plan asks for: pick a folder to be told about new files in, pick a file to be
// told when it changes, and a hub to review/toggle/remove existing watches. The
// engine (FolderWatchEngine) does the scanning and toasting; this layer is config.
//
// This file holds the entry point (registerFolderWatchCommands) and the helpers
// shared across the split-out command files: folderWatchRowCommands.ts (per-row
// actions), folderWatchAddCommands.ts (add-a-watch flows), and
// folderWatchManageCommands.ts (the review hub). folderWatchSuggest.ts (the
// bugs-folder offer) is a separate sibling that also depends on these helpers.

// Fresh id, matching the store's own id shape (time prefix + random suffix) so ids
// stay sortable-by-creation and collision-free without a dependency.
export function newId(): string {
  return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
}

// The current window's workspace folders as fsPaths. A new watch is scoped to alert
// in these projects (so it never fires in unrelated windows), and the opt-in/out
// actions add/remove the current window's folders from a watch's alert scope.
export function currentFolderPaths(): string[] {
  return (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);
}

// The alert scope a freshly-created watch should carry: the project(s) open in this
// window. Undefined when no folder is open, which leaves the legacy "alert in the
// containing project" default rather than storing [] (muted everywhere) — a watch
// added in an empty window should still alert once its project is opened.
export function creationScopes(): string[] | undefined {
  const folders = currentFolderPaths();
  return folders.length > 0 ? folders : undefined;
}

// How long a one-time watch confirmation stays on screen before clearing itself.
// Long enough to read the sentence, short enough that it never becomes clutter.
export const WATCH_NOTICE_MS = 4000;

// Show a self-dismissing acknowledgment for a watch config change (added/removed).
//
// BUG FIX (2026-06-28): these confirmations were shown with
// `showInformationMessage(message)` and no action button. VS Code exposes no
// timeout for that call, and a buttonless info toast can sit in the stack until the
// user dismisses it by hand — the "snackbar never times out" report. A progress
// notification closes the instant its task settles, so resolving one after a fixed
// delay gives the guaranteed auto-dismiss the plain message API does not. Used only
// for transient acknowledgments here; the engine's change alerts keep their plain
// message because they carry an "Open" action and are meant to persist until acted on.
export function notifyWatchChange(message: string): void {
  void vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: message },
    () => new Promise<void>((resolve) => setTimeout(resolve, WATCH_NOTICE_MS))
  );
}

export function registerFolderWatchCommands(
  context: vscode.ExtensionContext,
  store: FolderWatchStore
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "saropaWorkspace.watchFolder",
      (uri?: vscode.Uri) => addFolderWatch(store, uri)
    ),
    vscode.commands.registerCommand(
      "saropaWorkspace.watchFile",
      (uri?: vscode.Uri) => addFileWatch(store, uri)
    ),
    vscode.commands.registerCommand("saropaWorkspace.manageWatches", () =>
      manageWatches(store)
    ),
    // Watches-view row commands: click a row to open what changed and clear its
    // counter; the inline menu toggles or removes the watch.
    vscode.commands.registerCommand(
      "saropaWorkspace.openWatch",
      (id: string) => openWatch(store, id)
    ),
    vscode.commands.registerCommand(
      "saropaWorkspace.toggleWatch",
      (item?: WatchTreeItem) => toggleWatchRow(store, item)
    ),
    vscode.commands.registerCommand(
      "saropaWorkspace.removeWatch",
      (item?: WatchTreeItem) => removeWatchRow(store, item)
    )
  );
}
