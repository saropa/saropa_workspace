import * as vscode from "vscode";
import * as path from "path";
import { promises as fs } from "fs";
import {
  FolderWatch,
  FolderWatchMode,
  FolderWatchStore,
} from "../model/folderWatch";
import { WatchTreeItem } from "../views/watchesTreeProvider";
import { l10n } from "../i18n/l10n";

// Commands that let the user set up and manage folder/file watches
// (PLAN_FILE_AND_FOLDER_WATCH). These are the "suggest a watch" entry points the
// plan asks for: pick a folder to be told about new files in, pick a file to be
// told when it changes, and a hub to review/toggle/remove existing watches. The
// engine (FolderWatchEngine) does the scanning and toasting; this layer is config.

// Fresh id, matching the store's own id shape (time prefix + random suffix) so ids
// stay sortable-by-creation and collision-free without a dependency.
function newId(): string {
  return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
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

// Clicking a watch row: open what changed and clear the counter. Reading the unseen
// list BEFORE clearing it lets the open land on the newest file; the clear then
// recalculates the activity-bar total (via the store's count event). A folder watch
// opens the most recent unseen file when there is one (the thing the counter is
// about), otherwise reveals the folder; a file watch opens the file.
async function openWatch(store: FolderWatchStore, id: string): Promise<void> {
  const watch = store.find(id);
  if (!watch) {
    return;
  }
  const unseen = store.getUnseen(id);
  await store.clearUnseen(id);

  const target = vscode.Uri.file(watch.target);
  if (watch.isFile) {
    await openOrReveal(target);
    return;
  }
  if (unseen.length > 0) {
    // unseen is sorted; the last entry is the alphabetically last path, a
    // reasonable "most recent" proxy without storing timestamps. Open it.
    const newest = unseen[unseen.length - 1];
    await openOrReveal(vscode.Uri.file(path.join(watch.target, newest)));
    return;
  }
  await vscode.commands.executeCommand("revealInExplorer", target);
}

// Open a document, falling back to revealing it in the Explorer when it cannot be
// opened as text (a binary or a folder).
async function openOrReveal(uri: vscode.Uri): Promise<void> {
  try {
    await vscode.window.showTextDocument(uri, { preview: true });
  } catch {
    await vscode.commands.executeCommand("revealInExplorer", uri);
  }
}

// Enable/disable a watch from its row's inline menu.
async function toggleWatchRow(
  store: FolderWatchStore,
  item: WatchTreeItem | undefined
): Promise<void> {
  if (!item) {
    return;
  }
  await store.update(item.watch.id, { enabled: !item.watch.enabled });
}

// Remove a watch from its row's inline menu, naming what was dropped.
async function removeWatchRow(
  store: FolderWatchStore,
  item: WatchTreeItem | undefined
): Promise<void> {
  if (!item) {
    return;
  }
  const name = item.watch.label ?? path.basename(item.watch.target);
  await store.remove(item.watch.id);
  vscode.window.showInformationMessage(l10n("folderWatch.removed", { name }));
}

// Gate key prefix for the one-time "this project has a bugs folder" offer, keyed by
// the folder's absolute path so a multi-root workspace is offered per folder and a
// dismissed offer never returns.
const BUGS_SUGGESTED_KEY = "saropaWorkspace.bugsWatchSuggested:";

// Offer to watch a project's `bugs/` folder for new files, once per folder. The
// project here keeps bug reports in `bugs/`, and a new report dropped in by a tool
// or teammate is exactly the "tell me when a new file lands" case; offering it
// removes the need to set the watch up by hand. Deferred and gated like the
// favorites-import offer so it never nags. Only fires when the folder actually
// exists and is not already watched.
export async function maybeSuggestBugsWatch(
  context: vscode.ExtensionContext,
  store: FolderWatchStore
): Promise<void> {
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    const bugsPath = path.join(folder.uri.fsPath, "bugs");
    const gateKey = BUGS_SUGGESTED_KEY + bugsPath;
    if (context.globalState.get<boolean>(gateKey, false)) {
      continue;
    }
    // Only offer when the folder exists, is a directory, and is not already watched.
    let isDir = false;
    try {
      isDir = (await fs.stat(bugsPath)).isDirectory();
    } catch {
      isDir = false;
    }
    if (!isDir) {
      continue;
    }
    if (store.list().some((w) => w.target === bugsPath)) {
      continue;
    }

    // Gate now (offered once), then ask. Manage Folder Watches is the recovery path
    // if the user dismisses and later wants it.
    await context.globalState.update(gateKey, true);
    const watchIt = l10n("folderWatch.suggestBugsAction");
    const choice = await vscode.window.showInformationMessage(
      l10n("folderWatch.suggestBugs", { folder: folder.name }),
      watchIt
    );
    if (choice !== watchIt) {
      continue;
    }
    const watch: FolderWatch = {
      id: newId(),
      target: bugsPath,
      isFile: false,
      mode: "new",
      enabled: true,
    };
    await store.add(watch);
    vscode.window.showInformationMessage(
      l10n("folderWatch.addedNew", { name: path.basename(bugsPath) })
    );
  }
}

