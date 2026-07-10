import * as vscode from "vscode";
import * as path from "path";
import { promises as fs } from "fs";
import {
  FolderWatch,
  FolderWatchMode,
  FolderWatchStore,
} from "../model/folderWatch";
import { l10n } from "../i18n/l10n";
import { newId, creationScopes, notifyWatchChange } from "./folderWatchCommands";

// "Add a watch" flows: pick a folder or file, ask what to report, optionally narrow
// by a glob, then store the watch. The engine seeds the baseline on its next scan,
// so adding a watch never floods the user with the folder's existing contents.

// "Watch a folder for new files." Resolves the folder (the right-clicked resource
// or an open dialog), asks what to report, optionally narrows by a glob, then
// stores the watch. The engine seeds the baseline on its next scan, so adding a
// watch never floods the user with the folder's existing contents.
export async function addFolderWatch(
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
    // Alert in the project(s) open here, not every window. Opt other projects in
    // later from the Watches view; undefined (no folder open) keeps the legacy
    // "alert in the containing project" default.
    alertScopes: creationScopes(),
  };
  const stored = await store.add(watch);
  const name = path.basename(stored.target);
  notifyWatchChange(
    stored.mode === "changed"
      ? l10n("folderWatch.addedChanged", { name })
      : l10n("folderWatch.addedNew", { name })
  );
}

// "Watch a file for changes." A file watch only ever reports changes (a file
// cannot gain "new files"), so the mode is fixed.
export async function addFileWatch(
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
    // Alert in the project(s) open here, not every window (see addFolderWatch).
    alertScopes: creationScopes(),
  };
  const stored = await store.add(watch);
  notifyWatchChange(
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
