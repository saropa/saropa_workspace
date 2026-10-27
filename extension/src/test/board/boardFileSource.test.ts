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

// Makes the listing of "docs" also report the given extra entries.
function withExtraEntries(extra: Array<[string, number]>): () => void {
  const real = vscode.workspace.fs;
  const original = real.readDirectory.bind(real);
  (real as { readDirectory: typeof real.readDirectory }).readDirectory = async (uri) => {
    const list = await original(uri);
    return uri.fsPath.endsWith("docs") ? [...list.filter(([n]) => !extra.some(([e]) => e === n)), ...extra] : list;
  };
  return () => {
    (real as { readDirectory: typeof real.readDirectory }).readDirectory = original;
  };
}

test("for a chosen project list skips links: a linked folder and a linked file are left out", async () => {
  const dir = tree();
  fs.writeFileSync(path.join(dir, "docs", "alias.md"), "a");
  // "loop" does not exist: following it would fail the walk.
  const restore = withExtraEntries([["loop", vscode.FileType.Directory | vscode.FileType.SymbolicLink], ["alias.md", vscode.FileType.File | vscode.FileType.SymbolicLink]]);
  try {
    const files = await workspaceFileSource().list(dir, "docs", (p) => p.endsWith(".md"), true);
    assert.deepEqual(files.map((f) => f.path).sort(), ["docs/a.md", "docs/deep/b.md"]);
  } finally {
    restore();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("for an open project a linked file is read as before", async () => {
  const dir = tree();
  fs.writeFileSync(path.join(dir, "docs", "alias.md"), "a");
  const restore = withExtraEntries([["alias.md", vscode.FileType.File | vscode.FileType.SymbolicLink]]);
  try {
    const files = await workspaceFileSource().list(dir, "docs", (p) => p.endsWith(".md"));
    assert.deepEqual(files.map((f) => f.path).sort(), ["docs/a.md", "docs/alias.md", "docs/deep/b.md"]);
  } finally {
    restore();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