// "Watch a folder for new files." Resolves the folder (the right-clicked resource
// or an open dialog), asks what to report, optionally narrows by a glob, then
// stores the watch. The engine seeds the baseline on its next scan, so adding a
// watch never floods the user with the folder's existing contents.
async function addFolderWatch(
  store: FolderWatchStore,
  uri: vscode.Uri | undefined
): Promise<void> {
  const folder = await resolveTarget(uri, "folder");
  if (!folder) {
    return;
  }
  const mode = await pickMode();
  if (!mode) {
    return;
  }
  const glob = await pickGlob();
  if (glob === undefined) {
    return;
  }

  const watch: FolderWatch = {
    id: newId(),
    target: folder,
    isFile: false,
    mode,
    glob: glob.length > 0 ? glob : undefined,
    enabled: true,
  };
  const stored = await store.add(watch);
  const name = path.basename(stored.target);
  vscode.window.showInformationMessage(
    stored.mode === "changed"
      ? l10n("folderWatch.addedChanged", { name })
      : l10n("folderWatch.addedNew", { name })
  );
}

// "Watch a file for changes." A file watch only ever reports changes (a file
// cannot gain "new files"), so the mode is fixed.
async function addFileWatch(
  store: FolderWatchStore,
  uri: vscode.Uri | undefined
): Promise<void> {
  const file = await resolveTarget(uri, "file");
  if (!file) {
    return;
  }
  const watch: FolderWatch = {
    id: newId(),
    target: file,
    isFile: true,
    mode: "changed",
    enabled: true,
  };
  const stored = await store.add(watch);
  vscode.window.showInformationMessage(
    l10n("folderWatch.addedFile", { name: path.basename(stored.target) })
  );
}

// Use the right-clicked resource when it is the right kind; otherwise open a
// picker. Validates an explicitly-passed uri's type so a "Watch folder" invoked on
// a file (or vice versa) falls back to the dialog rather than storing a mismatched
// watch.
async function resolveTarget(
  uri: vscode.Uri | undefined,
  kind: "file" | "folder"
): Promise<string | undefined> {
  if (uri) {
    try {
      const stat = await fs.stat(uri.fsPath);
      const isRightKind =
        kind === "folder" ? stat.isDirectory() : stat.isFile();
      if (isRightKind) {
        return uri.fsPath;
      }
    } catch {
      // Fall through to the dialog when the resource cannot be stat'd.
    }
  }
  const picked = await vscode.window.showOpenDialog({
    canSelectMany: false,
    canSelectFiles: kind === "file",
    canSelectFolders: kind === "folder",
    openLabel:
      kind === "folder"
        ? l10n("folderWatch.pickFolder")
        : l10n("folderWatch.pickFile"),
    title:
      kind === "folder"
        ? l10n("folderWatch.pickFolderTitle")
        : l10n("folderWatch.pickFileTitle"),
  });
  return picked && picked.length > 0 ? picked[0].fsPath : undefined;
}

