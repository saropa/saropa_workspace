// Unit tests for resolving a command argument (tree row, plain shortcut, Uri, or
// nothing) into a shortcut, a path or a target Uri.

import { test } from "node:test";
import assert from "node:assert/strict";
import * as vscode from "vscode";
import { Uri } from "./_stub/vscode";
import {
  asShortcut,
  pathToCopy,
  editorTargetUri,
  targetUri,
  scopeFromAddGroupArg,
} from "../commands/shortcutArgResolution";
import type { ShortcutStore } from "../model/shortcutStore";
import type { Shortcut } from "../model/shortcut";

const sc = { id: "a", path: "src/a.ts", scope: "project" } as Shortcut;

test("asShortcut accepts a plain shortcut object and rejects look-alikes", () => {
  assert.equal(asShortcut(sc), sc);
  assert.equal(asShortcut({ id: "a" }), undefined);
  assert.equal(asShortcut({ scope: "project" }), undefined);
  assert.equal(asShortcut(null), undefined);
  assert.equal(asShortcut("a"), undefined);
  assert.equal(asShortcut(undefined), undefined);
});

test("pathToCopy uses a plain TreeItem's resource and ignores everything else", () => {
  const store = {} as ShortcutStore;
  const item = new vscode.TreeItem("x");
  assert.equal(pathToCopy(store, item), undefined);
  (item as unknown as { resourceUri: unknown }).resourceUri = Uri.file("/p/x.ts");
  assert.equal(pathToCopy(store, item), "/p/x.ts");
  assert.equal(pathToCopy(store, sc), undefined);
  assert.equal(pathToCopy(store, undefined), undefined);
});

test("editorTargetUri prefers an explicit Uri and otherwise falls back to the active editor", () => {
  const explicit = Uri.file("/p/e.ts") as unknown as vscode.Uri;
  assert.equal(editorTargetUri(explicit), explicit);
  assert.equal(editorTargetUri("not a uri"), undefined);
});

test("targetUri handles a Uri, a plain TreeItem and no argument", () => {
  const store = {} as ShortcutStore;
  const explicit = Uri.file("/p/e.ts") as unknown as vscode.Uri;
  assert.equal(targetUri(store, explicit), explicit);
  const item = new vscode.TreeItem("x");
  assert.equal(targetUri(store, item), undefined);
  const res = Uri.file("/p/r.ts") as unknown as vscode.Uri;
  (item as unknown as { resourceUri: unknown }).resourceUri = res;
  assert.equal(targetUri(store, item), res);
  assert.equal(targetUri(store, undefined), undefined);
});

test("scopeFromAddGroupArg defaults to the project scope", () => {
  assert.equal(scopeFromAddGroupArg(undefined), "project");
  assert.equal(scopeFromAddGroupArg({ group: "global" }), "project");
});
