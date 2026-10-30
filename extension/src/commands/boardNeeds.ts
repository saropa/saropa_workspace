import * as vscode from "vscode";
import { l10n } from "../i18n/l10n";
import { addNeed, removeNeed } from "../board/needsEdit";
import { decodeRules } from "../board/ruleAssign";
import { BoardRun } from "./boardScanStore";
import { pathExists } from "./boardFileSource";
import { hasUnsavedCopy, isLink } from "./boardRuleAssign";

// Release Board, Waits on: adds a "Needs:" line to a document, or takes one out, and puts the
// document back byte for byte on Undo. The page never names a path: the caller resolves the
// document and its target against the model the page was drawn from.

// One document of a project, by project id and project-relative path.
export interface DocRef {
  project: string;
  path: string;
}

export type NeedsChange = { kind: "add"; target: string; to: DocRef } | { kind: "remove"; target: string };

// What a write replaced, as bytes: Undo puts `before` back, and only while the file still holds `after`.
export interface DocSnapshot {
  uri: vscode.Uri;
  // The project folder and the document's path in it, for the symbolic link check on Undo.
  root: vscode.Uri;
  path: string;
  before: Uint8Array;
  after: Uint8Array;
}

const same = (a: Uint8Array, b: Uint8Array): boolean => Buffer.compare(a, b) === 0;

// The document's file, or undefined (with a message) when its project is not known.
function docUri(run: BoardRun, doc: DocRef): vscode.Uri | undefined {
  const def = run.cfg.projects.find((p) => p.id === doc.project);
  if (!def || def.path === "") {
    void vscode.window.showWarningMessage(l10n("releaseBoard.needs.noProject", { project: doc.project }));
    return undefined;
  }
  return vscode.Uri.joinPath(vscode.Uri.parse(def.path), ...doc.path.split("/"));
}

// True when the file or a folder above it (inside the project) is a symbolic link: a write would go through it.
async function linked(root: vscode.Uri, path: string): Promise<boolean> {
  const parts = path.split("/");
  for (let n = 1; n <= parts.length; n++) {
    if (await isLink(vscode.Uri.joinPath(root, ...parts.slice(0, n)))) {
      return true;
    }
  }
  return false;
}

// Reads the document, or says why it was left alone.
async function readDoc(uri: vscode.Uri, root: vscode.Uri, name: string): Promise<{ bytes: Uint8Array; text: string } | undefined> {
  if (hasUnsavedCopy(uri)) {
    void vscode.window.showWarningMessage(l10n("releaseBoard.needs.unsaved", { file: name }));
    return undefined;
  }
  if (await linked(root, name)) {
    void vscode.window.showWarningMessage(l10n("releaseBoard.needs.symlink", { file: name }));
    return undefined;
  }
  if (!(await pathExists(uri))) {
    void vscode.window.showWarningMessage(l10n("releaseBoard.needs.gone", { file: name }));
    return undefined;
  }
  const bytes = await vscode.workspace.fs.readFile(uri);
  const text = decodeRules(bytes);
  if (text === undefined) {
    void vscode.window.showWarningMessage(l10n("releaseBoard.needs.encoding", { file: name }));
    return undefined;
  }
  return { bytes, text };
}

// Adds or removes one Needs line in a document at once, with no dialog: no unsaved copy open, no
// symbolic link, strict UTF-8, the target still there, and a second read just before the write.
// Returns what the file held before (for Undo), or undefined when nothing was written.
export async function changeNeeds(run: BoardRun, doc: DocRef, change: NeedsChange): Promise<DocSnapshot | undefined> {
  const uri = docUri(run, doc);
  const def = run.cfg.projects.find((p) => p.id === doc.project);
  if (!uri || !def) {
    return undefined;
  }
  const root = vscode.Uri.parse(def.path);
  const first = await readDoc(uri, root, doc.path);
  if (!first) {
    return undefined;
  }
  if (change.kind === "add") {
    const to = docUri(run, change.to);
    if (!to || !(await pathExists(to))) {
      void vscode.window.showWarningMessage(l10n("releaseBoard.needs.missing", { target: change.target }));
      return undefined;
    }
  }
  const edit = change.kind === "add" ? addNeed(first.text, change.target, doc.path) : removeNeed(first.text, change.target, doc.path);
  if (!edit.ok) {
    void vscode.window.showWarningMessage(l10n("releaseBoard.needs." + edit.reason, { file: doc.path, target: change.target }));
    return undefined;
  }
  // The file is read again just before the write: a change made meanwhile wins.
  const again = await readDoc(uri, root, doc.path);
  if (!again || !same(again.bytes, first.bytes)) {
    if (again) {
      void vscode.window.showWarningMessage(l10n("releaseBoard.needs.changed", { file: doc.path }));
    }
    return undefined;
  }
  const after = Buffer.from(edit.text, "utf8");
  try {
    await vscode.workspace.fs.writeFile(uri, after);
  } catch (e) {
    void vscode.window.showErrorMessage(l10n("releaseBoard.needs.failed", { file: doc.path, error: e instanceof Error ? e.message : String(e) }));
    return undefined;
  }
  return { uri, root, path: doc.path, before: first.bytes, after };
}

// Puts a document back to what the change replaced, only while it still holds exactly what that
// change wrote, with the same checks as a write.
export async function undoDocWrite(s: DocSnapshot): Promise<boolean> {
  const name = s.uri.path.slice(s.uri.path.lastIndexOf("/") + 1);
  if (hasUnsavedCopy(s.uri)) {
    void vscode.window.showWarningMessage(l10n("releaseBoard.needs.unsaved", { file: name }));
    return false;
  }
  if (await linked(s.root, s.path)) {
    void vscode.window.showWarningMessage(l10n("releaseBoard.needs.symlink", { file: name }));
    return false;
  }
  if (!(await pathExists(s.uri)) || !same(await vscode.workspace.fs.readFile(s.uri), s.after)) {
    void vscode.window.showWarningMessage(l10n("releaseBoard.needs.undoChanged", { file: name }));
    return false;
  }
  try {
    await vscode.workspace.fs.writeFile(s.uri, s.before);
  } catch (e) {
    void vscode.window.showErrorMessage(l10n("releaseBoard.needs.failed", { file: name, error: e instanceof Error ? e.message : String(e) }));
    return false;
  }
  return true;
}
