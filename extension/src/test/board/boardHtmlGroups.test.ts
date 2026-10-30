// The group, status and severity cards of the board: which documents go under which card, the
// cards that start open (only those holding a blocker), the by-you and auto tags and the escaping.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildBoard } from "../../board/boardModel";
import { renderBoard } from "../../board/boardHtml";
import { BoardStrings } from "../../board/boardHtmlUtil";
import { cardRows, cardsFor, groupCards } from "../../board/boardHtmlGroups";
import { rowMenu } from "../../board/boardHtmlMenus";
import { BoardConfig, Classified } from "../../board/types";

const t: BoardStrings = new Proxy({} as BoardStrings, { get: (_o, k: string) => `[${k}]` });

const cfg: BoardConfig = {
  version: 1,
  ignore: [],
  ruleSets: {},
  projects: [{ id: "app", name: "App", path: "app", roots: [], ruleSets: [] }],
  groups: [{ name: "Launch <b>", match: ["app/bugs/a.md", "app/docs/c.md"] }],
  ungrouped: ["app/docs/b.md", "app/docs/d.md"],
};
const row = (path: string, status: "red" | "amber" | "purple"): Classified => ({ project: "app", path, status, kind: "", note: "" });
const model = (): ReturnType<typeof buildBoard> => buildBoard(cfg, [row("bugs/a.md", "red"), row("docs/b.md", "amber"), row("docs/c.md", "amber"), row("docs/d.md", "purple")], undefined, true);

test("Group by Group has one card per group, then the documents in no group", () => {
  const cards = cardsFor(model(), "group", t);
  assert.deepEqual(cards.map((c) => [c.name, c.items.length, c.byUser]), [["Launch <b>", 2, true], ["groupNoGroup", 2, undefined]]);
});

test("Group by Status and Severity order the cards", () => {
  assert.deepEqual(cardsFor(model(), "status", t).map((c) => c.id), ["red", "purple", "amber"]);
  const sev = cardsFor(model(), "severity", t);
  assert.equal(sev.reduce((n, c) => n + c.items.length, 0), 4);
});

test("a small board opens every card, and the group name is escaped", () => {
  const html = renderBoard(model(), t, "n", 0, { groupBy: "group" });
  assert.equal(html.match(/<details class="box pcard"/g)?.length, 2);
  assert.ok(/<details class="box pcard" data-sec="card:group:[^"]*:manual:[^"]*" open>/.test(html), "the group with the red document is open");
  assert.ok(/<details class="box pcard" data-sec="card:group:" open>/.test(html), "7 documents or fewer: everything is open, the no-group card included");
  assert.ok(html.includes("Launch &#60;b&#62;") && !html.includes("Launch <b>"));
  assert.ok(html.includes(">groupByYou<"));
  assert.ok(html.includes('data-id="0"'), "rows carry indexes only");
});

test("Group by Status draws the three cards, and Project and None draw none of them", () => {
  const m = model();
  assert.equal(renderBoard(m, t, "n", 0, { groupBy: "status" }).match(/data-sec="card:status:/g)?.length, 3);
  assert.equal(renderBoard(m, t, "n", 0, { groupBy: "severity" }).includes('data-sec="card:severity:'), true);
  assert.equal(renderBoard(m, t, "n", 0, { groupBy: "none" }).includes('data-sec="card:'), false);
  assert.equal(renderBoard(m, t, "n", 0, { groupBy: "project" }).includes('data-sec="card:'), false);
});

test("the row menu offers Move to group", () => {
  assert.ok(rowMenu(t).includes('data-act="group"'));
});

test("a card holding 200 documents shows five rows and a button; the rest is sent on demand", () => {
  const rows = Array.from({ length: 200 }, (_v, n) => row(`docs/d${n}.md`, "red"));
  const m = buildBoard({ ...cfg, groups: [] }, rows, undefined, true);
  const names = new Map([["app", "App"]]);
  const html = groupCards(m, "status", names, t);
  assert.equal(html.match(/data-rowsmore /g)?.length, 1);
  assert.ok(!/data-more(?![-\w]*=)/.test(html), "the Show more button must not carry the More-strip attribute");
  assert.equal(html.match(/class="row/g)?.length, 5);
  assert.ok(html.includes('aria-expanded="false"'));
  const rest = cardRows(m, "status", "red", 5, names, t)!;
  assert.equal(rest.html.match(/class="row/g)?.length, 195);
  assert.equal(rest.count, 195);
  assert.equal(cardRows(m, "status", "red", 200, names, t), undefined, "nothing past the end");
  assert.equal(cardRows(m, "status", "nope", 0, names, t), undefined, "an id the model does not hold");
});

test("a closed card sends no rows in the page, only when opened", () => {
  const rows = Array.from({ length: 20 }, (_v, n) => row(`docs/d${n}.md`, "amber"));
  const m = buildBoard({ ...cfg, groups: [] }, rows, undefined, true);
  const names = new Map([["app", "App"]]);
  const html = groupCards(m, "status", names, t);
  assert.equal(html.match(/class="row/g), null);
  assert.ok(html.includes('data-kind="lazy"'));
  assert.equal(cardRows(m, "status", "amber", 0, names, t)!.html.match(/class="row/g)?.length, 5);
});

