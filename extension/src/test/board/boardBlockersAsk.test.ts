// "Which items block the next release?": when the strip shows, how an answer is saved and undone,
// and the page messages, through the real board entry point (openBoard) and the real marks files.

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { buildBoard } from "../../board/boardModel";
import { renderBoard, BoardStrings } from "../../board/boardHtml";
import { ASK_OVER, applyAnswer, candidatesOf, restoreSnapshot } from "../../board/blockersAsk";
import { emptyMarks, parseMarks } from "../../board/marks";
import { BoardConfig, BoardStatus, Classified } from "../../board/types";
import { openBoard } from "../../views/boardPanel";
import { __lastWebviewPanel, __resetWebviewPanels, __setPickHandler, __resetHandlers } from "../_stub/vscode";
import { flushEvents, settle } from "../settle";
import { contextIn, stub, tmpDir } from "./hostHelpers";

afterEach(() => {
  __resetWebviewPanels();
  __resetHandlers();
  stub.__resetConfig();
  stub.__setWorkspaceFolders(undefined);
});

const cfg: BoardConfig = { version: 1, ignore: [], ruleSets: {}, projects: [{ id: "app", name: "App <b>", path: "app", roots: [], ruleSets: [] }] };
const t: BoardStrings = new Proxy({} as BoardStrings, { get: (_o, k: string) => (k === "more" || k === "blocked" || k === "reasonGrey" ? `${k} {count}` : `[${k}]`) });
const row = (p: string, status: BoardStatus): Classified => ({ project: "app", path: p, status, kind: "", note: "" });
const reds = (n: number) => Array.from({ length: n }, (_v, i) => row(`bugs/B${i}.md`, "red"));
const factsOf = (severity: string) => ({ mtimeMs: 1000, size: 1, facts: { title: "T", headings: 1, words: 10, chars: 60, stepsOpen: 0, stepsDone: 0, steps: [], stepsCut: 0, rowsAll: 0, rowsDone: 0, codeBlocks: 0, langs: {}, docRefs: 0, docRefNames: [], sourceRefs: 0, sourceFiles: [], needs: [], prs: 0, urls: 0, mentions: [], severity } });
const snap = (files: Record<string, string>) => ({ projects: { app: { facts: Object.fromEntries(Object.entries(files).map(([p, s]) => [p, factsOf(s)])), files: {}, counts: {} } } }) as never;

test("the strip needs more than five items that are red today, and only in the project card", () => {
  assert.equal(buildBoard(cfg, reds(ASK_OVER), undefined, true).projects[0].ask, undefined);
  const m = buildBoard(cfg, reds(ASK_OVER + 1), undefined, true);
  assert.deepEqual(m.projects[0].ask, { count: 6, fresh: false });
  const html = renderBoard(m, t, "n", 1, { groupBy: "project" });
  const at = html.indexOf('data-ask="0"');
  assert.equal(html.split('data-ask="0"').length - 1, 2, "once in the Gantt section, once in the Board card");
  assert.ok(html.lastIndexOf('data-ask="0"') > html.indexOf('<details class="box pcard"'), "inside the card");
  assert.ok(at < html.indexOf('id="tab-board"'), "the first one is in the Gantt tab");
  assert.ok(html.includes("data-ask-no"));
  assert.ok(!renderBoard(buildBoard(cfg, reds(ASK_OVER), undefined, true), t, "n", 1, { groupBy: "project" }).includes("data-ask="));
  // The project name is escaped wherever it appears.
  assert.ok(!html.includes("App <b>"));
});

