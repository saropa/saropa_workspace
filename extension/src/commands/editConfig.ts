import * as vscode from "vscode";
import { PROJECT_FILE_RELATIVE, emptyProjectShortcutsFile } from "../model/shortcut";
import { l10n } from "../i18n/l10n";

// "Edit Shortcuts Config (JSON)" (roadmap Later / Exploratory — raw-config
// editability). Opens the project shortcuts file (.vscode/saropa-workspace.json)
// for direct editing, the power-user path alongside the GUI editors. Paired with
// the file watcher in activate(), which refreshes the tree live when the JSON is
// saved, so a hand edit shows up without a reload.
//
// The store writes project shortcuts relative to each workspace folder, so the
// config is per-folder; with several folders open the user picks which one to edit.
// The file is created (empty, valid) on first edit when it does not exist yet, so
// the command never dead-ends on "file not found".

export async function editShortcutsConfig(): Promise<void> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length === 0) {
    vscode.window.showWarningMessage(l10n("pinsConfig.noFolder"));
    return;
  }

  const folder =
    folders.length === 1 ? folders[0] : await pickFolder(folders);
  if (!folder) {
    return;
  }

  const uri = vscode.Uri.joinPath(folder.uri, PROJECT_FILE_RELATIVE);
  await ensureExists(folder, uri);
  // preview: false so the config opens as a permanent tab the user can edit and
  // keep, not a transient preview that a next click would replace.
  const doc = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(doc, { preview: false });
}

// Pick the workspace folder whose config to edit, when more than one is open.
async function pickFolder(
  folders: readonly vscode.WorkspaceFolder[]
): Promise<vscode.WorkspaceFolder | undefined> {
  interface FolderItem extends vscode.QuickPickItem {
    folder: vscode.WorkspaceFolder;
  }
  const items: FolderItem[] = folders.map((f) => ({
    label: f.name,
    description: f.uri.fsPath,
    folder: f,
  }));
  const pick = await vscode.window.showQuickPick(items, {
    title: l10n("pinsConfig.title"),
    placeHolder: l10n("pinsConfig.pickFolder"),
  });
  return pick?.folder;
}

// Create an empty, valid config file when none exists yet, so editing the
// "shortcuts JSON" always has a file to open. Matches the store's write shape (the
// .vscode directory is created if missing, the file is the empty
// ProjectShortcutsFile).
async function ensureExists(
  folder: vscode.WorkspaceFolder,
  uri: vscode.Uri
): Promise<void> {
  try {
    await vscode.workspace.fs.stat(uri);
    return;
  } catch {
    // Not present — create it below.
  }
  await vscode.workspace.fs.createDirectory(
    vscode.Uri.joinPath(folder.uri, ".vscode")
  );
  const json = JSON.stringify(emptyProjectShortcutsFile(), null, 2) + "\n";
  await vscode.workspace.fs.writeFile(uri, Buffer.from(json, "utf8"));
}
