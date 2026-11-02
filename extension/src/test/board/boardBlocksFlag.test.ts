// The blocks-release flag, model and drawing: marks caps and answers, the pin tri-state, and what
// an answered project shows against a never-answered one. Everything goes through the real entry
// points (buildBoard, renderBoard, the marks file reader and writer).

import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { buildBoard } from "../../board/boardModel";
import { BoardStrings, renderBoard } from "../../board/boardHtml";
import { buildGantt } from "../../board/ganttModel";
import { buildSidebarRows } from "../../board/sidebar";
import { pathToGo } from "../../board/pathToGo";
import { fromModel } from "../../board/handoff";
import { MAX_ENTRIES, MarksFile, answeredIds, emptyMarks, fitMarks, markKey, mergeMarks, parseMarks, pinnedKeys, setAnswer, setMark } from "../../board/marks";
import { BoardConfig, BoardStatus, Classified } from "../../board/types";
import { SHARED_FILE, readMarks, updateLocalMarks } from "../../commands/boardMarks";
import { contextIn, tmpDir } from "./hostHelpers";

const cfg: BoardConfig = {
  version: 1,
  ignore: [],
  ruleSets: {},
  projects: [{ id: "app", name: "App", path: "app", roots: [], ruleSets: [] }],
} as BoardConfig;

const row = (p: string, status: BoardStatus): Classified => ({ project: "app", path: p, status, kind: "", note: "" });
const rows = [row("bugs/A.md", "red"), row("bugs/B.md", "red"), row("docs/Crit.md", "amber"), row("docs/Pin.md", "amber"), row("docs/Plain.md", "amber")];
const healthy = { app: { lint: "ok", tests: "ok", lintDetail: "", testsDetail: "", clean: true } } as never;
// One document read as critical (a snapshot with its facts), the rest unread.
const snapshot = { projects: { app: { facts: { "docs/Crit.md": { mtimeMs: 1000, size: 1, facts: { title: "Crit", headings: 1, words: 10, chars: 60, stepsOpen: 0, stepsDone: 0, steps: [], stepsCut: 0, rowsAll: 0, rowsDone: 0, codeBlocks: 0, langs: {}, docRefs: 0, docRefNames: [], sourceRefs: 0, sourceFiles: [], needs: [], prs: 0, urls: 0, mentions: [], severity: "critical" } } }, files: {}, counts: {} } } } as never;
const build = (extra: object = {}) => buildBoard(cfg, rows, undefined, true, snapshot, undefined, healthy, extra);
const t: BoardStrings = new Proxy({} as BoardStrings, { get: (_o, k: string) => (k === "more" || k === "blocked" || k === "reasonGrey" ? `${k} {count}` : `[${k}]`) });
const by = (m: ReturnType<typeof build>, p: string) => m.items.find((i) => i.path === p)!;

test("never answered: blocks equals red folder or stopping severity or pin, as before", () => {
  const m = build({ pins: ["app/docs/Pin.md"] });
  assert.deepEqual(m.items.filter((i) => i.blocks).map((i) => i.path).sort(), ["bugs/A.md", "bugs/B.md", "docs/Crit.md", "docs/Pin.md"]);
  assert.equal(by(m, "docs/Plain.md").blocks, false);
  assert.equal(m.projects[0].light, "no-go");
  assert.equal(m.projects[0].answered, undefined);
  assert.equal(by(m, "docs/Crit.md").answered, undefined);
});

test("answered: only the pinned item is red; red folders and critical severity are shown but do not block", () => {
  const m = build({ pins: ["app/docs/Pin.md"], answered: ["app"] });
  assert.deepEqual(m.items.filter((i) => i.blocks).map((i) => i.path), ["docs/Pin.md"]);
  assert.equal(by(m, "bugs/A.md").status, "red");
  assert.equal(by(m, "docs/Crit.md").stopping, true);
  assert.equal(m.items[0].path, "docs/Pin.md", "blockers sort first");
  assert.equal(m.projects[0].light, "no-go");
  assert.equal(m.projects[0].answered, true);
});

test("answered with zero pins: nothing blocks and the light is not NO-GO", () => {
  const m = build({ answered: ["app"] });
  assert.ok(m.items.every((i) => !i.blocks));
  assert.notEqual(m.projects[0].light, "no-go");
  assert.equal(m.projects[0].blockedStopping, 0);
});

test("answered: failing health still makes the project NO-GO", () => {
  const sick = { app: { lint: "failing", tests: "ok", lintDetail: "", testsDetail: "", clean: false } } as never;
  const m = buildBoard(cfg, rows, undefined, true, undefined, undefined, sick, { answered: ["app"] });
  assert.equal(m.projects[0].light, "no-go");
});

