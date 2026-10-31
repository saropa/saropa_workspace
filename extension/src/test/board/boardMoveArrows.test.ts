// Move arrows on Board and Gantt rows: shown only where a move can succeed, the click sends the
// same message as Alt+Up and Alt+Down, and the Gantt follows the stored order.

import { test } from "node:test";
import assert from "node:assert/strict";
import { BoardStrings } from "../../board/boardHtml";
import { DRAG_SCRIPT, moveArrows } from "../../board/boardHtmlDrag";
import { ganttPanel } from "../../board/boardHtmlGantt";
import { groupCards } from "../../board/boardHtmlGroups";
import { buildGantt } from "../../board/ganttModel";
import { buildBoard } from "../../board/boardModel";
import { BoardConfig, BoardStatus, Classified } from "../../board/types";

const t: BoardStrings = new Proxy({} as BoardStrings, { get: (_o, k: string) => `[${k}]` });
const row = (path: string): Classified => ({ project: "app", path, status: "amber" as BoardStatus, kind: "", note: "" });
const base: BoardConfig = {
  version: 1,
  ignore: [],
  ruleSets: {},
  projects: [{ id: "app", name: "App", path: "app", roots: [], ruleSets: [] }],
  groups: [{ name: "Launch <b>", match: ["app/a.md", "app/b.md", "app/c.md"] }],
};
const rows = [row("a.md"), row("b.md"), row("c.md"), row("d.md")];
const names = new Map([["app", "App"]]);
const buttons = (html: string): string[] => html.match(/<button type="button" class="sec mv"[^>]*>/g) ?? [];

test("arrows are drawn on the rows of a group listed by hand: up off at the first row, down off at the last", () => {
  const model = buildBoard({ ...base, order: { app: ["b.md", "a.md", "c.md"] } }, rows, undefined, true, undefined);
  const html = groupCards(model, "group", names, t);
  const b = buttons(html);
  assert.equal(b.length, 6, "two per row of the group, none on the row outside it");
  assert.equal(b.filter((x) => x.includes("disabled")).length, 2);
  assert.ok(b[0].includes('data-mv="-1"') && b[0].includes("disabled"), "first row: up off");
  assert.ok(b[5].includes('data-mv="1"') && b[5].includes("disabled"), "last row: down off");
  assert.ok(b.every((x) => x.includes('aria-label="moveUp"') || x.includes('aria-label="moveDown"')));
  assert.ok(/<\/button><\/span><button[^>]*data-menu="row"/.test(html), "arrows stand just before the row menu");
});

test("no arrows for a group found by the board, a one-row group or a layout without a set order", () => {
  const auto = buildBoard({ ...base, groups: [] }, [row("PLAN_x_1.md"), row("PLAN_x_2.md"), row("c.md")], undefined, true, undefined);
  assert.equal(buttons(groupCards(auto, "group", names, t)).length, 0);
  const one = buildBoard({ ...base, groups: [{ name: "Solo", match: ["app/a.md"] }] }, rows, undefined, true, undefined);
  assert.equal(buttons(groupCards(one, "group", names, t)).length, 0);
  const model = buildBoard(base, rows, undefined, true, undefined);
  assert.equal(buttons(groupCards(model, "status", names, t)).length, 0);
  assert.equal(buttons(ganttPanel(auto, t)).length + buttons(ganttPanel(one, t)).length, 0);
});

test("the Gantt shows the same arrows and follows the stored order", () => {
  const model = buildBoard({ ...base, order: { app: ["c.md", "a.md", "b.md"] } }, rows, undefined, true, undefined);
  const order = buildGantt(model)[0].rows.map((r) => r.path).filter((p) => p !== "d.md");
  assert.deepEqual(order, ["c.md", "a.md", "b.md"]);
  const html = ganttPanel(model, t);
  const b = buttons(html);
  assert.equal(b.length, 6);
  assert.ok(b[0].includes("disabled") && b[5].includes("disabled") && b.filter((x) => x.includes("disabled")).length === 2);
  assert.ok(/<\/button><\/span><button[^>]*data-menu="row"/.test(html), "arrows stand just before the row menu");
});

test("moveArrows escapes the title and the group id", () => {
  const html = moveArrows({ polish: { moveUp: "Up {title}", moveDown: "Down {title}" } } as unknown as BoardStrings, '"><i>', true, true, '"><b>');
  assert.ok(!html.includes("<i>") && !html.includes("<b>"));
});

test("the arrow click sends the keyboard's move message, ids only, with the page revision", () => {
  assert.ok(DRAG_SCRIPT.includes("closest('[data-mv]')"));
  assert.ok(/type:'drop',zone:'move',id:Number\(r\.dataset\.drag\),to,ctl:[^}]*rev:REV/.test(DRAG_SCRIPT));
  const alt = DRAG_SCRIPT.match(/m=\{type:'drop',zone:'move'[^}]*\}/g) ?? [];
  assert.equal(alt.length, 2, "the keyboard and the button build the same message shape");
});
