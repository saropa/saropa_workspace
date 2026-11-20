// Bring back an AI reply: the check that a document is still the file the board read (changedOnDisk), which decides
// whether a proposed link may be written. Pure host layer: a real temp folder, a hand-built snapshot with fixed
// revisions, no clock.

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import defaultRules from "../../board/defaultRules.json";
import { BoardModel, buildBoard } from "../../board/boardModel";
import { checkPatch, targetsOf } from "../../board/patch";
import { readFacts } from "../../board/docFacts";
import { ScanSnapshot } from "../../board/scanner";
import { BoardConfig, Classified } from "../../board/types";
import { BoardRun } from "../../commands/boardScanStore";
import { changedOnDisk } from "../../commands/boardPatch";
import { stub, tmpDir } from "./hostHelpers";

afterEach(() => {
  stub.__setWorkspaceFolders(undefined);
});

// The board saw every document as modified at second 100 with 10 bytes, so its revision is "100-10". A file is
// "unchanged" only when it has exactly that modified second and size, which the helper below arranges.
const SNAP = { version: 1, takenAt: 0, projects: { app: { counts: {}, folders: {}, ruleCounts: {}, greyFolders: {}, files: {}, facts: Object.fromEntries(["a.md", "b.md", "c.md"].map((p) => [p, { mtimeMs: 100_000, size: 10, facts: readFacts(`# ${p}\n`, p) }])) } } } as unknown as ScanSnapshot;
const REV = "100-10";
const rows: Classified[] = ["a.md", "b.md", "c.md"].map((p) => ({ project: "app", path: p, status: "amber", kind: "owner action", note: "" }));

// Ten bytes, modified at second 100: the file the board read.
const TEN_BYTES = "0123456789";
function writeAsRead(file: string): void {
  fs.writeFileSync(file, TEN_BYTES);
  // utimes takes seconds; the revision floors the modified time to whole seconds.
  fs.utimesSync(file, 100, 100);
}

function setup(): { dir: string; run: BoardRun; model: BoardModel } {
  const dir = tmpDir();
  stub.__setWorkspaceFolders([{ uri: vscode.Uri.file(dir), name: "app", index: 0 }]);
  for (const f of ["a.md", "b.md", "c.md"]) {
    writeAsRead(path.join(dir, f));
  }
  const cfg: BoardConfig = { ...(defaultRules as unknown as BoardConfig), projects: [{ id: "app", name: "App", path: vscode.Uri.file(dir).toString(), roots: [], ruleSets: [] }] };
  const model = buildBoard(cfg, rows, undefined, true, SNAP, undefined, {}, {});
  return { dir, run: { cfg, result: { rows } } as unknown as BoardRun, model };
}

// Rows for a severity change on each named document, checked by the real patch check so they are what the board offers.
function rowsFor(model: BoardModel, names: string[]) {
  const text = JSON.stringify({ schema: "saropa.releaseBoard.patch/1", changes: names.map((n) => ({ rev: REV, op: "setSeverity", item: `app:${n}`, to: "low", reason: "test" })) });
  const checked = checkPatch(text, targetsOf(model), ["red", "amber", "green"]);
  assert.equal(checked.ok, true);
  return checked.ok ? checked.rows : [];
}

test("a document still holding the modified time and size the board read is not reported as changed", async () => {
  const { run, model } = setup();
  const changed = await changedOnDisk(run, targetsOf(model), rowsFor(model, ["a.md", "b.md"]));
  assert.deepEqual([...changed], []);
});

test("a document edited since the scan is reported by its id, and the untouched one is not", async () => {
  const { dir, run, model } = setup();
  // A different size is enough: the check compares the whole revision, not only the time.
  fs.writeFileSync(path.join(dir, "b.md"), TEN_BYTES + "!");
  fs.utimesSync(path.join(dir, "b.md"), 100, 100);
  const changed = await changedOnDisk(run, targetsOf(model), rowsFor(model, ["a.md", "b.md"]));
  assert.deepEqual([...changed], ["app:b.md"]);
});

test("a document touched with the same size but a later time is reported as changed", async () => {
  const { dir, run, model } = setup();
  fs.utimesSync(path.join(dir, "a.md"), 500, 500);
  const changed = await changedOnDisk(run, targetsOf(model), rowsFor(model, ["a.md"]));
  assert.deepEqual([...changed], ["app:a.md"]);
});

test("a document deleted since the scan is reported as changed rather than skipped", async () => {
  const { dir, run, model } = setup();
  fs.unlinkSync(path.join(dir, "c.md"));
  const changed = await changedOnDisk(run, targetsOf(model), rowsFor(model, ["a.md", "c.md"]));
  assert.deepEqual([...changed], ["app:c.md"]);
});

test("no rows means nothing to look at and no file is read", async () => {
  const { run, model } = setup();
  const changed = await changedOnDisk(run, targetsOf(model), []);
  assert.equal(changed.size, 0);
});

test("several rows on one document report it once", async () => {
  const { dir, run, model } = setup();
  fs.unlinkSync(path.join(dir, "a.md"));
  // The same checked row twice: the patch check may collapse duplicates, so the row is repeated by hand here.
  const [row] = rowsFor(model, ["a.md"]);
  const changed = await changedOnDisk(run, targetsOf(model), [row, row]);
  assert.deepEqual([...changed], ["app:a.md"]);
});

test("a row whose document the board does not know is reported as changed, so it is never written", async () => {
  const { run, model } = setup();
  const [known] = rowsFor(model, ["a.md"]);
  // The row is copied from a real one and pointed at an id the model never had, as a stale list could after a rescan.
  const ghost = { ...known, change: { ...known.change, item: "app:ghost.md" } };
  const changed = await changedOnDisk(run, targetsOf(model), [ghost]);
  assert.deepEqual([...changed], ["app:ghost.md"]);
});

test("a document that is a symbolic link to a file outside the project is reported as changed", { skip: process.platform === "win32" }, async () => {
  const { dir, run, model } = setup();
  const outside = path.join(tmpDir(), "outside.md");
  writeAsRead(outside);
  fs.unlinkSync(path.join(dir, "b.md"));
  fs.symlinkSync(outside, path.join(dir, "b.md"));
  // The outside file even has the matching revision: the guard is the path, not the numbers.
  const changed = await changedOnDisk(run, targetsOf(model), rowsFor(model, ["b.md"]));
  assert.deepEqual([...changed], ["app:b.md"]);
});
