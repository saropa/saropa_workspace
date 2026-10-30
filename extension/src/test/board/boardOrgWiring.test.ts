// The auto-organization engine in the board: groups on items, the group cards (name, emoji, stripe,
// reasons, folds, row limits), hand-made groups winning, stable layout and the 2,000-document budget.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildBoard } from "../../board/boardModel";
import { renderBoard } from "../../board/boardHtml";
import { BoardStrings } from "../../board/boardHtmlUtil";
import { readFacts } from "../../board/docFacts";
import { resetOrgCache } from "../../board/boardOrg";
import { planDrop } from "../../board/boardDrop";
import { GANTT_ROWS, ganttRows } from "../../board/boardHtmlGantt";
import { bestMs } from "./org/orgFixtures";
import { BoardConfig, Classified } from "../../board/types";

const t: BoardStrings = new Proxy({} as BoardStrings, { get: (_o, k: string) => `[${k}]` });
const cfg: BoardConfig = { version: 1, ignore: [], ruleSets: {}, projects: [{ id: "app", name: "App", path: "app", roots: [], ruleSets: [] }] };
const row = (path: string, status: "red" | "amber" | "purple" | "green" = "amber"): Classified => ({ project: "app", path, status, kind: "", note: "" });
const many = (folder: string, n: number): Classified[] => Array.from({ length: n }, (_v, k) => row(`${folder}/doc${k}.md`));

test("documents of one folder form a group with a name, an emoji and the reasons", () => {
  const m = buildBoard(cfg, [...many("payments", 4), row("other.md")], undefined, true);
  const g = m.items.find((i) => i.path === "payments/doc0.md")!.group!;
  assert.equal(g.name, "Payments");
  assert.ok(g.emoji && g.colour?.startsWith("#"));
  assert.ok(g.why?.includes("payments"), g.why);
  assert.equal(g.byUser, undefined);
  assert.equal(m.items.find((i) => i.path === "other.md")!.group, undefined);
});

test("a group listed by hand wins over the folder and reads by you", () => {
  const rows = [...many("payments", 4), row("other.md")];
  const m = buildBoard({ ...cfg, groups: [{ name: "Store <launch>", match: ["app/payments/doc0.md", "app/other.md"] }] }, rows, undefined, true);
  const g = m.items.find((i) => i.path === "payments/doc0.md")!.group!;
  assert.equal(g.name, "Store <launch>");
  assert.equal(g.byUser, true);
  assert.equal(m.items.find((i) => i.path === "other.md")!.group!.id, g.id);
  const html = renderBoard(m, t, "n", 0, { groupBy: "group" });
  assert.ok(html.includes("Store &#60;launch&#62;") && !html.includes("Store <launch>"));
  assert.ok(html.includes(">groupByYou<"));
});

test("a group card carries the emoji, the colour stripe and the reasons in its tooltip", () => {
  const m = buildBoard(cfg, many("payments", 4), undefined, true);
  const html = renderBoard(m, t, "n", 0, { groupBy: "group" });
  assert.ok(/<summary class="sh" style="--g:#[0-9a-f]{6}" title="[^"]*payments/.test(html), "stripe and reasons on the header");
  assert.ok(html.includes(">groupAuto<"));
  assert.ok(/<span aria-hidden="true">[^<]+<\/span> Payments/.test(html));
});