test("an answered project asks again only for new extreme or critical items", () => {
  const rows = [...reds(2), row("docs/Old.md", "amber"), row("docs/NewCrit.md", "amber"), row("docs/NewHigh.md", "amber")];
  const s = snap({ "docs/Old.md": "critical", "docs/NewCrit.md": "critical", "docs/NewHigh.md": "high" });
  const ask = (seen: string[]) => buildBoard(cfg, rows, undefined, true, s, undefined, undefined, { answered: ["app"], seen: { app: seen } }).projects[0].ask;
  assert.deepEqual(ask(["docs/Old.md"]), { count: 1, fresh: true }, "the new critical item only");
  assert.equal(ask(["docs/Old.md", "docs/NewCrit.md"]), undefined, "new high items never bring it back");
  const m = buildBoard(cfg, rows, undefined, true, s, undefined, undefined, { answered: ["app"], seen: { app: ["docs/Old.md"] } });
  assert.deepEqual(candidatesOf(m.projects[0].items, true, ["docs/Old.md"]).map((i) => i.path), ["docs/NewCrit.md"]);
});

test("an answer pins the picked, remembers the rest, and Undo restores both in one step", () => {
  const m = buildBoard(cfg, reds(3), undefined, true);
  const offered = candidatesOf(m.projects[0].items, false).map((i) => i.path);
  const { next, before } = applyAnswer(emptyMarks(), emptyMarks(), "app", offered, new Set([offered[0]]), false, 7);
  assert.deepEqual(Object.keys(next.marks), [`app/${offered[0]}`]);
  assert.deepEqual(next.answered.app, { at: 7, seen: offered.slice(1) });
  assert.deepEqual(restoreSnapshot(next, "app", before), emptyMarks());
  // Zero picks is an answer too.
  assert.deepEqual(applyAnswer(emptyMarks(), emptyMarks(), "app", offered, new Set(), false, 8).next.answered.app, { at: 8, seen: offered });
});

function boardDir(count: number): string {
  const dir = tmpDir();
  fs.mkdirSync(path.join(dir, "bugs"));
  for (let i = 0; i < count; i++) {
    fs.writeFileSync(path.join(dir, "bugs", `BUG_${i}.md`), `# Bug ${i}\n\nStatus: open\n`);
  }
  stub.__setWorkspaceFolders([{ uri: vscode.Uri.file(dir), name: "app", index: 0 }]);
  return dir;
}

const revOf = (html: string): number => Number(/const REV=(\d+)/.exec(html)?.[1]);

test("page messages are rev-checked and validated; an answer is saved with zero picks and undone", async () => {
  const dir = boardDir(7);
  const ctx = contextIn(dir);
  await openBoard(ctx);
  const panel = __lastWebviewPanel();
  assert.ok(panel);
  await settle(() => panel.webview.html.includes('data-ask="0"'));
  let asked = 0;
  let offered: unknown[] = [];
  let options: { canPickMany?: boolean } | undefined;
  __setPickHandler(async (items, opts) => {
    asked += 1;
    offered = [...items];
    options = opts as { canPickMany?: boolean };
    return [];
  });
  const rev = revOf(panel.webview.html);
  // Refused: wrong rev, non-integer, out of range, negative.
  for (const m of [{ type: "blockersAsk", p: 0, rev: rev + 1 }, { type: "blockersAsk", p: "0", rev }, { type: "blockersAsk", p: 0.5, rev }, { type: "blockersAsk", p: 99, rev }, { type: "blockersAsk", p: -1, rev }]) {
    panel.webview.__receiveFromClient(m);
  }
  await flushEvents(50);
  assert.equal(asked, 0, "no picker for a refused message");
  panel.webview.__receiveFromClient({ type: "blockersAsk", p: 0, rev });
  await settle(() => panel.webview.html.includes('id="undo"'));
  assert.equal(asked, 1);
  assert.equal(options?.canPickMany, true);
  assert.equal(offered.length, 7, "every red item is offered");
  const file = path.join(dir, "release-board-marks.json");
  assert.deepEqual(Object.keys(parseMarks(fs.readFileSync(file, "utf8")).answered), ["app"], "zero picks still answers");
  assert.ok(!panel.webview.html.includes('data-ask="0"'), "answered with nothing new: no strip");
  panel.webview.__receiveFromClient({ type: "undo", rev: revOf(panel.webview.html) });
  await settle(() => Object.keys(parseMarks(fs.readFileSync(file, "utf8")).answered).length === 0);
  await settle(() => panel.webview.html.includes('data-ask="0"'));
});

