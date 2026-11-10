// "Which comes first": the strip, the page messages and the question batches, through the real board entry point
// (openBoard) and the real marks files. Written, not run by the build agent.

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { buildBoard } from "../../board/boardModel";
import { BoardStrings, renderBoard } from "../../board/boardHtml";
import { askStrip } from "../../board/boardHtmlAsk";
import type { BoardProject } from "../../board/boardModelParts";
import { BATCH } from "../../board/orderAsk";
import { parseMarks } from "../../board/marks";
import { BoardConfig, BoardStatus, Classified } from "../../board/types";
import { openBoard } from "../../views/boardPanel";
import { __lastWebviewPanel, __resetWebviewPanels, __infoMessages, __setPickHandler, __resetHandlers } from "../_stub/vscode";
import { flushEvents, settle } from "../settle";
import { contextIn, stub, tmpDir } from "./hostHelpers";

afterEach(() => {
  __resetWebviewPanels();
  __resetHandlers();
  stub.__resetConfig();
  stub.__setWorkspaceFolders(undefined);
});

const t: BoardStrings = new Proxy({} as BoardStrings, { get: (_o, k: string) => (k === "more" || k === "blocked" || k === "reasonGrey" ? `${k} {count}` : `[${k}]`) });
const revOf = (html: string): number => Number(/const REV=(\d+)/.exec(html)?.[1]);
const FILE = "release-board-marks.json";

// A workspace with `n` open bugs, all marked as blocking (project answered), plus one plain document.
function orderDir(n: number, extra: Record<string, unknown> = {}): string {
  const dir = tmpDir();
  fs.mkdirSync(path.join(dir, "bugs"));
  fs.mkdirSync(path.join(dir, "docs"));
  for (let i = 0; i < n; i++) {
    fs.writeFileSync(path.join(dir, "bugs", `BUG_${i}.md`), `# Bug ${i}\n\nStatus: open\n`);
  }
  fs.writeFileSync(path.join(dir, "docs", "Plain.md"), "# Plain\n");
  const marks = Object.fromEntries(Array.from({ length: n }, (_v, i) => [`app/bugs/BUG_${i}.md`, { pinned: true }]));
  fs.writeFileSync(path.join(dir, FILE), JSON.stringify({ version: 1, marks, needs: {}, rejected: [], answered: { app: { at: 1, seen: [] } }, order: {}, ...extra }));
  stub.__setWorkspaceFolders([{ uri: vscode.Uri.file(dir), name: "app", index: 0 }]);
  return dir;
}

const stored = (dir: string) => parseMarks(fs.readFileSync(path.join(dir, FILE), "utf8")).order.app;

test("the strip needs an answered project with two blockers, shows inside the card and Gantt section, and is escaped", () => {
  const cfg: BoardConfig = { version: 1, ignore: [], ruleSets: {}, projects: [{ id: "app", name: "App <b>", path: "app", roots: [], ruleSets: [] }] };
  const row = (p: string, status: BoardStatus): Classified => ({ project: "app", path: p, status, kind: "", note: "" });
  const rows = [row("bugs/A.md", "red"), row("bugs/B.md", "red"), row("bugs/C.md", "red")];
  const build = (extra: object) => buildBoard(cfg, rows, undefined, true, undefined, undefined, undefined, extra);
  assert.equal(build({}).projects[0].orderAsk, undefined, "never answered: no ordering strip");
  assert.equal(build({ answered: ["app"], pins: ["app/bugs/A.md"] }).projects[0].orderAsk, undefined, "one blocker: nothing to order");
  const m = build({ answered: ["app"], pins: ["app/bugs/A.md", "app/bugs/B.md"] });
  assert.deepEqual(m.projects[0].orderAsk, { count: 2 });
  const html = renderBoard(m, t, "n", 1, { groupBy: "project" });
  assert.equal(html.split('data-order="0"').length - 1, 2, "once in the Gantt section, once in the Board card");
  assert.ok(html.lastIndexOf('data-order="0"') > html.indexOf('<details class="box pcard"'));
  assert.ok(!html.includes("App <b>"));
});

test("one strip at a time: the blockers strip wins over the ordering strip", () => {
  const p = { id: "a", name: "A", ask: { count: 6, fresh: false }, orderAsk: { count: 3 } } as BoardProject;
  const html = askStrip(p, 0, t);
  assert.ok(html.includes("data-ask=") && !html.includes("data-order="));
  assert.ok(askStrip({ ...p, ask: undefined }, 0, t).includes('data-order="0"'));
});

