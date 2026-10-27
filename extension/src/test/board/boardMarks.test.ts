// Hand marks host side: the local file round-trips, writes queue up, the shared file sits
// under the local one, and a file is placed in its project by path.

import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { markKey, setMark } from "../../board/marks";
import { BoardConfig } from "../../board/types";
import { SHARED_FILE, exportMarksCommand, locate, readLocalMarks, readMarks, updateLocalMarks } from "../../commands/boardMarks";
import { contextIn, stub, tmpDir } from "./hostHelpers";

function cfg(...paths: string[]): BoardConfig {
  return { version: 1, ignore: [], ruleSets: {}, projects: paths.map((p, i) => ({ id: `p${i}`, path: p, roots: [], ruleSets: [] })) };
}

test("a file is placed by its folder, with the path decoded", () => {
  const found = locate(cfg("file:///work/app"), vscode.Uri.parse("file:///work/app/docs/a%20b.md"));
  assert.deepEqual(found, { project: "p0", path: "docs/a b.md" });
});

test("a file outside every project is not placed", () => {
  assert.equal(locate(cfg("file:///work/app"), vscode.Uri.parse("file:///other/x.md")), undefined);
});

test("a folder that only shares a name prefix is not the project", () => {
  assert.equal(locate(cfg("file:///work/app"), vscode.Uri.parse("file:///work/app2/x.md")), undefined);
});

test("there are no marks before any is written", async () => {
  const marks = await readLocalMarks(contextIn(tmpDir()));
  assert.deepEqual(marks.marks, {});
});

test("changes queue: two quick updates both land", async () => {
  const ctx = contextIn(tmpDir());
  await Promise.all([
    updateLocalMarks(ctx, (f) => setMark(f, markKey("app", "a.md"), { pinned: true })),
    updateLocalMarks(ctx, (f) => setMark(f, markKey("app", "b.md"), { inProgress: true })),
  ]);
  const marks = (await readLocalMarks(ctx)).marks;
  assert.equal(marks["app/a.md"]?.pinned, true);
  assert.equal(marks["app/b.md"]?.inProgress, true);
});

test("the local mark wins over the shared one for the same document", async () => {
  const dir = tmpDir();
  const ctx = contextIn(dir);
  fs.mkdirSync(path.join(dir, ".saropa"));
  fs.writeFileSync(path.join(dir, SHARED_FILE), JSON.stringify({ version: 1, marks: { "app/a.md": { pinned: true }, "app/c.md": { pinned: true } } }));
  stub.__setWorkspaceFolders([{ uri: vscode.Uri.file(dir), name: "app", index: 0 }]);
  try {
    await updateLocalMarks(ctx, (f) => setMark(f, markKey("app", "a.md"), { pinned: false, inProgress: true }));
    const merged = (await readMarks(ctx)).marks;
    assert.equal(merged["app/a.md"]?.inProgress, true);
    assert.equal(merged["app/a.md"]?.pinned, undefined);
    assert.equal(merged["app/c.md"]?.pinned, true);
  } finally {
    stub.__setWorkspaceFolders(undefined);
  }
});

test("export writes only marks that are switched on", async () => {
  const dir = tmpDir();
  const ctx = contextIn(tmpDir());
  stub.__setWorkspaceFolders([{ uri: vscode.Uri.file(dir), name: "app", index: 0 }]);
  try {
    await updateLocalMarks(ctx, (f) => setMark(f, markKey("app", "a.md"), { pinned: true }));
    await exportMarksCommand(ctx);
    const written = JSON.parse(fs.readFileSync(path.join(dir, SHARED_FILE), "utf8"));
    assert.deepEqual(Object.keys(written.marks), ["app/a.md"]);
  } finally {
    stub.__setWorkspaceFolders(undefined);
  }
});
