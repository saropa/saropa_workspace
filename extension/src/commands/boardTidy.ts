import * as vscode from "vscode";
import { l10n } from "../i18n/l10n";
import { pathExists } from "./boardFileSource";
import { DEFAULT_AFTER_DAYS, DEFAULT_ARCHIVE_FOLDER, TidyCandidate, TidyOptions, cleanArchiveFolder, clampAfterDays } from "../board/tidy";

// Release Board, Tidy sweep: the settings and the one move. The sweep lists candidates;
// a move happens only after the owner clicks the row's button and confirms the exact
// source and destination. Nothing is edited inside a document.

// Undefined when the sweep is switched off.
export function readTidySettings(): Pick<TidyOptions, "afterDays" | "archiveFolder" | "reports"> | undefined {
  const c = vscode.workspace.getConfiguration("saropaWorkspace.releaseBoard.tidy");
  if (!c.get<boolean>("enabled", true)) {
    return undefined;
  }
  return {
    afterDays: clampAfterDays(c.get<number>("afterDays", DEFAULT_AFTER_DAYS)),
    archiveFolder: cleanArchiveFolder(c.get<string>("archiveFolder", DEFAULT_ARCHIVE_FOLDER)),
    reports: c.get<boolean>("reports", true),
  };
}

// Whether the listed source is still the file the sweep saw: missing, or changed since
// the scan (its modified time moved), or fine (undefined).
export async function sourceProblem(from: vscode.Uri, c: TidyCandidate): Promise<"gone" | "changed" | undefined> {
  try {
    const mtime = (await vscode.workspace.fs.stat(from)).mtime;
    return Math.abs(mtime - c.mtimeMs) > 2 ? "changed" : undefined;
  } catch {
    return "gone";
  }
}

// Tells the owner why the move was refused.
function warnSource(problem: "gone" | "changed", path: string): void {
  void vscode.window.showWarningMessage(problem === "gone" ? l10n("releaseBoard.tidy.gone", { path }) : l10n("releaseBoard.tidy.changed", { path }));
}

// True when the document is open with unsaved edits.
function isDirty(uri: vscode.Uri): boolean {
  return vscode.workspace.textDocuments.some((d) => d.isDirty && d.uri.toString() === uri.toString());
}

// The checks before the confirmation: the source is unchanged, the target is free and the
// document has no unsaved edits. Warns and returns false on the first that fails.
async function mayAsk(from: vscode.Uri, to: vscode.Uri, c: TidyCandidate): Promise<boolean> {
  const problem = await sourceProblem(from, c);
  if (problem) {
    warnSource(problem, c.path);
    return false;
  }
  if (await pathExists(to)) {
    void vscode.window.showWarningMessage(l10n("releaseBoard.tidy.targetExists", { path: c.to }));
    return false;
  }
  if (isDirty(from)) {
    void vscode.window.showWarningMessage(l10n("releaseBoard.tidy.dirty", { path: c.path }));
    return false;
  }
  return true;
}

// Moves one listed document into the archive folder. Returns true when it moved.
// Refuses when the file is gone, changed since the scan, has unsaved edits, or when the
// destination already exists; the checks run again after the confirmation.
export async function moveToArchive(projectRoot: vscode.Uri, c: TidyCandidate): Promise<boolean> {
  const from = vscode.Uri.joinPath(projectRoot, c.path);
  const to = vscode.Uri.joinPath(projectRoot, c.to);
  if (!(await mayAsk(from, to, c))) {
    return false;
  }
  const move = l10n("releaseBoard.tidy.move");
  const answer = await vscode.window.showWarningMessage(l10n("releaseBoard.tidy.confirm", { from: c.path, to: c.to }), { modal: true }, move);
  if (answer !== move) {
    return false;
  }
  // The dialog can stay open for a while: check again right before the move.
  const again = await sourceProblem(from, c);
  if (again) {
    warnSource(again, c.path);
    return false;
  }
  if (isDirty(from) || (await pathExists(to))) {
    warnSource("changed", c.path);
    return false;
  }
  try {
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(to, ".."));
    // A workspace edit, so an open tab follows the file.
    const edit = new vscode.WorkspaceEdit();
    edit.renameFile(from, to, { overwrite: false });
    if (!(await vscode.workspace.applyEdit(edit))) {
      warnSource("changed", c.path);
      return false;
    }
  } catch (e) {
    void vscode.window.showErrorMessage(l10n("releaseBoard.failed", { error: e instanceof Error ? e.message : String(e) }));
    return false;
  }
  return true;
}