test("an answered order hides the strip; Needs-ordered and fully answered pairs are not asked", () => {
  const cfg: BoardConfig = { version: 1, ignore: [], ruleSets: {}, projects: [{ id: "app", name: "App", path: "app", roots: [], ruleSets: [] }] };
  const rows: Classified[] = ["A", "B"].map((n) => ({ project: "app", path: `bugs/${n}.md`, status: "red" as BoardStatus, kind: "", note: "" }));
  const m = buildBoard(cfg, rows, undefined, true, undefined, undefined, undefined, { answered: ["app"], pins: ["app/bugs/A.md", "app/bugs/B.md"], order: { app: { pairs: [["bugs/A.md", "bugs/B.md"]], skipped: [], folders: [] } } });
  assert.equal(m.projects[0].orderAsk, undefined);
});

test("page messages are rev-checked and validated; a batch of answers is one write with one Undo", async () => {
  const dir = orderDir(3);
  await openBoard(contextIn(dir));
  const panel = __lastWebviewPanel();
  assert.ok(panel);
  await settle(() => panel.webview.html.includes('data-order="0"'));
  const titles: string[] = [];
  __setPickHandler(async (items, opts) => {
    titles.push((opts as { title?: string }).title ?? "");
    assert.equal((opts as { ignoreFocusOut?: boolean }).ignoreFocusOut, true);
    assert.equal(items.length, 3, "A, B and Skip");
    return items[1];
  });
  const rev = revOf(panel.webview.html);
  for (const m of [{ type: "orderAsk", p: 0, rev: rev + 1 }, { type: "orderAsk", p: "0", rev }, { type: "orderAsk", p: 0.5, rev }, { type: "orderAsk", p: 99, rev }, { type: "orderAsk", p: -1, rev }, { type: "orderAsk", rev }]) {
    panel.webview.__receiveFromClient(m);
  }
  await flushEvents(50);
  assert.equal(titles.length, 0, "no picker for a refused message");
  panel.webview.__receiveFromClient({ type: "orderAsk", p: 0, rev });
  await settle(() => panel.webview.html.includes('id="undo"'));
  assert.equal(titles.length, 2, "three blockers agreeing with severity take two questions");
  assert.ok(titles[0].includes("1") && titles[0].includes(String(BATCH)));
  assert.equal(stored(dir).pairs.length, 2);
  assert.ok(!panel.webview.html.includes('data-order="0"'), "all ordered: no strip");
  panel.webview.__receiveFromClient({ type: "undo", rev: revOf(panel.webview.html) });
  await settle(() => stored(dir) === undefined);
  await settle(() => panel.webview.html.includes('data-order="0"'));
});

test("Escape keeps the answers already given; Skip is stored and not asked again until the project menu", async () => {
  const dir = orderDir(4);
  await openBoard(contextIn(dir));
  const panel = __lastWebviewPanel();
  assert.ok(panel);
  await settle(() => panel.webview.html.includes('data-order="0"'));
  let calls = 0;
  __setPickHandler(async (items) => (++calls === 1 ? items[1] : undefined));
  panel.webview.__receiveFromClient({ type: "orderAsk", p: 0, rev: revOf(panel.webview.html) });
  await settle(() => panel.webview.html.includes('id="undo"'));
  assert.equal(stored(dir).pairs.length, 1, "one answer kept after Escape");
  // Skip everything that is asked.
  __setPickHandler(async (items) => items[2]);
  panel.webview.__receiveFromClient({ type: "orderAsk", p: 0, rev: revOf(panel.webview.html) });
  await settle(() => stored(dir).skipped.length > 0);
  const skipped = stored(dir).skipped.length;
  let again = 0;
  __setPickHandler(async () => {
    again++;
    return undefined;
  });
  panel.webview.__receiveFromClient({ type: "orderAsk", p: 0, rev: revOf(panel.webview.html) });
  await flushEvents(100);
  assert.ok(again <= 1, "skipped pairs are not asked again by the strip");
  assert.equal(stored(dir).skipped.length, skipped);
  // The project menu clears the skips and asks again.
  let asked = 0;
  __setPickHandler(async () => {
    asked++;
    return undefined;
  });
  panel.webview.__receiveFromClient({ type: "scopeMenu", act: "order", id: "project:0", rev: revOf(panel.webview.html) });
  await settle(() => asked > 0);
  panel.webview.__receiveFromClient({ type: "scopeMenu", act: "order", id: "group:0", rev: revOf(panel.webview.html) });
  await flushEvents(50);
});

