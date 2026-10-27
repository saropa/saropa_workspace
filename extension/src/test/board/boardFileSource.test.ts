// The Release Board file source over workspace.fs, run against a real temp tree.

import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { pathExists, workspaceFileSource } from "../../commands/boardFileSource";

function tree(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "board-fs-"));
  fs.mkdirSync(path.join(dir, "docs", "deep"), { recursive: true });
  fs.writeFileSync(path.join(dir, "docs", "a.md"), "line1\nline2\nline3\n");
  fs.writeFileSync(path.join(dir, "docs", "skip.txt"), "x");
  fs.writeFileSync(path.join(dir, "docs", "deep", "b.md"), "bee");
  return dir;
}

test("pathExists tells a present path from a missing one", async () => {
  const dir = tree();
  assert.equal(await pathExists(vscode.Uri.file(dir)), true);
  assert.equal(await pathExists(vscode.Uri.file(path.join(dir, "nope"))), false);
});

test("list walks nested folders and keeps only accepted files", async () => {
  const dir = tree();
  const files = await workspaceFileSource().list(dir, "docs", (p) => p.endsWith(".md"));
  assert.deepEqual(files.map((f) => f.path).sort(), ["docs/a.md", "docs/deep/b.md"]);
  assert.equal(files.find((f) => f.path === "docs/deep/b.md")?.size, 3);
});

test("list takes every file when nothing filters", async () => {
  const files = await workspaceFileSource().list(tree(), "docs");
  assert.equal(files.length, 3);
});

test("a missing root throws, which the scanner reads as empty", async () => {
  await assert.rejects(workspaceFileSource().list(tree(), "absent"));
});

test("readHead cuts to the first lines and readText returns the whole file", async () => {
  const dir = tree();
  const src = workspaceFileSource();
  assert.equal(await src.readHead!(dir, "docs/a.md", 2), "line1\nline2");
  assert.equal(await src.readText!(dir, "docs/deep/b.md"), "bee");
});

test("list never follows a link: a linked folder and a linked file are left out", async () => {
  const dir = tree();
  const real = vscode.workspace.fs;
  const original = real.readDirectory.bind(real);
  // The listing of "docs" also reports a linked folder that does not exist: following it would fail the walk.
  (real as { readDirectory: typeof real.readDirectory }).readDirectory = async (uri) => {
    const list = await original(uri);
    return uri.fsPath.endsWith("docs") ? [...list, ["loop", vscode.FileType.Directory | vscode.FileType.SymbolicLink], ["out.md", vscode.FileType.File | vscode.FileType.SymbolicLink]] : list;
  };
  try {
    const files = await workspaceFileSource().list(dir, "docs", (p) => p.endsWith(".md"));
    assert.deepEqual(files.map((f) => f.path).sort(), ["docs/a.md", "docs/deep/b.md"]);
  } finally {
    (real as { readDirectory: typeof real.readDirectory }).readDirectory = original;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
