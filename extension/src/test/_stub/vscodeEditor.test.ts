import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as nodeFs from "node:fs";
import * as os from "node:os";
import * as nodePath from "node:path";
import * as vscode from "./vscode";

let dir: string;

beforeEach(() => {
  dir = nodeFs.mkdtempSync(nodePath.join(os.tmpdir(), "sw-editor-"));
  vscode.__resetOpenedDocuments();
});

afterEach(() => {
  vscode.__resetOpenedDocuments();
  nodeFs.rmSync(dir, { recursive: true, force: true });
});

test("Range takes positions or four numbers, and a Selection keeps its anchor and active end", () => {
  const a = new vscode.Position(1, 2);
  const b = new vscode.Position(3, 4);
  const fromPositions = new vscode.Range(a, b);
  const fromNumbers = new vscode.Range(1, 2, 3, 4);
  assert.deepEqual([fromPositions.start, fromPositions.end], [a, b]);
  assert.deepEqual([fromNumbers.start, fromNumbers.end], [a, b]);
  const sel = new vscode.Selection(a, b);
  assert.deepEqual([sel.anchor, sel.active, sel.start, sel.end], [a, b, a, b]);
});

test("showTextDocument returns an editor over the file's lines and logs the path", async () => {
  const file = nodePath.join(dir, "log.txt");
  nodeFs.writeFileSync(file, "one\ntwo\nthree");
  const editor = await vscode.window.showTextDocument(vscode.Uri.file(file), { viewColumn: 2 });
  assert.equal(editor.document.lineCount, 3);
  assert.equal(editor.document.lineAt(1).text, "two");
  assert.deepEqual(editor.document.lineAt(2).range.end, new vscode.Position(2, 5));
  assert.equal(editor.document.getText(), "one\ntwo\nthree");
  assert.equal(editor.viewColumn, 2);
  assert.deepEqual(vscode.__openedDocuments(), [file]);
  assert.equal(vscode.__shownEditors()[0], editor);
  assert.throws(() => editor.document.lineAt(9), /no line 9/);
});

test("a document wrapper is accepted and a missing file reads as one empty line", async () => {
  const uri = vscode.Uri.file(nodePath.join(dir, "nope.txt"));
  const editor = await vscode.window.showTextDocument({ uri });
  assert.equal(editor.document.lineCount, 1);
  assert.equal(editor.document.lineAt(0).text, "");
});

test("reveals and decorations are recorded on the editor", async () => {
  const editor = await vscode.window.showTextDocument(vscode.Uri.file(nodePath.join(dir, "x")));
  const r = new vscode.Range(0, 0, 0, 0);
  editor.revealRange(r, vscode.TextEditorRevealType.InCenter);
  editor.setDecorations("deco", [r]);
  editor.setDecorations("deco", []);
  assert.deepEqual(editor.reveals, [{ range: r, type: 1 }]);
  assert.deepEqual(editor.decorations.map((d) => d.ranges.length), [1, 0]);
});

test("visibleTextEditors is the array set by the hook and cleared by the reset", async () => {
  const editor = await vscode.window.showTextDocument(vscode.Uri.file(nodePath.join(dir, "x")));
  vscode.__setVisibleEditors([editor]);
  assert.deepEqual(vscode.window.visibleTextEditors, [editor]);
  vscode.__resetOpenedDocuments();
  assert.deepEqual(vscode.window.visibleTextEditors, []);
  assert.deepEqual(vscode.__shownEditors(), []);
});
