// Tests for the value types of the vscode stub that hundreds of other tests rely on:
// if Uri or EventEmitter drift from the real contract, those tests lie.

import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter, FileType, QuickPickItemKind, RelativePattern, TabInputText, TreeItem, TreeItemCollapsibleState, Uri } from "./vscodeTypes";

test("Uri.file echoes the path as fsPath and in toString", () => {
  const u = Uri.file("/p/a.ts");
  assert.deepEqual([u.scheme, u.fsPath, u.toString()], ["file", "/p/a.ts", "/p/a.ts"]);
});

test("Uri.parse reads the scheme, authority and path of a URL", () => {
  const u = Uri.parse("vscode-remote://host/dir/a.ts");
  assert.equal(u.scheme, "vscode-remote");
  assert.equal(u.authority, "host");
  assert.equal(u.path, "/dir/a.ts");
  assert.equal(u.toString(), "vscode-remote://host/dir/a.ts");
});

test("Uri.parse of a bare path is a file URI with no authority", () => {
  const u = Uri.parse("/just/a/path");
  assert.deepEqual([u.scheme, u.authority, u.path], ["file", "", "/just/a/path"]);
});

test("Uri.joinPath appends segments, collapses a trailing slash and resolves dots", () => {
  assert.equal(Uri.joinPath(Uri.file("/p/"), "a", "b.ts").fsPath, "/p/a/b.ts");
  assert.equal(Uri.joinPath(Uri.file("/p/a/b.ts"), "..", "c.ts").fsPath, "/p/a/c.ts");
  assert.equal(Uri.joinPath(Uri.file("/p"), "./x").fsPath, "/p/x");
});

test("EventEmitter notifies every listener, and a disposed listener hears nothing more", () => {
  const emitter = new EventEmitter<number>();
  const a: number[] = [];
  const b: number[] = [];
  const subA = emitter.event((n) => a.push(n));
  emitter.event((n) => b.push(n));
  emitter.fire(1);
  subA.dispose();
  emitter.fire(2);
  assert.deepEqual(a, [1]);
  assert.deepEqual(b, [1, 2]);
});

test("a listener that disposes itself mid-fire does not stop the others", () => {
  const emitter = new EventEmitter<void>();
  const calls: string[] = [];
  const self = emitter.event(() => {
    calls.push("first");
    self.dispose();
  });
  emitter.event(() => calls.push("second"));
  emitter.fire();
  emitter.fire();
  assert.deepEqual(calls, ["first", "second", "second"]);
});

test("disposing the emitter drops all listeners", () => {
  const emitter = new EventEmitter<void>();
  let calls = 0;
  emitter.event(() => void calls++);
  emitter.dispose();
  emitter.fire();
  assert.equal(calls, 0);
});

test("the numeric constants match VS Code", () => {
  assert.deepEqual([FileType.File, FileType.Directory, FileType.SymbolicLink], [1, 2, 64]);
  assert.deepEqual([TreeItemCollapsibleState.None, TreeItemCollapsibleState.Collapsed, TreeItemCollapsibleState.Expanded], [0, 1, 2]);
});

test("a tree item defaults to not collapsible and keeps its label", () => {
  const item = new TreeItem("row");
  assert.deepEqual([item.label, item.collapsibleState], ["row", 0]);
});

test("RelativePattern keeps its base folder and pattern", () => {
  const base = { uri: Uri.file("/p"), name: "p", index: 0 };
  const p = new RelativePattern(base, "**/*.md");
  assert.deepEqual([p.base, p.pattern], [base, "**/*.md"]);
});

test("Uri.from builds a uri from scheme and path, with an empty path by default", () => {
  const u = Uri.from({ scheme: "demo", path: "/a/b.log" });
  assert.deepEqual([u.scheme, u.fsPath, u.toString()], ["demo", "/a/b.log", "demo:/a/b.log"]);
  assert.equal(Uri.from({ scheme: "demo" }).toString(), "demo:");
});

test("TabInputText keeps the document uri", () => {
  const uri = Uri.file("/x.ts");
  assert.equal(new TabInputText(uri).uri, uri);
});

test("QuickPickItemKind matches VS Code's values", () => {
  assert.deepEqual([QuickPickItemKind.Separator, QuickPickItemKind.Default], [-1, 0]);
});