test("with 60 documents only the 3 groups with the most blockers start open, and closed ones keep their red count", () => {
  const rows = ["a", "b", "c", "d", "e", "f"].flatMap((f, n) => Array.from({ length: 10 }, (_v, k) => row(`${f}/x${k}.md`, k <= n ? "red" : "amber")));
  const m = buildBoard(cfg, rows, undefined, true);
  const html = renderBoard(m, t, "n", 0, { groupBy: "group" });
  const cards = html.split('<details class="box pcard"').slice(1);
  assert.equal(cards.length, 6);
  assert.equal(cards.filter((c) => /^ data-sec="[^"]*" open/.test(c)).length, 3);
  assert.ok(cards.every((c) => c.includes('class="cp red"')), "every group shows its blockers");
});

test("a group of 12 in a project of 100 documents shows five rows and a button", () => {
  const rows = [row("big/doc0.md", "red"), ...many("big", 12).slice(1), ...Array.from({ length: 88 }, (_v, k) => row(`f${k % 22}/y${k}.md`))];
  const m = buildBoard(cfg, rows, undefined, true);
  assert.equal(m.orgLayouts!.app.rowLimit, 5);
  const html = renderBoard(m, t, "n", 0, { groupBy: "group" });
  const big = html.split('<details class="box pcard"').slice(1).find((c) => c.includes("big/doc0.md"))!;
  assert.equal(big.match(/class="row/g)?.length, 5);
  assert.ok(big.includes("data-more"));
});

test("a handful of documents show no group headings in a project list", () => {
  const m = buildBoard(cfg, many("payments", 4), undefined, true);
  assert.equal(m.items[0].group?.flat, true);
  assert.ok(!renderBoard(m, t, "n", 0, { groupBy: "project" }).includes('class="grp"'));
});

test("finished documents keep a group's id, and the previous layout holds the band", () => {
  const open = buildBoard(cfg, [...many("payments", 3), row("payments/done.md", "green")], undefined, true);
  const fewer = buildBoard(cfg, [...many("payments", 2), row("payments/done.md", "green")], undefined, true);
  assert.equal(fewer.items[0].group?.id, open.items[0].group?.id);
  const edge = Array.from({ length: 48 }, (_v, k) => row(`g${k % 8}/z${k}.md`));
  const held = buildBoard(cfg, edge, undefined, true, undefined, undefined, undefined, { orgPrevious: { app: { band: 2, max: 14 } } });
  assert.equal(held.orgLayouts!.app.band, 2, "48 documents stay in the 50 band (10 percent hysteresis)");
  assert.equal(buildBoard(cfg, edge, undefined, true).orgLayouts!.app.band, 1);
});

test("front matter tags and group are read into the facts", () => {
  const f = readFacts("---\ntags: [payments]\ngroup: Launch\n---\n# Title\n", "docs/a.md");
  assert.deepEqual(f.tags, ["payments"]);
  assert.equal(f.group, "Launch");
  assert.equal(readFacts("# Title\n", "docs/a.md").tags, undefined);
});

const many2 = (n: number): Classified[] => Array.from({ length: n }, (_v, k) => row(`docs/area${k % 50}/sub${k % 7}/PLAN_item${k}.md`, k % 9 === 0 ? "red" : "amber"));
const web = { id: "web", name: "Web", path: "web", roots: [], ruleSets: [] };

test("a 2,000-document model builds within the budget, and the page stays small", () => {
  const rows = many2(2000);
  const ms = bestMs(() => {
    resetOrgCache();
    buildBoard(cfg, rows, undefined, true);
  });
  assert.ok(ms < 500, `took ${ms.toFixed(0)} ms`);
  const m = buildBoard(cfg, rows, undefined, true);
  assert.ok(m.items.some((i) => i.group));
  assert.equal(m.orgLayouts!.app.band, 4);
  for (const n of [500, 2000]) {
    for (const groupBy of ["group", "status", "severity", "project"] as const) {
      const html = renderBoard(buildBoard(cfg, many2(n), undefined, true), t, "n", 0, { groupBy });
      assert.ok(html.length < 1.5 * 1024 * 1024, `${n} documents, by ${groupBy}: ${(html.length / 1024).toFixed(0)} KB`);
    }
  }
});

test("a repaint of the same scan does not run the engine again", () => {
  const rows = many2(2000);
  const cold = bestMs(() => {
    resetOrgCache();
    buildBoard(cfg, rows, undefined, true);
  }, 1);
  const warm = bestMs(() => void buildBoard(cfg, rows, undefined, true), 1);
  assert.ok(warm < cold, `cold ${cold.toFixed(0)} ms, warm ${warm.toFixed(0)} ms`);
});

test("one layout covers the documents of every project shown", () => {
  const a = Array.from({ length: 30 }, (_v, k) => row(`docs/f${k % 6}/a${k}.md`));
  const b = Array.from({ length: 30 }, (_v, k) => ({ ...row(`docs/f${k % 6}/b${k}.md`), project: "web" }));
  const m = buildBoard({ ...cfg, projects: [...cfg.projects, web] }, [...a, ...b], undefined, true);
  assert.equal(m.orgLayouts!.app.band, 2, "60 documents together, not 30 each");
  assert.deepEqual(m.orgLayouts!.app, m.orgLayouts!.web);
});

test("a group listed by hand across projects stays one group, and names equal after tidying are one", () => {
  const two: BoardConfig = { ...cfg, projects: [...cfg.projects, web], groups: [{ name: "Store  launch", match: ["app/docs/a.md", "web/docs/b.md"] }, { name: "Store launch", match: ["app/docs/c.md"] }] };
  const rows = [row("docs/a.md"), { ...row("docs/b.md"), project: "web" }, row("docs/c.md"), row("docs/d.md")];
  const m = buildBoard(two, rows, undefined, true);
  const hand = m.items.filter((i) => i.group?.byUser);
  assert.equal(new Set(hand.map((i) => i.group!.id)).size, 1);
  assert.equal(hand.length, 3);
  assert.equal(hand[0].group!.stored, "Store launch");
});

test("the stored name of a hand-made group is never clipped or made unique", () => {
  const long = "A very long hand made group name that goes past sixty characters easily";
  const rows = [...many("payments", 3), row("x/one.md"), row("x/two.md"), row("other/z.md")];
  const m = buildBoard({ ...cfg, groups: [{ name: long, match: ["app/x/*"] }, { name: "Payments", match: ["app/other/*"] }] }, rows, undefined, true);
  const g = m.items.find((i) => i.path === "x/one.md")!.group!;
  assert.ok(g.name.length < long.length && g.name.endsWith("…"));
  assert.equal(g.stored, long);
  const from = m.items.find((i) => i.path === "payments/doc0.md")!;
  const plan = planDrop({ zone: "group", id: from.id, to: g.id }, m, { rows: [], projects: [], categories: [] });
  assert.ok(plan.ok && plan.kind === "group" && plan.name === long, "a drop writes the stored name");
  // A hand-made "Payments" next to the folder group of the same name: the page may number one, the file keeps "Payments".
  assert.equal(m.items.find((i) => i.path === "other/z.md")!.group!.stored, "Payments");
});

test("a group colour is a validated hex", () => {
  const m = buildBoard(cfg, many("payments", 4), undefined, true);
  assert.match(m.items[0].group!.colour!, /^#[0-9a-f]{6}$/i);
});

test("the fold is remembered by the group id alone", () => {
  const m = buildBoard(cfg, many("payments", 10), undefined, true);
  const html = renderBoard(m, t, "n", 0, { groupBy: "group" });
  assert.ok(/data-sec="card:group:app:folder:payments"/.test(html), "no open flag in the key");
});

test("sub-groups sit inside their parent card, closed, and never take an open slot", () => {
  const rows = Array.from({ length: 600 }, (_v, k) => row(`docs/area${k % 6}/sub${k % 5}/PLAN_item${k}.md`, k % 4 === 0 ? "red" : "amber"));
  const m = buildBoard(cfg, rows, undefined, true);
  assert.ok(m.items.some((i) => i.group?.parentView), "the fixture has sub-groups");
  const html = renderBoard(m, t, "n", 0, { groupBy: "group" });
  const subs = html.match(/<details class="box pcard sub"[^>]*>/g) ?? [];
  assert.ok(subs.length > 0 && subs.every((s) => !s.includes(" open")), "sub-groups start closed");
  const tops = html.match(/<details class="box pcard" [^>]*>/g) ?? [];
  assert.ok(tops.filter((s) => s.includes(" open")).length <= 3, "at most 3 open top-level cards");
  // A sub-group's id is its own, so its fold is remembered on its own.
  assert.ok(subs.every((s) => /data-sec="card:group:app:/.test(s)));
});

test("the Gantt draws a section's first rows and sends the rest on demand", () => {
  const m = buildBoard(cfg, many2(2000), undefined, true);
  const html = renderBoard(m, t, "n", 0, { groupBy: "group" });
  assert.equal(html.match(/<li class="gr/g)?.length, GANTT_ROWS);
  const more = ganttRows(m, t, undefined, "app", GANTT_ROWS)!;
  assert.equal(more.count, 2000 - GANTT_ROWS);
  assert.equal(more.html.match(/<li class="gr/g)?.length, 2000 - GANTT_ROWS);
  assert.equal(ganttRows(m, t, undefined, "nope", GANTT_ROWS), undefined);
  assert.equal(ganttRows(m, t, undefined, "app", 0), undefined);
});
