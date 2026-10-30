// Bring back an AI reply, host layer: applying the ticked rows in one batch with one Undo, the
// rows that cannot be written, and the watcher that picks up result files.

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import defaultRules from "../../board/defaultRules.json";
import { BoardModel, buildBoard } from "../../board/boardModel";
import { checkPatch, targetsOf } from "../../board/patch";
import { BoardConfig, Classified } from "../../board/types";
import { BoardRun } from "../../commands/boardScanStore";
import { applyRows, readResultFile, undoBatch, watchResults } from "../../commands/boardPatch";
import { BoardPatches } from "../../views/boardPatches";
import { stub, tmpDir } from "./hostHelpers";

const vs = vscode as unknown as { __fileWatchers(): Array<{ created: { fire(u: unknown): void }; changed: { fire(u: unknown): void } }>; __resetHosts(): void; __resetWarnings(): void };

afterEach(() => {
  vs.__resetHosts();
  stub.__resetWarnings();
  stub.__setWorkspaceFolders(undefined);
});

const rows: Classified[] = ["a.md", "b.md", "c.md"].map((p) => ({ project: "app", path: p, status: "amber", kind: "owner action", note: "" }));

function setup(): { dir: string; run: BoardRun; model: BoardModel; rules: string } {
  const dir = tmpDir();
  stub.__setWorkspaceFolders([{ uri: vscode.Uri.file(dir), name: "app", index: 0 }]);
  fs.writeFileSync(path.join(dir, "a.md"), "# A\n\nBody\n");
  fs.writeFileSync(path.join(dir, "b.md"), "# B\n\nNeeds: a.md\nBody\n");
  fs.writeFileSync(path.join(dir, "c.md"), "# C\n");
  const cfg: BoardConfig = { ...(defaultRules as unknown as BoardConfig), projects: [{ id: "app", name: "App", path: vscode.Uri.file(dir).toString(), roots: [], ruleSets: [] }] };
  const model = buildBoard(cfg, rows, undefined, true, undefined, undefined, {}, { needs: { "app/b.md": ["a.md"] } });
  return { dir, run: { cfg, result: { rows } } as unknown as BoardRun, model, rules: path.join(dir, ".saropa", "release-board.json") };
}

const statuses = ["red", "amber", "green"];
const rowsOf = (model: BoardModel, changes: unknown[]) => {
  const c = checkPatch(JSON.stringify({ schema: "saropa.releaseBoard.patch/1", changes }), targetsOf(model), statuses);
  assert.equal(c.ok, true);
  return c.ok ? c.rows : [];
};
const read = (dir: string, name: string): string => fs.readFileSync(path.join(dir, name), "utf8");

const ALL = [
  { op: "setStatus", item: "app:a.md", to: "green", reason: "done" },
  { op: "setSeverity", item: "app:a.md", to: "low", reason: "cosmetic" },
  { op: "setGroup", item: "app:a.md", group: "Launch", reason: "belongs" },
  { op: "setGroup", item: "app:b.md", group: "Launch", reason: "belongs" },
  { op: "addNeeds", item: "app:c.md", on: "app:a.md", reason: "needs it" },
  { op: "removeNeeds", item: "app:b.md", on: "app:a.md", reason: "finished" },
];

test("a batch writes the rules file once and each Needs document once, and one Undo restores every file exactly", async () => {
  const { dir, run, model, rules } = setup();
  const before = { a: read(dir, "a.md"), b: read(dir, "b.md"), c: read(dir, "c.md") };
  const out = await applyRows(run, model, rowsOf(model, ALL));
  assert.equal(out.applied, 6);
  assert.equal(out.skipped, 0);
  const written = JSON.parse(fs.readFileSync(rules, "utf8"));
  assert.deepEqual(written.groups, [{ name: "Launch", match: ["app/a.md", "app/b.md"] }]);
  assert.deepEqual(written.severityOverrides, [{ project: "app", path: "a.md", severity: "low" }]);
  assert.equal(written.ruleSets["my-overrides"].rules[0].set.status, "green");
  assert.equal(read(dir, "c.md"), "# C\n\nNeeds: a.md\n");
  assert.equal(read(dir, "b.md"), "# B\n\nBody\n");
  assert.equal(read(dir, "a.md"), before.a);
  assert.equal(out.snapshot.docs.length, 2);

  assert.equal(await undoBatch(out.snapshot), true);
  assert.equal(fs.existsSync(rules), false, "the rules file the batch created is removed");
  assert.deepEqual({ a: read(dir, "a.md"), b: read(dir, "b.md"), c: read(dir, "c.md") }, before);
});

test("a row that cannot be written is skipped and counted, and the others still apply", async () => {
  const { dir, run, model } = setup();
  fs.unlinkSync(path.join(dir, "c.md"));
  const out = await applyRows(run, model, rowsOf(model, [ALL[1], ALL[4], { op: "removeNeeds", item: "app:b.md", on: "app:a.md", reason: "x" }]));
  assert.equal(out.applied, 2);
  assert.equal(out.skipped, 1);
  assert.equal(out.snapshot.docs.length, 1);
});

test("nothing is written for rows that were not passed in", async () => {
  const { dir, run, model, rules } = setup();
  const out = await applyRows(run, model, []);
  assert.deepEqual([out.applied, out.skipped, fs.existsSync(rules)], [0, 0, false]);
  assert.equal(read(dir, "b.md"), "# B\n\nNeeds: a.md\nBody\n");
});

