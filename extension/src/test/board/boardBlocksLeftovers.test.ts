// Blocks-flag leftovers: the row checkbox answers the project, the wording and tooltips for the two rules,
// the mode-menu note, the Gantt word for unmarked red folders, the changed-outline limit and the picker
// line for a rules-file pin. Everything through the real entry points (buildBoard, renderBoard, openBoard).

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { buildBoard } from "../../board/boardModel";
import { renderBoard, BoardStrings } from "../../board/boardHtml";
import { applyBlock, restoreSnapshot } from "../../board/blockersAsk";
import { buildGantt, MAX_OUTLINED } from "../../board/ganttModel";
import { ganttPanel } from "../../board/boardHtmlGantt";
import { emptyMarks, parseMarks } from "../../board/marks";
import { sinceKey, SinceView } from "../../board/sinceLast";
import { BoardConfig, BoardStatus, Classified } from "../../board/types";
import { openBoard } from "../../views/boardPanel";
import { __lastWebviewPanel, __resetWebviewPanels, __setPickHandler, __resetHandlers } from "../_stub/vscode";
import { settle } from "../settle";
import { contextIn, stub, tmpDir } from "./hostHelpers";

afterEach(() => {
  __resetWebviewPanels();
  __resetHandlers();
  stub.__resetConfig();
  stub.__setWorkspaceFolders(undefined);
});

const cfg: BoardConfig = { version: 1, ignore: [], ruleSets: {}, projects: [{ id: "app", name: "App", path: "app", roots: [], ruleSets: [] }] };
const t: BoardStrings = new Proxy({} as BoardStrings, { get: (_o, k: string) => (k === "more" || k === "blocked" || k === "reasonGrey" ? `${k} {count}` : `[${k}]`) });
const row = (p: string, status: BoardStatus): Classified => ({ project: "app", path: p, status, kind: "", note: "" });
const reds = (n: number) => Array.from({ length: n }, (_v, i) => row(`bugs/B${i}.md`, "red"));

test("marking one item answers the project, Undo takes both back, clearing keeps the answer", () => {
  const on = applyBlock(emptyMarks(), emptyMarks(), "app", "bugs/B0.md", true, [], 9);
  assert.deepEqual(on.next.answered.app, { at: 9, seen: [] });
  assert.equal(on.next.marks["app/bugs/B0.md"]?.pinned, true);
  assert.deepEqual(restoreSnapshot(on.next, "app", on.before), emptyMarks());
  const off = applyBlock(on.next, emptyMarks(), "app", "bugs/B0.md", false, [], 10);
  assert.deepEqual(off.next.answered.app, { at: 9, seen: [] }, "the answer stays");
});

test("tooltips and wording name the rule that applies; the mode menu says marks win", () => {
  const never = renderBoard(buildBoard(cfg, reds(2), undefined, true), t, "n", 1, { groupBy: "project" });
  assert.ok(never.includes("projectName ruleAuto") && !never.includes("ruleMarks"));
  assert.ok(!never.includes("profileMarks"), "no note without an answered project");
  const m = buildBoard(cfg, reds(2), undefined, true, undefined, undefined, undefined, { pins: ["app/bugs/B0.md"], answered: ["app"] });
  const html = renderBoard(m, t, "n", 1, { groupBy: "project" });
  assert.ok(html.includes("projectName ruleMarks") && html.includes("profileMarks"));
  assert.ok(html.includes("whyRedUnmarked") && /whyRed(?!Unmarked)/.test(html), "unmarked and marked red folders say different things");
});

test("Gantt: an unmarked red folder says Address now; only the first ten changed rows are outlined", () => {
  const m = buildBoard(cfg, reds(14), undefined, true, undefined, undefined, undefined, { pins: ["app/bugs/B0.md"], answered: ["app"] });
  assert.ok(ganttPanel(m, t).includes("st.serious"), "word on the Gantt row");
  assert.equal(buildGantt(m).flatMap((g) => g.rows).filter((r) => r.serious).length, 13);
  const since = { marked: m.items.map((i) => sinceKey(i)) } as SinceView;
  const rows = buildGantt(m, since).flatMap((g) => g.rows);
  assert.equal(rows.filter((r) => r.changed).length, 14);
  assert.equal(rows.filter((r) => r.outlined).length, MAX_OUTLINED);
  assert.equal(ganttPanel(m, t, since).match(/class="gr[^"]* chg"/g)?.length, MAX_OUTLINED);
});

test("the picker shows a rules-file pin with its reason and never writes it", async () => {
  const dir = tmpDir();
  fs.mkdirSync(path.join(dir, "bugs"));
  for (let i = 0; i < 7; i++) {
    fs.writeFileSync(path.join(dir, "bugs", `BUG_${i}.md`), `# Bug ${i}\n\nStatus: open\n`);
  }
  fs.mkdirSync(path.join(dir, ".saropa"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".saropa", "release-board.json"), JSON.stringify({ version: 1, pinned: ["**/bugs/BUG_0.md"] }));
  stub.__setWorkspaceFolders([{ uri: vscode.Uri.file(dir), name: "app", index: 0 }]);
  await openBoard(contextIn(dir));
  const panel = __lastWebviewPanel();
  assert.ok(panel);
  await settle(() => panel.webview.html.includes('data-ask="0"'));
  let offered: Array<{ description?: string; detail?: string; picked?: boolean }> = [];
  __setPickHandler(async (items) => {
    offered = [...items] as typeof offered;
    return [...items];
  });
  panel.webview.__receiveFromClient({ type: "blockersAsk", p: 0, rev: Number(/const REV=(\d+)/.exec(panel.webview.html)?.[1]) });
  await settle(() => panel.webview.html.includes('id="undo"'));
  const fixed = offered.filter((o) => o.description?.includes("rules file"));
  assert.equal(fixed.length, 1);
  assert.ok(fixed[0].picked && fixed[0].detail?.endsWith("BUG_0.md"));
  const marks = parseMarks(fs.readFileSync(path.join(dir, "release-board-marks.json"), "utf8")).marks;
  assert.equal(Object.keys(marks).length, 6, "the six hand-pickable items are written, the pattern pin is not");
  assert.ok(!Object.keys(marks).some((k) => k.endsWith("BUG_0.md")));
});

test("marking one item records the project's other candidates as seen, so they do not count as new", () => {
  const items = buildBoard(cfg, reds(3), undefined, true).items;
  const on = applyBlock(emptyMarks(), emptyMarks(), "app", "bugs/B0.md", true, items, 9);
  assert.deepEqual([...(on.next.answered.app?.seen ?? [])].sort(), ["bugs/B1.md", "bugs/B2.md"]);
});
