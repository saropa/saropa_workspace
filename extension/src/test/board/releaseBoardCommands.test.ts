// Release Board commands: the checks that need no scan.

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as vscode from "vscode";
import { BoardConfig, ProjectDef } from "../../board/types";
import { canRunHealth, hasOutsideProject } from "../../commands/releaseBoardCommands";
import { stub } from "./hostHelpers";

afterEach(() => stub.__setWorkspaceFolders(undefined));

function cfg(...paths: string[]): BoardConfig {
  return { version: 1, ignore: [], ruleSets: {}, projects: paths.map((p, i): ProjectDef => ({ id: `p${i}`, path: p, roots: [], ruleSets: [] })) };
}

test("a project inside an open folder is not outside", () => {
  stub.__setWorkspaceFolders([{ uri: vscode.Uri.parse("file:///work/app"), name: "app", index: 0 }]);
  assert.equal(hasOutsideProject(cfg("file:///work/app", "file:///work/app/packages/ui")), false);
});

test("a project beside or above an open folder is outside, even with a shared name prefix", () => {
  stub.__setWorkspaceFolders([{ uri: vscode.Uri.parse("file:///work/app"), name: "app", index: 0 }]);
  assert.equal(hasOutsideProject(cfg("file:///work/app2")), true);
  assert.equal(hasOutsideProject(cfg("file:///work")), true);
});

test("with no folder open every project is outside", () => {
  assert.equal(hasOutsideProject(cfg("file:///work/app")), true);
});

test("before the board is registered no run can be started from it", () => {
  assert.equal(canRunHealth({ id: "a", path: "/a", roots: [], ruleSets: [], health: { tests: ["t"] } }, "tests"), false);
});