test("a failed write changes nothing and offers no Undo", async () => {
  const dir = boardDir(7);
  const file = path.join(dir, "release-board-marks.json");
  // A local file already at the entry cap: one more pin cannot be written.
  const marks = Object.fromEntries(Array.from({ length: 5000 }, (_v, i) => [`other/${i}.md`, { pinned: true }]));
  fs.writeFileSync(file, JSON.stringify({ version: 1, marks, needs: {}, rejected: [] }));
  const before = fs.readFileSync(file, "utf8");
  await openBoard(contextIn(dir));
  const panel = __lastWebviewPanel();
  assert.ok(panel);
  await settle(() => panel.webview.html.includes('data-ask="0"'));
  __setPickHandler(async (items) => [items[0]]);
  panel.webview.__receiveFromClient({ type: "blockersAsk", p: 0, rev: revOf(panel.webview.html) });
  await settle(() => stub.__warningMessages().length > 0);
  assert.equal(fs.readFileSync(file, "utf8"), before);
  assert.ok(!panel.webview.html.includes('id="undo"'));
});

test("the row menu checkbox pins one document and the project menu asks again", async () => {
  const dir = boardDir(7);
  await openBoard(contextIn(dir));
  const panel = __lastWebviewPanel();
  assert.ok(panel);
  await settle(() => panel.webview.html.includes('data-ask="0"'));
  const html = panel.webview.html;
  assert.ok(html.includes('data-act="block"') && html.includes('role="menuitemcheckbox"'), "row checkbox");
  assert.ok(html.includes('data-act="ask"'), "project menu entry");
  const file = path.join(dir, "release-board-marks.json");
  // An unknown act and a non-integer id are not changes.
  panel.webview.__receiveFromClient({ type: "rowMenu", act: "nonsense", id: 0, rev: revOf(html) });
  panel.webview.__receiveFromClient({ type: "rowMenu", act: "block", id: 0.5, rev: revOf(html) });
  await flushEvents(50);
  assert.equal(fs.existsSync(file), false);
  panel.webview.__receiveFromClient({ type: "rowMenu", act: "block", id: 0, rev: revOf(html) });
  await settle(() => fs.existsSync(file));
  assert.equal(Object.values(parseMarks(fs.readFileSync(file, "utf8")).marks).filter((m) => m.pinned).length, 1);
  // A group heading has no "ask": only project menus are accepted.
  let asked = 0;
  __setPickHandler(async () => {
    asked += 1;
    return undefined;
  });
  panel.webview.__receiveFromClient({ type: "scopeMenu", act: "ask", id: "group:0", rev: revOf(panel.webview.html) });
  await flushEvents(50);
  assert.equal(asked, 0);
  panel.webview.__receiveFromClient({ type: "scopeMenu", act: "ask", id: "project:0", rev: revOf(panel.webview.html) });
  await settle(() => asked === 1);
});

test("1000 projects with five candidates each build within a generous budget", () => {
  const projects = Array.from({ length: 1000 }, (_v, i) => ({ id: `p${i}`, name: `P${i}`, path: `p${i}`, roots: [], ruleSets: [] }));
  const rows: Classified[] = projects.flatMap((p) => Array.from({ length: 5 }, (_v, k) => ({ project: p.id, path: `bugs/${k}.md`, status: "red" as BoardStatus, kind: "", note: "" })));
  const best = Math.min(...[0, 1, 2].map(() => {
    const t0 = Date.now();
    const m = buildBoard({ ...cfg, projects }, rows, undefined, true);
    assert.ok(m.projects.every((p) => p.ask === undefined));
    return Date.now() - t0;
  }));
  assert.ok(best < 5000, `best of three was ${best} ms`);
});
