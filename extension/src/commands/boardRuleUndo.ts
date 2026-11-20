import * as vscode from "vscode";
import { l10n } from "../i18n/l10n";
import { RULES_FILE } from "./boardConfigLoad";
import { withWriteLock, writeFileSafe } from "./boardWrite";
import { hasUnsavedCopy, linkedRules, plainWriteError, readRules } from "./boardRuleText";

// Release Board, putting the rules file back to what a write replaced.

// What a write replaced: the file text before (undefined when there was no file) and the text
// written. Undo puts `before` back, and only while the file still holds `after`.
export interface RulesSnapshot {
  before: string | undefined;
  after: string;
  // The change created the .saropa folder too; Undo then removes it when it is left empty.
  madeDir?: boolean;
  // The workspace folder the rules file belongs to (its uri); Undo goes back to that one.
  folder?: string;
}

// Puts the rules file back to what an inline change replaced (removing it when there was none).
// Only while the file still holds exactly what that change wrote, with the same checks as a write:
// a later edit by hand, by another change or in an open editor is never overwritten.
export async function undoRulesWrite(s: RulesSnapshot): Promise<boolean> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  const root = (s.folder !== undefined ? folders.find((f) => f.uri.toString() === s.folder) : undefined) ?? folders[0];
  if (!root) {
    return false;
  }
  const uri = vscode.Uri.joinPath(root.uri, RULES_FILE);
  return withWriteLock(uri, () => undoRulesNow(s, root, uri));
}

async function undoRulesNow(s: RulesSnapshot, root: vscode.WorkspaceFolder, uri: vscode.Uri): Promise<boolean> {
  if (await hasUnsavedCopy(uri)) {
    void vscode.window.showWarningMessage(l10n("releaseBoard.undo.unsaved", { file: RULES_FILE }));
    return false;
  }
  if (await linkedRules(root, uri)) {
    void vscode.window.showWarningMessage(l10n("releaseBoard.noRule.symlink", { file: RULES_FILE }));
    return false;
  }
  const now = await readRules(uri);
  // Already back as it was (an earlier Undo that stopped partway): nothing left to do.
  if (s.before !== undefined && now.kind === "text" && now.text === s.before) {
    return true;
  }
  if (now.kind !== "text" || now.text !== s.after) {
    void vscode.window.showWarningMessage(l10n("releaseBoard.undo.changed", { file: RULES_FILE }));
    return false;
  }
  try {
    if (s.before === undefined) {
      await vscode.workspace.fs.delete(uri);
      if (s.madeDir) {
        const dir = vscode.Uri.joinPath(root.uri, ".saropa");
        if ((await vscode.workspace.fs.readDirectory(dir)).length === 0) {
          await vscode.workspace.fs.delete(dir, { recursive: true });
        }
      }
    } else {
      await writeFileSafe(uri, Buffer.from(s.before, "utf8"));
    }
  } catch (e) {
    void vscode.window.showErrorMessage(plainWriteError(e, RULES_FILE));
    return false;
  }
  return true;
}