test("the page: an unmarked red folder is amber with its own word; the marked one is red", () => {
  const m = build({ pins: ["app/docs/Pin.md"], answered: ["app"] });
  const html = renderBoard(m, t, "n", 1, { groupBy: "project" });
  assert.ok(html.includes("st.serious") || html.includes("[st.serious]"), "unmarked red folder word");
  assert.ok(html.includes('data-ab="1"'), "row menu data says the project is answered");
  const plain = renderBoard(build(), t, "n", 1, { groupBy: "project" });
  assert.ok(!plain.includes("data-ab"), "never answered rows carry no answered flag");
  assert.ok(!plain.includes("[st.serious]"));
});

test("Gantt, sidebar, path to GO and hand-off read blocks", () => {
  const m = build({ pins: ["app/docs/Pin.md"], answered: ["app"] });
  const rowsG = buildGantt(m).flatMap((g) => g.rows);
  const status = (p: string) => rowsG.find((r) => r.path === p)?.status;
  assert.equal(status("docs/Pin.md"), "red");
  assert.equal(status("bugs/A.md"), "amber");
  assert.equal(status("docs/Crit.md"), "amber");
  const side = buildSidebarRows(m, { blockersPerProject: 10, expandProjects: "whenNoGo" }, { light: { "no-go": "NO-GO", unverified: "U", go: "GO" }, blockerOne: "1 blocker", blockerMany: "{count} blockers", reasons: { baseline: "b", grey: "{count}", health: "h", unread: "u" }, causeLint: "l", causeBuild: "b", causeDeps: "d", causeTests: "t", causeBlocked: "{count}", causeHeld: "h" } as never);
  assert.equal(side[0].blockers.length, 1);
  const ptg = pathToGo(m, m.projects[0], { profile: "deliberate" } as never);
  const stops = ptg.steps.filter((s) => s.kind === "item" && s.why !== undefined);
  assert.deepEqual(stops.map((s) => (s as { why?: string }).why), ["pinned"]);
  const h = fromModel(m, m.items, { app: "app" });
  assert.ok(h.projects[0]?.reasons?.includes("1 item block"));
  assert.equal(h.items.find((i) => i.path === "docs/Pin.md")?.why, "marked as blocking the next release");
  assert.equal(h.items.find((i) => i.path === "bugs/A.md")?.why, undefined);
});

test("marks: answers are parsed with the caps and merged local over shared", () => {
  const seen = Array.from({ length: 300 }, (_v, i) => `p${i}.md`);
  const f = parseMarks(JSON.stringify({ answered: { app: { at: 5, seen }, bad: { at: "x" }, __proto__: { at: 1 } } }));
  assert.deepEqual(answeredIds(f), ["app"]);
  assert.equal(f.answered.app.seen.length, 200);
  const merged = mergeMarks(setAnswer(emptyMarks(), "a", { at: 1, seen: [] }), setAnswer(emptyMarks(), "b", { at: 2, seen: [] }));
  assert.deepEqual(answeredIds(merged).sort(), ["a", "b"]);
  assert.deepEqual(answeredIds(setAnswer(merged, "a", undefined)), ["b"]);
});

test("marks: the write cap equals the read cap, so a 5001st pin is refused, not silently lost", () => {
  const f: MarksFile = emptyMarks();
  for (let i = 0; i < MAX_ENTRIES; i++) {
    f.marks[`app/${i}.md`] = { pinned: true };
  }
  assert.ok(fitMarks(f), "5000 fit");
  assert.equal(Object.keys(parseMarks(JSON.stringify(f)).marks).length, MAX_ENTRIES);
  f.marks["app/extra.md"] = { pinned: true };
  assert.equal(fitMarks(f), undefined, "5001 refused");
});

test("marks: a local pinned:false switches off a shared pin, through the real files", async () => {
  const dir = tmpDir();
  const ctx = contextIn(dir);
  const key = markKey("app", "docs/Pin.md");
  fs.mkdirSync(path.join(dir, ".saropa"));
  fs.writeFileSync(path.join(dir, SHARED_FILE), JSON.stringify({ marks: { [key]: { pinned: true } } }));
  // The shared file is read from the first workspace folder, which the helper context does not set; merge directly.
  const shared = parseMarks(fs.readFileSync(path.join(dir, SHARED_FILE), "utf8"));
  await updateLocalMarks(ctx, (local) => setMark(local, key, { pinned: false }, shared.marks[key]?.pinned === true));
  const local = (await readMarks(ctx)).marks[key];
  assert.equal(local?.pinned, false);
  assert.deepEqual(pinnedKeys(mergeMarks(shared, await import("../../commands/boardMarks").then((m) => m.readLocalMarks(ctx)))), []);
  // Without a shared pin, clearing removes the entry as before.
  assert.equal(setMark(emptyMarks(), key, { pinned: false }).marks[key], undefined);
});
