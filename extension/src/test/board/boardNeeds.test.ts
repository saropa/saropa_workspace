// Waits on: a Needs line added to or taken out of a document in the project, with Undo that puts the
// document back byte for byte, and every refusal leaving the file untouched.

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import defaultRules from "../../board/defaultRules.json";
import { BoardConfig } from "../../board/types";
import { BoardRun } from "../../commands/boardScanStore";
import { changeNeeds, undoDocWrite } from "../../commands/boardNeeds";
import { stub, tmpDir } from "./hostHelpers";

const docsOpen = vscode.workspace.textDocuments as unknown as Array<{ isDirty: boolean; uri: vscode.Uri }>;

afterEach(() => {
  stub.__resetWarnings();
  docsOpen.length = 0;
});

const doc = { project: "app", path: "docs/A.md" };
const add = { kind: "add", target: "docs/B.md", to: { project: "app", path: "docs/B.md" } } as const;

function setup(text: string | Buffer = "# A\n\nbody\n"): { dir: string; file: string; run: BoardRun } {
  const dir = tmpDir();
  fs.mkdirSync(path.join(dir, "docs"));
  fs.writeFileSync(path.join(dir, "docs", "A.md"), text);
  fs.writeFileSync(path.join(dir, "docs", "B.md"), "# B\n");
  const cfg: BoardConfig = { ...(defaultRules as unknown as BoardConfig), projects: [{ id: "app", name: "App", path: vscode.Uri.file(dir).toString(), roots: ["docs"], ruleSets: [] }] };
  return { dir, file: path.join(dir, "docs", "A.md"), run: { cfg, result: { rows: [] } } as unknown as BoardRun };
}

test("a link is added at once and Undo puts the document back exactly", async () => {
  const original = "# A\r\n\r\nbody\r\nmore";
  const { file, run } = setup(original);
  const snap = await changeNeeds(run, doc, add);
  assert.equal(fs.readFileSync(file, "utf8"), "# A\r\n\r\nNeeds: docs/B.md\r\n\r\nbody\r\nmore");
  assert.equal(await undoDocWrite(snap!), true);
  assert.deepEqual(fs.readFileSync(file), Buffer.from(original));
});

test("a link is taken out and Undo brings it back", async () => {
  const original = "# A\n\nNeeds: docs/B.md, docs/C.md\n\nbody\n";
  const { file, run } = setup(original);
  const snap = await changeNeeds(run, doc, { kind: "remove", target: "docs/B.md" });
  assert.equal(fs.readFileSync(file, "utf8"), "# A\n\nNeeds: docs/C.md\n\nbody\n");
  assert.equal(await undoDocWrite(snap!), true);
  assert.equal(fs.readFileSync(file, "utf8"), original);
});

test("a target that is gone, one already named and one not in the document are refused untouched", async () => {
  const { file, run } = setup("# A\n\nNeeds: docs/B.md\n");
  assert.equal(await changeNeeds(run, doc, { ...add, target: "docs/D.md", to: { project: "app", path: "docs/D.md" } }), undefined);
  assert.ok(stub.__warningMessages().some((m) => m.includes("no longer exists")));
  assert.equal(await changeNeeds(run, doc, add), undefined);
  assert.equal(await changeNeeds(run, doc, { kind: "remove", target: "docs/Z.md" }), undefined);
  assert.equal(fs.readFileSync(file, "utf8"), "# A\n\nNeeds: docs/B.md\n");
  fs.rmSync(file);
  assert.equal(await changeNeeds(run, doc, add), undefined, "the waiting document itself is gone");
});

test("a change made while the write was being prepared wins", async () => {
  const { file, run } = setup();
  const fsApi = vscode.workspace.fs as unknown as { readFile: (u: vscode.Uri) => Promise<Uint8Array> };
  const real = fsApi.readFile;
  let reads = 0;
  fsApi.readFile = async (u) => {
    const bytes = await real.call(fsApi, u);
    if (u.fsPath === file && ++reads === 1) {
      fs.writeFileSync(file, "# A\n\nedited by hand\n");
    }
    return bytes;
  };
  try {
    assert.equal(await changeNeeds(run, doc, add), undefined);
  } finally {
    fsApi.readFile = real;
  }
  assert.equal(fs.readFileSync(file, "utf8"), "# A\n\nedited by hand\n");
  assert.ok(stub.__warningMessages().some((m) => m.includes("changed while you were choosing")));
});

test("unsaved edits, a symbolic link, a symlinked folder and a non-UTF-8 file are refused untouched", async () => {
  const { dir, file, run } = setup();
  docsOpen.push({ isDirty: true, uri: vscode.Uri.file(file) });
  assert.equal(await changeNeeds(run, doc, add), undefined);
  docsOpen.length = 0;
  fs.writeFileSync(file, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("# A\n")]));
  assert.equal(await changeNeeds(run, doc, add), undefined, "a byte order mark is not plain UTF-8");
  fs.writeFileSync(file, Buffer.from([0x23, 0xff, 0x0a]));
  assert.equal(await changeNeeds(run, doc, add), undefined);
  assert.deepEqual(fs.readFileSync(file), Buffer.from([0x23, 0xff, 0x0a]));
  const real = path.join(dir, "elsewhere.md");
  fs.writeFileSync(real, "# A\n");
  fs.rmSync(file);
  fs.symlinkSync(real, file);
  assert.equal(await changeNeeds(run, doc, add), undefined);
  assert.equal(fs.readFileSync(real, "utf8"), "# A\n");
  const out = path.join(dir, "outside");
  fs.mkdirSync(out);
  fs.writeFileSync(path.join(out, "A.md"), "# A\n");
  fs.writeFileSync(path.join(out, "B.md"), "# B\n");
  fs.rmSync(path.join(dir, "docs"), { recursive: true });
  fs.symlinkSync(out, path.join(dir, "docs"));
  assert.equal(await changeNeeds(run, doc, add), undefined);
  assert.equal(fs.readFileSync(path.join(out, "A.md"), "utf8"), "# A\n");
});

test("Undo leaves a document alone that changed after the edit, or is open with unsaved edits", async () => {
  const { file, run } = setup();
  const snap = await changeNeeds(run, doc, add);
  docsOpen.push({ isDirty: true, uri: vscode.Uri.file(file) });
  assert.equal(await undoDocWrite(snap!), false);
  docsOpen.length = 0;
  fs.appendFileSync(file, "typed later\n");
  assert.equal(await undoDocWrite(snap!), false);
  assert.ok(stub.__warningMessages().some((m) => m.includes("changed after that edit")));
  assert.match(fs.readFileSync(file, "utf8"), /typed later/);
  fs.rmSync(file);
  assert.equal(await undoDocWrite(snap!), false, "a deleted document is not brought back");
});

test("a project that is not on the board gets no change", async () => {
  const { run } = setup();
  assert.equal(await changeNeeds(run, { project: "nope", path: "docs/A.md" }, add), undefined);
});