interface ModeItem extends vscode.QuickPickItem {
  mode: FolderWatchMode;
}

// Choose between "only new files" and "new and changed files" for a folder watch.
async function pickMode(): Promise<FolderWatchMode | undefined> {
  const items: ModeItem[] = [
    {
      mode: "new",
      label: l10n("folderWatch.modeNew"),
      detail: l10n("folderWatch.modeNewDetail"),
    },
    {
      mode: "changed",
      label: l10n("folderWatch.modeChanged"),
      detail: l10n("folderWatch.modeChangedDetail"),
    },
  ];
  const pick = await vscode.window.showQuickPick(items, {
    title: l10n("folderWatch.modeTitle"),
    placeHolder: l10n("folderWatch.modePlaceholder"),
  });
  return pick?.mode;
}

// Optional glob to narrow a folder watch (e.g. "*.md"). Empty means every file
// counts. Returns undefined only on cancel (Esc), so an empty box is a deliberate
// "all files" answer, not a cancellation.
async function pickGlob(): Promise<string | undefined> {
  const value = await vscode.window.showInputBox({
    title: l10n("folderWatch.globTitle"),
    prompt: l10n("folderWatch.globPrompt"),
    placeHolder: l10n("folderWatch.globPlaceholder"),
  });
  return value === undefined ? undefined : value.trim().replace(/\\/g, "/");
}

interface WatchItem extends vscode.QuickPickItem {
  watch: FolderWatch;
}

// Review hub: list every watch with its state, then act on the chosen one (toggle
// enabled, or remove). Loops so several edits can be made in one sitting; Esc closes.
async function manageWatches(store: FolderWatchStore): Promise<void> {
  for (;;) {
    const watches = store.list();
    if (watches.length === 0) {
      vscode.window.showInformationMessage(l10n("folderWatch.none"));
      return;
    }
    const items: WatchItem[] = watches.map((w) => ({
      watch: w,
      label: w.label ?? path.basename(w.target),
      description: describeWatch(w),
      detail: w.target,
      iconPath: new vscode.ThemeIcon(w.enabled ? "eye" : "eye-closed"),
    }));
    const pick = await vscode.window.showQuickPick(items, {
      title: l10n("folderWatch.manageTitle"),
      placeHolder: l10n("folderWatch.managePlaceholder"),
    });
    if (!pick) {
      return;
    }
    const acted = await actOnWatch(store, pick.watch);
    if (acted === "removed-last") {
      return;
    }
  }
}

// One-line state summary for a watch row: kind, mode, and enabled/paused.
function describeWatch(watch: FolderWatch): string {
  const kind = watch.isFile
    ? l10n("folderWatch.kindFile")
    : l10n("folderWatch.kindFolder");
  const mode =
    watch.mode === "changed"
      ? l10n("folderWatch.modeChanged")
      : l10n("folderWatch.modeNew");
  const state = watch.enabled
    ? l10n("folderWatch.stateOn")
    : l10n("folderWatch.stateOff");
  return l10n("folderWatch.rowDescription", { kind, mode, state });
}

// Action sheet for a single watch. Returns "removed-last" so the hub closes when
// the final watch is deleted (its empty-list branch would otherwise re-toast).
async function actOnWatch(
  store: FolderWatchStore,
  watch: FolderWatch
): Promise<"continue" | "removed-last"> {
  const toggle = watch.enabled
    ? l10n("folderWatch.disable")
    : l10n("folderWatch.enable");
  const remove = l10n("folderWatch.remove");
  const choice = await vscode.window.showQuickPick([toggle, remove], {
    title: watch.label ?? path.basename(watch.target),
    placeHolder: l10n("folderWatch.actionPlaceholder"),
  });
  if (!choice) {
    return "continue";
  }
  if (choice === toggle) {
    await store.update(watch.id, { enabled: !watch.enabled });
    return "continue";
  }
  await store.remove(watch.id);
  vscode.window.showInformationMessage(
    l10n("folderWatch.removed", { name: watch.label ?? path.basename(watch.target) })
  );
  return store.list().length === 0 ? "removed-last" : "continue";
}