test("Undo leaves everything alone when a document changed after the batch", async () => {
  const { dir, run, model, rules } = setup();
  const out = await applyRows(run, model, rowsOf(model, [ALL[1], ALL[4]]));
  fs.writeFileSync(path.join(dir, "c.md"), "edited by hand\n");
  const rulesText = fs.readFileSync(rules, "utf8");
  assert.equal(await undoBatch(out.snapshot), false);
  assert.equal(fs.readFileSync(rules, "utf8"), rulesText);
  assert.equal(read(dir, "c.md"), "edited by hand\n");
});

test("a document that is not plain UTF-8 is not rewritten", async () => {
  const { dir, run, model } = setup();
  const bom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("# C\n")]);
  fs.writeFileSync(path.join(dir, "c.md"), bom);
  const out = await applyRows(run, model, rowsOf(model, [ALL[4]]));
  assert.equal(out.applied, 0);
  assert.deepEqual(fs.readFileSync(path.join(dir, "c.md")), bom);
});

const handoffDir = (dir: string): string => path.join(dir, ".saropa", "handoff");
function put(dir: string, name: string, text: string): vscode.Uri {
  fs.mkdirSync(handoffDir(dir), { recursive: true });
  fs.writeFileSync(path.join(handoffDir(dir), name), text);
  return vscode.Uri.file(path.join(handoffDir(dir), name));
}
const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const patchText = (changes: unknown[]): string => JSON.stringify({ schema: "saropa.releaseBoard.patch/1", changes });

test("a result file is read only from a project's hand-off folder, by a safe name, within the size limit", async () => {
  const { dir } = setup();
  const roots = [vscode.Uri.file(dir)];
  assert.equal(await readResultFile(put(dir, "x.result.json", "{}"), roots), "{}");
  assert.equal(await readResultFile(put(dir, "x.json", "{}"), roots), undefined, "not a result name");
  assert.equal(await readResultFile(put(dir, "a b.result.json", "{}"), roots), undefined, "unsafe name");
  assert.equal(await readResultFile(put(dir, "big.result.json", "x".repeat(300_000)), roots), undefined, "too large");
  assert.equal(await readResultFile(put(dir, "bom.result.json", "﻿{}"), roots), undefined, "not plain UTF-8");
  fs.writeFileSync(path.join(dir, "y.result.json"), "{}");
  assert.equal(await readResultFile(vscode.Uri.file(path.join(dir, "y.result.json")), roots), undefined, "outside the hand-off folder");
  assert.equal(await readResultFile(put(dir, "x.result.json", "{}"), [vscode.Uri.file(tmpDir())]), undefined, "another project's folder");
});

test("the watcher passes on a new or changed result file and ignores other files", async () => {
  const { dir } = setup();
  const seen: string[] = [];
  watchResults(() => [vscode.Uri.file(dir)], (_t, name) => seen.push(name));
  const w = vs.__fileWatchers()[0];
  w.created.fire(put(dir, "one.result.json", "{}"));
  w.changed.fire(put(dir, "two.result.json", "{}"));
  w.created.fire(put(dir, "notes.md", "text"));
  w.created.fire(put(dir, "three.json", "{}"));
  await wait(60);
  assert.deepEqual(seen.sort(), ["one.result.json", "two.result.json"]);
});

test("the board keeps a result file only when it offers a change, and ignores junk", async () => {
  const { dir, run, model } = setup();
  let changed = 0;
  const patches = new BoardPatches(() => ({ model, run }), () => undefined, () => changed++);
  patches.watch();
  const w = vs.__fileWatchers()[0];
  for (const junk of ["not json", "[]", patchText([]), patchText([{ op: "setStatus", item: "app:gone.md", to: "green", reason: "x" }]), patchText([{ op: "setImportance", item: "app:a.md", to: "high", reason: "x" }])]) {
    w.created.fire(put(dir, "junk.result.json", junk));
    await wait(40);
  }
  assert.deepEqual([patches.view(), changed], [{}, 0]);
  w.created.fire(put(dir, "good.result.json", patchText([ALL[0], ALL[1], { op: "setGroup", item: "app:a.md", group: "Z", reason: "stale", rev: "1-1" }])));
  await wait(60);
  assert.deepEqual([patches.view(), changed], [{ patchReady: 2 }, 1], "the stale change is not counted");
  patches.clear();
  assert.deepEqual([patches.view(), changed], [{}, 2]);
});

test("pick returns only ticked rows the board still offers, never a stale or unknown one", () => {
  const { run, model } = setup();
  const posted: Array<{ rows: unknown[] }> = [];
  let now = model;
  const patches = new BoardPatches(() => ({ model: now, run }), (m) => posted.push(m as { rows: unknown[] }), () => undefined);
  patches.read(patchText([ALL[0], ALL[1], { op: "setSeverity", item: "app:b.md", to: "low", reason: "x", rev: "9-9" }]), "paste");
  assert.equal(posted[0].rows.length, 3);
  assert.deepEqual(patches.pick([0, 0, 1, 2, 7, -1])?.rows.map((r) => r.change.op + r.change.item), ["setStatusapp:a.md", "setSeverityapp:a.md"]);
  // The board moved on: a.md is green now, so that change is no longer offered.
  now = buildBoard(run.cfg, [{ ...rows[0], status: "green" }, rows[1], rows[2]], undefined, true, undefined, undefined, {}, {});
  assert.deepEqual(patches.pick([0, 1])?.rows.map((r) => r.change.op), []);
  patches.read("garbage", "paste");
  assert.equal(patches.pick([0]), undefined);
  assert.match(String((posted[1] as { error?: string }).error), /No patch found/);
});
