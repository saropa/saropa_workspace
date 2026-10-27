import * as vscode from "vscode";
import { l10n } from "../i18n/l10n";
import { DEFAULT_AFTER_DAYS, DEFAULT_ARCHIVE_FOLDER, TidyCandidate, TidyOptions, cleanArchiveFolder, clampAfterDays } from "../board/tidy";

// Release Board, Tidy sweep: the settings and the one move. The sweep lists candidates;
// a move happens only after the owner clicks the row's button and confirms the exact
// source and destination. Nothing is edited inside a document.

// Undefined when the sweep is switched off.
export function readTidySettings(): Pick<TidyOptions, "afterDays" | "archiveFolder"> | undefined {
  const c = vscode.workspace.getConfiguration("saropaWorkspace.releaseBoard.tidy");
  if (!c.get<boolean>("enabled", true)) {
    return undefined;
  }
  return {
    afterDays: clampAfterDays(c.get<number>("afterDays", DEFAULT_AFTER_DAYS)),
    archiveFolder: cleanArchiveFolder(c.get<string>("archiveFolder", DEFAULT_ARCHIVE_FOLDER)),
  };
}

async function exists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

// Moves one listed document into the archive folder. Returns true when it moved.
// Refuses when the file changed since the scan, or when the destination already exists.
export async function moveToArchive(projectRoot: vscode.Uri, c: TidyCandidate): Promise<boolean> {
  const from = vscode.Uri.joinPath(projectRoot, c.path);
  const to = vscode.Uri.joinPath(projectRoot, c.to);
  let mtime: number;
  try {
    mtime = (await vscode.workspace.fs.stat(from)).mtime;
  } catch {
    void vscode.window.showWarningMessage(l10n("releaseBoard.tidy.gone", { path: c.path }));
    return false;
  }
  if (Math.abs(mtime - c.mtimeMs) > 2) {
    void vscode.window.showWarningMessage(l10n("releaseBoard.tidy.changed", { path: c.path }));
    return false;
  }
  if (await exists(to)) {
    void vscode.window.showWarningMessage(l10n("releaseBoard.tidy.targetExists", { path: c.to }));
    return false;
  }
  if (isDirty(from)) {
    void vscode.window.showWarningMessage(l10n("releaseBoard.tidy.dirty", { path: c.path }));
    return false;
  }
  const move = l10n("releaseBoard.tidy.move");
  const answer = await vscode.window.showWarningMessage(l10n("releaseBoard.tidy.confirm", { from: c.path, to: c.to }), { modal: true }, move);
  if (answer !== move) {
    return false;
  }
  // The dialog can stay open for a while: check again right before the move.
  try {
    if (Math.abs((await vscode.workspace.fs.stat(from)).mtime - c.mtimeMs) > 2) {
      void vscode.window.showWarningMessage(l10n("releaseBoard.tidy.changed", { path: c.path }));
      return false;
    }
  } catch {
    void vscode.window.showWarningMessage(l10n("releaseBoard.tidy.gone", { path: c.path }));
    return false;
  }
  if (isDirty(from) || (await exists(to))) {
    void vscode.window.showWarningMessage(l10n("releaseBoard.tidy.changed", { path: c.path }));
    return false;
  }
  try {
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(to, ".."));
    // A workspace edit, so an open tab follows the file.
    const edit = new vscode.WorkspaceEdit();
    edit.renameFile(from, to, { overwrite: false });
    if (!(await vscode.workspace.applyEdit(edit))) {
      void vscode.window.showWarningMessage(l10n("releaseBoard.tidy.changed", { path: c.path }));
      return false;
    }
  } catch (e) {
    void vscode.window.showErrorMessage(l10n("releaseBoard.failed", { error: e instanceof Error ? e.message : String(e) }));
    return false;
  }
  return true;
}

function isDirty(uri: vscode.Uri): boolean {
  return vscode.workspace.textDocuments.some((d) => d.isDirty && d.uri.toString() === uri.toString());
}