test("a refused write leaves the file as it was and offers no Undo", async () => {
  const others = Object.fromEntries(Array.from({ length: 5000 }, (_v, i) => [`other${i}`, { pairs: [["a.md", "b.md"]], skipped: [], folders: [] }]));
  const dir = orderDir(3, { order: others });
  const before = fs.readFileSync(path.join(dir, FILE), "utf8");
  await openBoard(contextIn(dir));
  const panel = __lastWebviewPanel();
  assert.ok(panel);
  await settle(() => panel.webview.html.includes('data-order="0"'));
  __setPickHandler(async (items) => items[1]);
  panel.webview.__receiveFromClient({ type: "orderAsk", p: 0, rev: revOf(panel.webview.html) });
  await settle(() => stub.__warningMessages().length > 0);
  assert.equal(fs.readFileSync(path.join(dir, FILE), "utf8"), before);
  assert.ok(!panel.webview.html.includes('id="undo"'));
});

test("row menu: ask where this goes, forget order answers; unknown ids and non-blockers are refused", async () => {
  const dir = orderDir(3, { order: { app: { pairs: [["bugs/BUG_0.md", "bugs/BUG_1.md"]], skipped: [], folders: [] } } });
  await openBoard(contextIn(dir));
  const panel = __lastWebviewPanel();
  assert.ok(panel);
  await settle(() => panel.webview.html.includes('data-act="order"'));
  assert.ok(panel.webview.html.includes('data-act="forgetOrder"'));
  const rev = () => revOf(panel.webview.html);
  let asked = 0;
  __setPickHandler(async () => {
    asked++;
    return undefined;
  });
  // The plain document (id 3) is not a blocker; 0.5 and 99 are not items.
  for (const id of [3, 0.5, 99]) {
    panel.webview.__receiveFromClient({ type: "rowMenu", act: "order", id, rev: rev() });
  }
  await flushEvents(50);
  assert.equal(asked, 0);
  assert.ok(__infoMessages().some((m) => m.length > 0));
  panel.webview.__receiveFromClient({ type: "rowMenu", act: "forgetOrder", id: 1, rev: rev() });
  await settle(() => stored(dir) === undefined);
  // The repaint follows the write (after a rescan); a rev read before it is stale and the page message would be refused.
  await settle(() => panel.webview.html.includes('id="undo"'));
  const beforeUndo = rev();
  panel.webview.__receiveFromClient({ type: "undo", rev: beforeUndo });
  await settle(() => stored(dir)?.pairs.length === 1);
  await settle(() => rev() !== beforeUndo);
  __setPickHandler(async (items) => {
    asked++;
    return items[1];
  });
  panel.webview.__receiveFromClient({ type: "rowMenu", act: "order", id: 2, rev: rev() });
  await settle(() => asked > 0);
});

test("row menu: Make this a real dependency writes one Needs line with one Undo, refuses a stale rev and keeps the answer", async () => {
  const dir = orderDir(3, { order: { app: { pairs: [["bugs/BUG_0.md", "bugs/BUG_1.md"]], skipped: [], folders: [] } } });
  await openBoard(contextIn(dir));
  const panel = __lastWebviewPanel();
  assert.ok(panel);
  await settle(() => panel.webview.html.includes('data-act="makeDep"'));
  assert.ok(/data-oa="1"/.test(panel.webview.html), "only a row with an asked answer carries the flag the menu reads");
  const text = (n: number): string => fs.readFileSync(path.join(dir, "bugs", `BUG_${n}.md`), "utf8");
  const before = [0, 1, 2].map(text);
  const rev = () => revOf(panel.webview.html);
  panel.webview.__receiveFromClient({ type: "rowMenu", act: "makeDep", id: 1, rev: rev() - 1 });
  await flushEvents(50);
  assert.deepEqual([0, 1, 2].map(text), before, "a stale rev writes nothing");
  // Ids the page could invent write nothing either; the row with no answer has nothing to turn into a line.
  for (const id of [0.5, 99, -1]) {
    panel.webview.__receiveFromClient({ type: "rowMenu", act: "makeDep", id, rev: rev() });
  }
  await flushEvents(50);
  assert.deepEqual([0, 1, 2].map(text), before);
  // Exactly one of the three rows has the asked answer; it gets the line.
  for (const id of [0, 1, 2]) {
    panel.webview.__receiveFromClient({ type: "rowMenu", act: "makeDep", id, rev: rev() });
    await flushEvents(50);
  }
  const after = [0, 1, 2].map(text);
  const changed = after.filter((x, i) => x !== before[i]);
  assert.equal(changed.length, 1);
  assert.match(changed[0], /Needs:.*BUG_0\.md/);
  assert.equal(stored(dir)?.pairs.length, 1, "the answer stays valid after the line exists");
  await settle(() => panel.webview.html.includes('id="undo"'));
  panel.webview.__receiveFromClient({ type: "undo", rev: rev() });
  await settle(() => [0, 1, 2].every((n) => text(n) === before[n]));
});

