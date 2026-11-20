import * as vscode from "vscode";
import { l10n } from "../i18n/l10n";
import { AssignRefusal } from "../board/ruleAssign";
import { RULES_FILE } from "./boardConfigLoad";
import { withWriteLock, writeFileSafe } from "./boardWrite";
import { RulesRead, hasUnsavedCopy, linkedRules, plainWriteError, readRules, sameRead } from "./boardRuleText";
import { RulesSnapshot } from "./boardRuleUndo";

// Release Board, the one guarded write path every change to the rules file goes through. It lives
// apart from boardRuleAssign so the data-loss-class sequence (guards, confirmation, second read,
// write, late-landing check) sits in one short file; boardRuleAssign re-exports it for old imports.

// One change to the text of the rules file, with the words that go with it. Without `confirm` the
// change is written at once and `saved` hands the caller what it replaced.
export interface TextChange {
  folder: string;
  // The new text from the current one, or why it cannot be made; vars are shown in the words.
  make: (before: string | undefined) => { ok: true; text: string; vars: Record<string, string> } | { ok: false; reason: AssignRefusal };
  confirm?: (vars: Record<string, string>) => string;
  button?: string;
  done?: (vars: Record<string, string>) => string;
  saved?: (snapshot: RulesSnapshot) => void;
  refusal: (reason: AssignRefusal, folder: string) => void;
}

// Writes a change to the rules file with every check: no unsaved copy open, no symbolic link,
// strict UTF-8, a confirmation that names the change (when it has one), and a second read just
// before the write. Returns true when the file was written, so the caller scans again.
export function applyTextChange(root: vscode.WorkspaceFolder, c: TextChange): Promise<boolean> {
  return withWriteLock(vscode.Uri.joinPath(root.uri, RULES_FILE), () => applyTextChangeNow(root, c));
}

// First guard of a write: true (after telling the user why) when the file has an unsaved copy
// open in an editor, or it or its folder is a symbolic link.
async function blockedBeforeRead(root: vscode.WorkspaceFolder, uri: vscode.Uri): Promise<boolean> {
  if (await hasUnsavedCopy(uri)) {
    void vscode.window.showWarningMessage(l10n("releaseBoard.noRule.unsaved", { file: RULES_FILE }));
    return true;
  }
  if (await linkedRules(root, uri)) {
    void vscode.window.showWarningMessage(l10n("releaseBoard.noRule.symlink", { file: RULES_FILE }));
    return true;
  }
  return false;
}

async function applyTextChangeNow(root: vscode.WorkspaceFolder, c: TextChange): Promise<boolean> {
  const uri = vscode.Uri.joinPath(root.uri, RULES_FILE);
  if (await blockedBeforeRead(root, uri)) {
    return false;
  }
  const before = await readRules(uri);
  if (before.kind === "encoding") {
    c.refusal("encoding", c.folder);
    return false;
  }
  const result = c.make(before.kind === "text" ? before.text : undefined);
  if (!result.ok) {
    c.refusal(result.reason, c.folder);
    return false;
  }
  if (c.confirm && (await vscode.window.showWarningMessage(c.confirm(result.vars), { modal: true }, c.button ?? "")) !== c.button) {
    return false;
  }
  // The file is read again just before the write: a change made while the dialogs were open wins.
  if ((await hasUnsavedCopy(uri)) || !sameRead(await readRules(uri), before)) {
    void vscode.window.showWarningMessage(l10n("releaseBoard.noRule.changed", { file: RULES_FILE }));
    return false;
  }
  if (await linkedRules(root, uri)) {
    void vscode.window.showWarningMessage(l10n("releaseBoard.noRule.symlink", { file: RULES_FILE }));
    return false;
  }
  return writeAndVerify(root, uri, before, result, c);
}

// Writes the new text (creating the .saropa folder when missing), tells the user, and hands the
// caller what was replaced. A write that failed late but landed is kept undoable.
async function writeAndVerify(root: vscode.WorkspaceFolder, uri: vscode.Uri, before: RulesRead, result: { text: string; vars: Record<string, string> }, c: TextChange): Promise<boolean> {
  const dir = vscode.Uri.joinPath(root.uri, ".saropa");
  let madeDir = false;
  try {
    try {
      await vscode.workspace.fs.stat(dir);
    } catch {
      madeDir = true;
    }
    await vscode.workspace.fs.createDirectory(dir);
    await writeFileSafe(uri, Buffer.from(result.text, "utf8"));
  } catch (e) {
    void vscode.window.showErrorMessage(plainWriteError(e, RULES_FILE));
    // A write that failed late may still have landed; keep it undoable when it did.
    const now = await readRules(uri).catch((): RulesRead => ({ kind: "none" }));
    if (now.kind === "text" && now.text === result.text) {
      c.saved?.({ before: before.kind === "text" ? before.text : undefined, after: result.text, ...(madeDir ? { madeDir } : {}), folder: root.uri.toString() });
      return true;
    }
    return false;
  }
  if (c.done) {
    void vscode.window.showInformationMessage(c.done(result.vars));
  }
  c.saved?.({ before: before.kind === "text" ? before.text : undefined, after: result.text, ...(madeDir ? { madeDir } : {}), folder: root.uri.toString() });
  return true;
}
