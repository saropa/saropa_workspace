// Bring back an AI reply, host layer: applying the ticked rows in one batch with one Undo, the
// rows that cannot be written, and the watcher that picks up result files.

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import defaultRules from "../../board/defaultRules.json";
import { BoardModel, buildBoard } from "../../board/boardModel";
import { checkPatch, extractPatch, targetsOf } from "../../board/patch";
import { BoardConfig, Classified } from "../../board/types";
import { ScanSnapshot } from "../../board/scanner";
import { readFacts } from "../../board/docFacts";
import { BoardRun } from "../../commands/boardScanStore";
import { buildHandoff, fromModel } from "../../board/handoff";
import { applyRuleRow } from "../../board/patchApply";
import { changeDoc } from "../../commands/boardRuleAssign";
import { l10n } from "../../i18n/l10n";
import { busyMessage, UNDO_PENDING } from "../../views/boardBusy";
import { applyRows, plainWriteError, hasUnsavedEdits, readResultFile, remainingFiles, realInside, savePastedPatch, undoBatch, watchResults } from "../../commands/boardPatch";
import { BoardPatches } from "../../views/boardPatches";
import { stub, tmpDir } from "./hostHelpers";

const vs = vscode as unknown as { __fileWatchers(): Array<{ created: { fire(u: unknown): void }; changed: { fire(u: unknown): void } }>; __resetHosts(): void; __resetWarnings(): void };

afterEach(() => {
  vs.__resetHosts();
  stub.__resetWarnings();
  stub.__setWorkspaceFolders(undefined);
});

// Every document of the test board has the revision "100-10".
const SNAP = { version: 1, takenAt: 0, projects: { app: { counts: {}, folders: {}, ruleCounts: {}, greyFolders: {}, files: {}, facts: Object.fromEntries(["a.md", "b.md", "c.md"].map((p) => [p, { mtimeMs: 100_000, size: 10, facts: readFacts(`# ${p}\n`, p) }])) } } } as unknown as ScanSnapshot;
const REV = "100-10";

const rows: Classified[] = ["a.md", "b.md", "c.md"].map((p) => ({ project: "app", path: p, status: "amber", kind: "owner action", note: "" }));

function setup(): { dir: string; run: BoardRun; model: BoardModel; rules: string } {
  const dir = tmpDir();
  stub.__setWorkspaceFolders([{ uri: vscode.Uri.file(dir), name: "app", index: 0 }]);
  fs.writeFileSync(path.join(dir, "a.md"), "# A\n\nBody\n");
  fs.writeFileSync(path.join(dir, "b.md"), "# B\n\nNeeds: a.md\nBody\n");
  fs.writeFileSync(path.join(dir, "c.md"), "# C\n");
  const cfg: BoardConfig = { ...(defaultRules as unknown as BoardConfig), projects: [{ id: "app", name: "App", path: vscode.Uri.file(dir).toString(), roots: [], ruleSets: [] }] };
  const model = buildBoard(cfg, rows, undefined, true, SNAP, undefined, {}, { needs: { "app/b.md": ["a.md"] } });
  return { dir, run: { cfg, result: { rows } } as unknown as BoardRun, model, rules: path.join(dir, ".saropa", "release-board.json") };
}

