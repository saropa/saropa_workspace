// The auto-organization engine in the board: groups on items, the group cards (name, emoji, stripe,
// reasons, folds, row limits), hand-made groups winning, stable layout and the 2,000-document budget.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildBoard } from "../../board/boardModel";
import { renderBoard } from "../../board/boardHtml";
import { BoardStrings } from "../../board/boardHtmlUtil";
import { readFacts } from "../../board/docFacts";
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
  assert.equal(cards.filter((c) => /^ data-sec="[^"]*:1" open/.test(c)).length, 3);
  assert.ok(cards.every((c) => c.includes('class="cp red"')), "every group shows its blockers");
});

test("a group of 12 in a project of 100 documents shows five rows and a button", () => {
  const rows = [...many("big", 12), ...Array.from({ length: 88 }, (_v, k) => row(`f${k % 22}/y${k}.md`))];
  const m = buildBoard(cfg, rows, undefined, true);
  assert.equal(m.orgLayouts!.app.rowLimit, 5);
  const html = renderBoard(m, t, "n", 0, { groupBy: "group" });
  const big = html.split('<details class="box pcard"').slice(1).find((c) => c.includes("big/doc0.md"))!;
  assert.equal(big.split("<div hidden>")[0].match(/class="row/g)?.length, 5);
  assert.ok(big.includes("data-show-more"));
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

test("a 2,000-document model builds within the budget", () => {
  const rows = Array.from({ length: 2000 }, (_v, k) => row(`docs/area${k % 50}/sub${k % 7}/PLAN_item${k}.md`, k % 9 === 0 ? "red" : "amber"));
  const started = performance.now();
  const m = buildBoard(cfg, rows, undefined, true);
  const ms = performance.now() - started;
  assert.ok(ms < 3000, `took ${ms.toFixed(0)} ms`);
  assert.ok(m.items.some((i) => i.group));
  assert.equal(m.orgLayouts!.app.band, 4);
});
