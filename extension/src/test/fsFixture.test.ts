import { test } from "node:test";
import assert from "node:assert/strict";
import * as nodeFs from "node:fs";
import { workspace } from "./_stub/vscode";
import { createFsFixture } from "./fsFixture";

test("the fixture is an open workspace folder and writes nested files", () => {
  const fx = createFsFixture("sw-fsfixture-");
  try {
    fx.write("a/b/c.txt", "hello");
    fx.write("empty.txt");
    assert.equal(nodeFs.readFileSync(`${fx.dir}/a/b/c.txt`, "utf8"), "hello");
    assert.equal(nodeFs.readFileSync(`${fx.dir}/empty.txt`, "utf8"), "");
    assert.equal(workspace.workspaceFolders?.[0].uri.fsPath, fx.dir);
    assert.equal(fx.folder.uri.fsPath, fx.dir);
  } finally {
    fx.remove();
  }
});

test("remove deletes the folder and closes the workspace", () => {
  const fx = createFsFixture("sw-fsfixture-");
  fx.remove();
  assert.equal(nodeFs.existsSync(fx.dir), false);
  assert.equal(workspace.workspaceFolders, undefined);
});