const statuses = ["red", "amber", "green"];
const patchText = (changes: unknown[]): string => JSON.stringify({ schema: "saropa.releaseBoard.patch/1", changes: changes.map((c) => ({ rev: REV, ...(c as object) })) });
const rowsOf = (model: BoardModel, changes: unknown[]) => {
  const c = checkPatch(patchText(changes), targetsOf(model), statuses);
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

test("Undo restores what it can, names the file that changed, and a retry finishes the rest", async () => {
  const { dir, run, model, rules } = setup();
  const out = await applyRows(run, model, rowsOf(model, [ALL[1], ALL[4]]));
  fs.writeFileSync(path.join(dir, "c.md"), "edited by hand\n");
  assert.equal(await undoBatch(out.snapshot), false);
  assert.equal(fs.existsSync(rules), false, "the rules file was restorable, so it is restored");
  assert.equal(read(dir, "c.md"), "edited by hand\n", "the edited document is never overwritten");
  assert.ok(stub.__warningMessages().some((m) => m.includes("c.md")));
  assert.equal(out.snapshot.docs.length, 1);
  // The owner puts the batch's text back by hand: the retry has nothing left that blocks it.
  fs.writeFileSync(path.join(dir, "c.md"), out.snapshot.docs[0].after);
  assert.equal(await undoBatch(out.snapshot), true);
  assert.equal(read(dir, "c.md"), "# C\n");
});

// Makes writes to files with this ending throw until the returned function is called.
function failWrites(ending: string): () => void {
  const api = vscode.workspace.fs as unknown as { writeFile: (u: vscode.Uri, b: Uint8Array) => Promise<void> };
  const orig = api.writeFile;
  api.writeFile = async function (this: unknown, u: vscode.Uri, b: Uint8Array): Promise<void> {
    if (u.path.endsWith(ending)) {
      throw new Error("disk full");
    }
    return orig.call(this, u, b);
  };
  return () => {
    api.writeFile = orig;
  };
}

test("a write that fails partway still returns the snapshot of what was written, and Undo finishes after a failed Undo", async () => {
  const { dir, run, model } = setup();
  const before = { b: read(dir, "b.md"), c: read(dir, "c.md") };
  const heal = failWrites("c.md");
  let out;
  try {
    out = await applyRows(run, model, rowsOf(model, [ALL[5], ALL[4]]));
  } finally {
    heal();
  }
  assert.deepEqual([out.applied, out.skipped, out.snapshot.docs.length], [1, 1, 1]);
  assert.equal(read(dir, "b.md"), "# B\n\nBody\n");
  assert.equal(read(dir, "c.md"), before.c);
  // Now two documents are written; the Undo fails on the first file, restores the second, and a retry completes.
  const two = await applyRows(run, model, rowsOf(model, [ALL[4]]));
  assert.equal(two.snapshot.docs.length, 1);
  const snap = { docs: [...out.snapshot.docs, ...two.snapshot.docs] };
  const heal2 = failWrites("b.md");
  let first;
  try {
    first = await undoBatch(snap);
  } finally {
    heal2();
  }
  assert.equal(first, false);
  assert.equal(read(dir, "c.md"), before.c);
  assert.equal(snap.docs.length, 1, "only the file that failed is left to restore");
  assert.equal(await undoBatch(snap), true);
  assert.equal(read(dir, "b.md"), before.b);
});

test("a folder that is a symbolic link never takes a Needs write outside the project", async () => {
  const { dir, run } = setup();
  const outside = tmpDir();
  fs.writeFileSync(path.join(outside, "x.md"), "# X\n");
  fs.symlinkSync(outside, path.join(dir, "link"));
  const linked: Classified[] = [...rows, { project: "app", path: "link/x.md", status: "amber", kind: "owner action", note: "" }];
  const model = buildBoard(run.cfg, linked, undefined, true, SNAP, undefined, {}, {});
  // The row is built by hand from a plain one: the check itself cannot know the folder is a link.
  const plain = rowsOf(setup().model, [{ op: "addNeeds", item: "app:c.md", on: "app:a.md", reason: "x" }]);
  const hand = { ...plain[0], change: { ...plain[0].change, item: "app:link/x.md" } };
  const out = await applyRows(run, model, [hand]);
  assert.deepEqual([out.applied, out.skipped], [0, 1]);
  assert.equal(fs.readFileSync(path.join(outside, "x.md"), "utf8"), "# X\n");
  assert.equal(await realInside(dir, "link/x.md"), undefined);
  assert.ok(await realInside(dir, "a.md"));
  assert.equal(await realInside(dir, "../x.md"), undefined);
});

test("a patch pasted and applied is kept in the hand-off folder, outside git", async () => {
  const { dir, run, model } = setup();
  await savePastedPatch(run, model, rowsOf(model, [ALL[0]]), "PATCH TEXT");
  const names = fs.readdirSync(handoffDir(dir));
  const kept = names.find((n) => n.startsWith("pasted-"));
  assert.ok(kept && !kept.endsWith(".result.json"));
  assert.equal(fs.readFileSync(path.join(handoffDir(dir), kept), "utf8"), "PATCH TEXT");
  assert.equal(fs.readFileSync(path.join(handoffDir(dir), ".gitignore"), "utf8"), "*\n");
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
  patches.open();
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
  now = buildBoard(run.cfg, [{ ...rows[0], status: "green" }, rows[1], rows[2]], undefined, true, SNAP, undefined, {}, {});
  assert.deepEqual(patches.pick([0, 1])?.rows.map((r) => r.change.op), []);
  patches.read("garbage", "paste");
  assert.equal(patches.pick([0]), undefined);
  assert.match(String((posted[1] as { error?: string }).error), /No patch found/);
});

test("pick drops, and counts, a ticked row whose before value changed after the review", () => {
  const { run, model } = setup();
  let now = model;
  const patches = new BoardPatches(() => ({ model: now, run }), () => undefined, () => undefined);
  patches.read(patchText([ALL[0]]), "paste");
  assert.equal(patches.pick([0])?.rows.length, 1);
  // The owner moved a.md from amber to red meanwhile: "amber to green" no longer describes the change.
  now = buildBoard(run.cfg, [{ ...rows[0], status: "red" }, rows[1], rows[2]], undefined, true, SNAP, undefined, {}, {});
  const picked = patches.pick([0]);
  assert.deepEqual([picked?.rows.length, picked?.dropped], [0, 1]);
});

test("a reply over the size limit is refused at once, however it is built", () => {
  const { run, model } = setup();
  const posted: Array<{ error?: string }> = [];
  const patches = new BoardPatches(() => ({ model, run }), (m) => posted.push(m as { error?: string }), () => undefined);
  const t = Date.now();
  patches.read("x```json saropa-patch\n".repeat(50_000), "paste");
  assert.ok(Date.now() - t < 3000, "refused without scanning");
  assert.match(String(posted[0].error), /too large/);
});

test("the watcher looks at the newest twenty result files at start, drops a deleted one and does not offer an answered one again", async () => {
  const { dir, run, model } = setup();
  for (let i = 0; i < 25; i++) {
    const u = put(dir, `old${i}.result.json`, "{}");
    fs.utimesSync(u.fsPath, new Date(Date.now() - 100_000 + i * 1000), new Date(Date.now() - 100_000 + i * 1000));
  }
  const seen: string[] = [];
  const w = watchResults(() => [vscode.Uri.file(dir)], (_t, name) => seen.push(name));
  w.scan();
  await wait(200);
  assert.equal(seen.length, 20);
  assert.ok(seen.includes("old24.result.json") && !seen.includes("old0.result.json"));

  const posted: unknown[] = [];
  let changed = 0;
  const patches = new BoardPatches(() => ({ model, run }), (m) => posted.push(m), () => changed++);
  patches.watch();
  const fw = vs.__fileWatchers().at(-1) as unknown as { created: { fire(u: unknown): void }; changed: { fire(u: unknown): void }; deleted: { fire(u: unknown): void } };
  const u = put(dir, "good.result.json", patchText([ALL[0]]));
  fw.created.fire(u);
  await wait(60);
  assert.deepEqual([patches.view(), changed], [{ patchReady: 1 }, 1]);
  // A reply open for review keeps its list: a change event moves only the pill.
  patches.open();
  fw.changed.fire(u);
  fs.writeFileSync(u.fsPath, patchText([ALL[0], ALL[1]]));
  fw.changed.fire(u);
  await wait(60);
  assert.equal(changed, 1, "no new paint while a list is open");
  assert.ok(posted.some((m) => (m as { type?: string; count?: number }).type === "patchPill" && (m as { count: number }).count === 2));
  // Rejected: the same file, unchanged, is not offered again by the next event.
  patches.open();
  patches.clear();
  assert.deepEqual(patches.view(), {});
  fw.changed.fire(u);
  await wait(60);
  assert.deepEqual(patches.view(), {});
  // Edited later: offered again; deleted: gone.
  fs.writeFileSync(u.fsPath, patchText([ALL[0]]));
  fs.utimesSync(u.fsPath, new Date(Date.now() + 5000), new Date(Date.now() + 5000));
  fw.changed.fire(u);
  await wait(60);
  assert.deepEqual(patches.view(), { patchReady: 1 });
  fw.deleted.fire(u);
  assert.deepEqual(patches.view(), {});
});

// ---- Round two -------------------------------------------------------------------------------

const docs = (): Array<{ isDirty: boolean; uri: vscode.Uri }> => (vscode.workspace as unknown as { textDocuments: Array<{ isDirty: boolean; uri: vscode.Uri }> }).textDocuments;

function handoffOf(model: BoardModel, format: "md" | "json", dropRev?: string) {
  const { projects, items } = fromModel(model, model.items, { app: "app" });
  const list = items.map((it) => (it.path === dropRev ? { ...it, rev: undefined } : it));
  const out = buildHandoff({ id: "2026-10-30T10-04-12-app-fix", task: "fix", date: "2026-10-30", scope: { kind: "board", count: list.length }, projects, items: list, file: "x.md" });
  return format === "md" ? out.markdown : out.json;
}

test("round trip: a patch crafted from either hand-off format, copying its rev, parses and applies", async () => {
  const { dir, run, model } = setup();
  const md = handoffOf(model, "md");
  const json = JSON.parse(handoffOf(model, "json")) as { items: Array<{ id: string; rev?: string }> };
  const fromMd = /Id: app:a\.md\nFile: [^\n]*\nTitle: [^\n]*\nRev: (\S+)/.exec(md)?.[1];
  const fromJson = json.items.find((i) => i.id === "app:a.md")?.rev;
  assert.equal(fromMd, REV);
  assert.equal(fromJson, REV);
  assert.match(md, /copies the item's `Rev:` value/);
  for (const rev of [fromMd, fromJson]) {
    const reply = "Done.\n```json saropa-patch\n" + JSON.stringify({ schema: "saropa.releaseBoard.patch/1", changes: [{ op: "setSeverity", item: "app:a.md", to: "low", rev, reason: "cosmetic" }] }) + "\n```\n";
    const raw = extractPatch(reply) as string;
    const c = checkPatch(raw, targetsOf(model), statuses);
    assert.equal(c.ok && c.rows.length, 1);
    assert.deepEqual(c.ok && c.refused, []);
    assert.equal(c.ok && c.rows[0].stale, false);
    const out = await applyRows(run, model, c.ok ? c.rows : []);
    assert.equal(out.applied, 1);
    await undoBatch(out.snapshot);
  }
  assert.equal(fs.existsSync(path.join(dir, ".saropa", "release-board.json")), false);
});

test("an item without a revision is shown as unpatchable in both formats", () => {
  const { model } = setup();
  assert.match(handoffOf(model, "md", "c.md"), /Rev: none \(cannot be changed by a patch: no revision\)/);
  const items = (JSON.parse(handoffOf(model, "json", "c.md")) as { items: Array<{ path: string; noRevision?: string }> }).items;
  assert.match(items.find((i) => i.path === "c.md")?.noRevision ?? "", /no revision/);
  assert.equal(items.find((i) => i.path === "a.md")?.noRevision, undefined);
});

test("a skipped Needs document always gets a reason", async () => {
  const { dir, run, model } = setup();
  fs.unlinkSync(path.join(dir, "c.md"));
  const out = await applyRows(run, model, rowsOf(model, [ALL[4]]));
  assert.equal(out.applied, 0);
  assert.ok(out.problems.some((p) => p.includes("c.md")), out.problems.join("|"));
  fs.writeFileSync(path.join(dir, "c.md"), "x".repeat(2_100_000));
  const big = await applyRows(run, model, rowsOf(model, [ALL[4]]));
  assert.ok(big.problems.some((p) => /too large/.test(p)));
});

test("unsaved edits are found by the real path, the workspace path (symlinked root) and letter case", async () => {
  const { dir, run, model } = setup();
  const link = path.join(tmpDir(), "linked");
  fs.symlinkSync(dir, link);
  const viaLink: BoardRun = { ...run, cfg: { ...run.cfg, projects: [{ ...run.cfg.projects[0], path: vscode.Uri.file(link).toString() }] } } as BoardRun;
  const one = rowsOf(model, [ALL[4]]);
  for (const open of [path.join(link, "c.md"), path.join(dir, "c.md"), path.join(dir, "C.MD")]) {
    docs().push({ isDirty: true, uri: vscode.Uri.file(open) });
    const out = await applyRows(viaLink, model, one);
    assert.equal(out.applied, 0, open);
    assert.ok(out.problems.some((p) => /unsaved/.test(p)), open);
    assert.equal(read(dir, "c.md"), "# C\n");
    docs().length = 0;
  }
  docs().push({ isDirty: false, uri: vscode.Uri.file(path.join(link, "c.md")) });
  assert.equal((await applyRows(viaLink, model, one)).applied, 1, "a saved copy does not block");
  docs().length = 0;
  assert.equal(await hasUnsavedEdits(path.join(dir, "zzz.md"), undefined), false);
});

test("a path that differs from the real one only in letter case is accepted, not skipped silently", async () => {
  const { dir } = setup();
  const real = await realInside(dir, "a.md");
  assert.ok(real);
  const probe = path.join(dir, "A.MD");
  if (fs.existsSync(probe)) {
    assert.equal(await realInside(dir, "A.MD"), real, "case-insensitive disk: same file");
  }
});

test("a symlinked project root still writes through the real path", async () => {
  const { dir, run, model } = setup();
  const link = path.join(tmpDir(), "linked");
  fs.symlinkSync(dir, link);
  const viaLink: BoardRun = { ...run, cfg: { ...run.cfg, projects: [{ ...run.cfg.projects[0], path: vscode.Uri.file(link).toString() }] } } as BoardRun;
  const out = await applyRows(viaLink, model, rowsOf(model, [ALL[4]]));
  assert.equal(out.applied, 1);
  assert.equal(read(dir, "c.md"), "# C\n\nNeeds: a.md\n");
});

test("Undo with an unsaved copy open says to save or close it, lists what remains, and a retry finishes", async () => {
  const { dir, run, model } = setup();
  const out = await applyRows(run, model, rowsOf(model, [ALL[1], ALL[4]]));
  docs().push({ isDirty: true, uri: vscode.Uri.file(path.join(dir, "c.md")) });
  assert.equal(await undoBatch(out.snapshot), false);
  assert.ok(stub.__warningMessages().some((m) => /c\.md has unsaved edits: save or close it, then press Undo again/.test(m)));
  assert.deepEqual(remainingFiles(out.snapshot), ["c.md"]);
  docs().length = 0;
  assert.equal(await undoBatch(out.snapshot), true);
  assert.deepEqual(remainingFiles(out.snapshot), []);
  assert.equal(read(dir, "c.md"), "# C\n");
});

test("pasted-patch copies keep only the newest twenty", async () => {
  const { dir, run, model } = setup();
  fs.mkdirSync(handoffDir(dir), { recursive: true });
  for (let i = 0; i < 25; i++) {
    fs.writeFileSync(path.join(handoffDir(dir), `pasted-2026-01-${String(i + 1).padStart(2, "0")}T00-00-00-000Z.patch.json`), "{}");
  }
  fs.writeFileSync(path.join(handoffDir(dir), "keep.txt"), "x");
  await savePastedPatch(run, model, rowsOf(model, [ALL[0]]), "NEW");
  const left = fs.readdirSync(handoffDir(dir)).filter((n) => n.startsWith("pasted-"));
  assert.equal(left.length, 20);
  assert.ok(!left.includes("pasted-2026-01-01T00-00-00-000Z.patch.json") && fs.existsSync(path.join(handoffDir(dir), "keep.txt")));
  assert.ok(left.some((n) => !n.startsWith("pasted-2026-01")), "the new copy stays");
});

test("a rules-file write that fails after it landed is still undoable", async () => {
  const { run, model, rules } = setup();
  const api = vscode.workspace.fs as unknown as { rename: (a: vscode.Uri, b: vscode.Uri, o?: { overwrite?: boolean }) => Promise<void> };
  const orig = api.rename;
  api.rename = async function (this: unknown, from: vscode.Uri, u: vscode.Uri, o?: { overwrite?: boolean }): Promise<void> {
    await orig.call(this, from, u, o);
    if (u.path.endsWith("release-board.json")) {
      throw new Error("late failure");
    }
  };
  let out;
  try {
    out = await applyRows(run, model, rowsOf(model, [ALL[1]]));
  } finally {
    api.rename = orig;
  }
  assert.equal(out.applied, 1);
  assert.ok(out.snapshot.rules);
  assert.equal(await undoBatch(out.snapshot), true);
  assert.equal(fs.existsSync(rules), false);
});

test("the start scan hands over the newest reply last, and an answered reply stays answered after a restart", async () => {
  const { dir, run, model } = setup();
  const a = put(dir, "old.result.json", patchText([ALL[0]]));
  const b = put(dir, "new.result.json", patchText([ALL[0], ALL[1]]));
  fs.utimesSync(a.fsPath, new Date(Date.now() - 50_000), new Date(Date.now() - 50_000));
  const order: string[] = [];
  const w = watchResults(() => [vscode.Uri.file(dir)], (_t, name) => order.push(name));
  w.scan();
  await wait(200);
  assert.deepEqual(order, ["old.result.json", "new.result.json"]);

  const store = new Map<string, unknown>();
  const memory = { get: (k: string, d: unknown) => store.get(k) ?? d, update: async (k: string, v: unknown) => void store.set(k, v), keys: () => [...store.keys()] } as unknown as vscode.Memento;
  const first = new BoardPatches(() => ({ model, run }), () => undefined, () => undefined, () => memory);
  first.watch();
  first.scan();
  await wait(200);
  assert.deepEqual(first.view(), { patchReady: 2 }, "the newest file is on the pill");
  first.open();
  first.clear();
  assert.ok(b);
  const second = new BoardPatches(() => ({ model, run }), () => undefined, () => undefined, () => memory);
  second.watch();
  second.scan();
  await wait(200);
  assert.deepEqual(second.view(), { patchReady: 1 }, "only the unanswered older reply is offered");
});

test("a pasted reply applied while a result file waits leaves the waiting file offered", async () => {
  const { dir, run, model } = setup();
  const patches = new BoardPatches(() => ({ model, run }), () => undefined, () => undefined);
  patches.watch();
  const w = vs.__fileWatchers()[0];
  w.created.fire(put(dir, "wait.result.json", patchText([ALL[0]])));
  await wait(60);
  assert.deepEqual(patches.view(), { patchReady: 1 });
  patches.read(patchText([ALL[1]]), "paste");
  patches.clear();
  assert.deepEqual(patches.view(), { patchReady: 1 }, "the waiting file is not the one reviewed");
});

test("a file reviewed while a newer one arrives is marked answered, and the newer one stays offered", async () => {
  const { dir, run, model } = setup();
  const patches = new BoardPatches(() => ({ model, run }), () => undefined, () => undefined);
  patches.watch();
  const w = vs.__fileWatchers()[0];
  const x = put(dir, "x.result.json", patchText([ALL[0]]));
  w.created.fire(x);
  await wait(60);
  patches.open();
  const y = put(dir, "y.result.json", patchText([ALL[0], ALL[1]]));
  w.created.fire(y);
  await wait(60);
  assert.deepEqual(patches.view(), { patchReady: 2 });
  patches.clear();
  assert.deepEqual(patches.view(), { patchReady: 2 }, "Y stays offered");
  w.changed.fire(x);
  await wait(60);
  assert.deepEqual(patches.view(), { patchReady: 2 }, "X is not offered again");
});

test("a deleted file is matched by full path, not by name", async () => {
  const { dir, run, model } = setup();
  const patches = new BoardPatches(() => ({ model, run }), () => undefined, () => undefined);
  patches.watch();
  const fw = vs.__fileWatchers()[0] as unknown as { created: { fire(u: unknown): void }; deleted: { fire(u: unknown): void } };
  const same = put(dir, "same.result.json", patchText([ALL[0]]));
  fw.created.fire(same);
  await wait(60);
  fw.deleted.fire(vscode.Uri.file(path.join(dir, "other", "same.result.json")));
  assert.deepEqual(patches.view(), { patchReady: 1 });
  fw.deleted.fire(same);
  assert.deepEqual(patches.view(), {});
});

test("a junk result file of the same name in another project does not clear the waiting one", async () => {
  const { dir, run, model } = setup();
  const other = tmpDir();
  const run2 = { ...run, cfg: { ...run.cfg, projects: [...run.cfg.projects, { id: "other", name: "Other", path: vscode.Uri.file(other).toString(), roots: [], ruleSets: [] }] } } as BoardRun;
  const patches = new BoardPatches(() => ({ model, run: run2 }), () => undefined, () => undefined);
  patches.watch();
  const fw = vs.__fileWatchers()[0];
  fw.created.fire(put(dir, "same.result.json", patchText([ALL[0], ALL[1]])));
  await wait(60);
  assert.deepEqual(patches.view(), { patchReady: 2 });
  fw.created.fire(put(other, "same.result.json", "not json"));
  await wait(60);
  assert.deepEqual(patches.view(), { patchReady: 2 }, "matched by full path, not by name");
});

test("a status no rule gives is refused as 'status', not as a wrong layout", () => {
  const { model } = setup();
  const row = rowsOf(model, [ALL[0]])[0];
  const t = targetsOf(model).get("app:a.md")!;
  assert.deepEqual(applyRuleRow(undefined, row, t, []), { ok: false, reason: "status" });
  assert.match(l10n("releaseBoard.patch.rule.status", { file: "a.md" }), /no rule gives a document that status/);
});

test("a write error shows as a plain sentence in the problems list, never the raw text", async () => {
  assert.match(plainWriteError(Object.assign(new Error("EACCES: open '/x'"), { code: "EACCES" }), "a.md"), /read-only or not allowed/);
  assert.match(plainWriteError(new Error("ENOSPC: no space left"), "a.md"), /disk is full/);
  assert.match(plainWriteError(new Error("weird failure"), "a.md"), /details are in the log/);
  const { run, model } = setup();
  const heal = failWrites("c.md");
  let out;
  try {
    out = await applyRows(run, model, rowsOf(model, [ALL[4]]));
  } finally {
    heal();
  }
  assert.ok(out.problems.length > 0);
  assert.ok(out.problems.every((p) => !p.includes("disk full")), out.problems.join("|"));
});

test("no toast or problems entry carries the raw write error text", async () => {
  const win = vscode.window as unknown as { showErrorMessage: (m: string) => Promise<undefined> };
  const orig = win.showErrorMessage;
  const toasts: string[] = [];
  win.showErrorMessage = async (m: string): Promise<undefined> => {
    toasts.push(m);
    return undefined;
  };
  const { run, model } = setup();
  const heal = failWrites("c.md");
  let out;
  try {
    out = await applyRows(run, model, rowsOf(model, [ALL[4]]));
  } finally {
    heal();
    win.showErrorMessage = orig;
  }
  assert.ok(toasts.length > 0 && out.problems.length > 0);
  for (const m of [...toasts, ...out.problems]) {
    assert.ok(!m.includes("disk full") && !/Error:|ENOSPC|EACCES/.test(m), m);
  }
});

test("the rules file is not changed while an unsaved copy is open at its real path (symlinked workspace)", async () => {
  const { dir, run } = setup();
  fs.mkdirSync(path.join(dir, ".saropa"));
  fs.writeFileSync(path.join(dir, ".saropa", "release-board.json"), "{}\n");
  const link = path.join(tmpDir(), "linked");
  fs.symlinkSync(dir, link);
  stub.__setWorkspaceFolders([{ uri: vscode.Uri.file(link), name: "app", index: 0 }]);
  docs().push({ isDirty: true, uri: vscode.Uri.file(path.join(dir, ".saropa", "release-board.json")) });
  const snap = await changeDoc(run, { project: "app", path: "a.md" }, { kind: "severity", level: "low" });
  assert.equal(snap, undefined);
  assert.equal(fs.readFileSync(path.join(dir, ".saropa", "release-board.json"), "utf8"), "{}\n");
  assert.ok(stub.__warningMessages().some((m) => /unsaved/.test(m)));
  docs().length = 0;
});

test("a pending Undo message names the Dismiss button and how many files remain", () => {
  const m = busyMessage(UNDO_PENDING, ["a.md", "release-board.json"]);
  assert.match(m, /Dismiss/);
  assert.match(m, /2 \(a\.md, release-board\.json\)/);
  assert.equal(busyMessage("releaseBoard.rowMenu.busyScan", []), l10n("releaseBoard.rowMenu.busyScan"));
});