test("Make this a real dependency: several answers ask which one; a row that already has the line offers nothing", async () => {
  const dir = orderDir(3, { order: { app: { pairs: [["bugs/BUG_0.md", "bugs/BUG_2.md"], ["bugs/BUG_1.md", "bugs/BUG_2.md"]], skipped: [], folders: [] } } });
  await openBoard(contextIn(dir));
  const panel = __lastWebviewPanel();
  assert.ok(panel);
  await settle(() => panel.webview.html.includes('data-act="makeDep"'));
  const text = (n: number): string => fs.readFileSync(path.join(dir, "bugs", `BUG_${n}.md`), "utf8");
  const before = [0, 1, 2].map(text);
  let offered = 0;
  __setPickHandler(async (items) => {
    offered = items.length;
    return items.find((i) => String((i as { detail?: string }).detail).endsWith("BUG_1.md"));
  });
  for (const id of [0, 1, 2]) {
    panel.webview.__receiveFromClient({ type: "rowMenu", act: "makeDep", id, rev: revOf(panel.webview.html) });
    await flushEvents(50);
  }
  assert.equal(offered, 2, "both answers are offered");
  assert.deepEqual([0, 1].map(text), before.slice(0, 2));
  assert.match(text(2), /Needs:.*BUG_1\.md/);
  assert.ok(!/BUG_0\.md/.test(text(2).split("Needs:")[1] ?? ""), "only the chosen answer is written");

  // The row already has the line: nothing is offered and nothing is written.
  const dir2 = orderDir(2, { order: { app: { pairs: [["bugs/BUG_0.md", "bugs/BUG_1.md"]], skipped: [], folders: [] } } });
  fs.writeFileSync(path.join(dir2, "bugs", "BUG_1.md"), "# Bug 1\n\nStatus: open\n\nNeeds: BUG_0.md\n");
  await openBoard(contextIn(dir2));
  const panel2 = __lastWebviewPanel();
  assert.ok(panel2);
  await settle(() => panel2.webview.html.includes('data-act="forgetOrder"'));
  assert.ok(!panel2.webview.html.includes('data-oa="1"'), "the menu entry is hidden when no answer can become a line");
  const b2 = fs.readFileSync(path.join(dir2, "bugs", "BUG_1.md"), "utf8");
  for (const id of [0, 1]) {
    panel2.webview.__receiveFromClient({ type: "rowMenu", act: "makeDep", id, rev: revOf(panel2.webview.html) });
    await flushEvents(50);
  }
  assert.equal(fs.readFileSync(path.join(dir2, "bugs", "BUG_1.md"), "utf8"), b2, "no duplicate line");
});

test("1000 projects with ten flagged items each build within a generous budget", () => {
  const projects = Array.from({ length: 1000 }, (_v, i) => ({ id: `p${i}`, name: `P${i}`, path: `p${i}`, roots: [], ruleSets: [] }));
  const cfg = { version: 1, ignore: [], ruleSets: {}, projects } as BoardConfig;
  const rows: Classified[] = projects.flatMap((p) => Array.from({ length: 10 }, (_v, k) => ({ project: p.id, path: `bugs/${k}.md`, status: "red" as BoardStatus, kind: "", note: "" })));
  const pins = projects.flatMap((p) => Array.from({ length: 10 }, (_v, k) => `${p.id}/bugs/${k}.md`));
  const best = Math.min(...[0, 1, 2].map(() => {
    const t0 = Date.now();
    const m = buildBoard(cfg, rows, undefined, true, undefined, undefined, undefined, { pins, answered: projects.map((p) => p.id) });
    assert.ok(m.projects.every((p) => p.orderAsk?.count === 10));
    return Date.now() - t0;
  }));
  assert.ok(best < 8000, `best of three was ${best} ms`);
});
