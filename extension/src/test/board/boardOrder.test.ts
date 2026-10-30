// Reorder inside a group: the order lists, how rows are shown, what a drop in a gap or an Alt+Arrow
// move means (each refusal), the text written to the rules file and the page markup.

import { test } from "node:test";
import assert from "node:assert/strict";
import { BoardStrings, renderBoard } from "../../board/boardHtml";
import { DRAG_SCRIPT } from "../../board/boardHtmlDrag";
import { DropContext, planDrop } from "../../board/boardDrop";
import { MAX_ORDER, applyOrder, orderLists } from "../../board/boardOrder";
import { buildBoard } from "../../board/boardModel";
import { setProjectOrder } from "../../board/groupEdit";
import { BoardConfig, BoardStatus, Classified } from "../../board/types";

const t: BoardStrings = new Proxy({} as BoardStrings, { get: (_o, k: string) => `[${k}]` });

const cfg: BoardConfig = {
  version: 1,
  ignore: [],
  ruleSets: {},
  projects: [{ id: "app", name: "App", path: "app", roots: [], ruleSets: [] }],
  groups: [
    { name: "Launch", match: ["app/a.md", "app/b.md", "app/c.md"] },
    { name: "Wild", match: ["app/w*.md"] },
    { name: "Solo", match: ["app/s.md"] },
  ],
};
const row = (path: string): Classified => ({ project: "app", path, status: "amber" as BoardStatus, kind: "", note: "" });
const rows = ["a.md", "b.md", "c.md", "w1.md", "w2.md", "s.md", "z.md"].map(row);
const build = (c: BoardConfig = cfg) => buildBoard(c, rows, undefined, true, undefined);
const model = build();
const id = (path: string, m = model): number => m.items.find((i) => i.path === path)!.id;
const gid = (path: string, m = model): string => m.items.find((i) => i.path === path)!.group!.id;
const ctx: DropContext = { rows, projects: cfg.projects, categories: [], groups: cfg.groups };
const refused = (p: ReturnType<typeof planDrop>): string => (p.ok ? "" : p.key);
const paths = (p: ReturnType<typeof planDrop>): string[] => (p.ok && p.kind === "order" ? p.paths : []);
const shown = (m = model): string[] => applyOrder(m.items.filter((i) => i.group?.id === gid("a.md", m)), m.order).map((i) => i.path);

test("order lists keep text paths once each, capped, and drop empty or odd lists", () => {
  assert.deepEqual(orderLists({ app: ["a", "b", "a", 3, null], x: [], y: "no" }), { app: ["a", "b"] });
  assert.deepEqual(orderLists([1]), {});
  assert.deepEqual(orderLists(undefined), {});
  assert.equal(orderLists({ app: Array.from({ length: MAX_ORDER + 5 }, (_, i) => "p" + i) }).app.length, MAX_ORDER);
});

test("rows with a place come first in list order, the rest follow in the automatic order, unknown paths are ignored", () => {
  assert.deepEqual(shown(), ["a.md", "b.md", "c.md"]);
  assert.deepEqual(shown(build({ ...cfg, order: { app: ["c.md", "gone.md", "a.md"] } })), ["c.md", "a.md", "b.md"]);
  assert.deepEqual(shown(build({ ...cfg, order: { other: ["c.md"] } })), ["a.md", "b.md", "c.md"], "another project's list changes nothing");
  assert.equal(model.order, undefined);
});

test("the board paints a group in its set order, with a gap between rows and after the last", () => {
  const m = build({ ...cfg, order: { app: ["c.md", "a.md", "b.md"] } });
  const html = renderBoard(m, t, "n", 0, { groupBy: "group" });
  const at = (n: number): number => html.indexOf(`data-drop="gap" data-to="${gid("a.md", m)}" data-at="${n}"`);
  assert.ok(at(0) > 0 && at(0) < at(1) && at(1) < at(2) && at(2) < at(3) && at(4) < 0, "gaps 0 to 3");
  const rowAt = (p: string): number => html.indexOf(`data-id="${id(p, m)}" draggable`);
  assert.ok(rowAt("c.md") < rowAt("a.md") && rowAt("a.md") < rowAt("b.md"));
  assert.ok(html.includes('aria-hidden="true" data-drop="gap"') && !html.includes("data-focus="));
  const mv = renderBoard(m, t, "n", 0, { groupBy: "group", moved: { project: "app", path: "b.md", ctl: 2, say: 'Moved <b> "$&"' } });
  assert.ok(mv.includes(`data-focus="${id("b.md", m)}" data-ctl="2" data-say="Moved &#60;b&#62;`), "the repaint after a saved move names the row, the control and the words");
  assert.equal(html.match(/data-drop="gap"/g)?.length, 7, "three gaps for the two rows of Wild, four for Launch; the one-row group and the rest have none");
});

test("a drop in a gap moves the row there and writes every row of the group in its new order", () => {
  const to = gid("a.md");
  assert.deepEqual(paths(planDrop({ zone: "gap", id: id("a.md"), to, at: 3 }, model, ctx)), ["b.md", "c.md", "a.md"]);
  assert.deepEqual(paths(planDrop({ zone: "gap", id: id("c.md"), to, at: 0 }, model, ctx)), ["c.md", "a.md", "b.md"]);
  assert.deepEqual(paths(planDrop({ zone: "gap", id: id("a.md"), to, at: 2 }, model, ctx)), ["b.md", "a.md", "c.md"]);
  const p = planDrop({ zone: "gap", id: id("a.md"), to, at: 3 }, model, ctx);
  assert.ok(p.ok && p.kind === "order" && p.paths.length === 3);
});

test("a row dropped where it already is, in the gap before or after itself, is refused with no notice", () => {
  const to = gid("a.md");
  assert.equal(refused(planDrop({ zone: "gap", id: id("b.md"), to, at: 1 }, model, ctx)), "");
  assert.equal(refused(planDrop({ zone: "gap", id: id("b.md"), to, at: 2 }, model, ctx)), "");
  assert.equal(planDrop({ zone: "gap", id: id("a.md"), to, at: 0 }, model, ctx).ok, false);
});

test("the keyboard moves a row one place; the first and last row cannot go further, quietly", () => {
  assert.deepEqual(paths(planDrop({ zone: "move", id: id("b.md"), to: -1 }, model, ctx)), ["b.md", "a.md", "c.md"]);
  assert.deepEqual(paths(planDrop({ zone: "move", id: id("b.md"), to: 1 }, model, ctx)), ["a.md", "c.md", "b.md"]);
  assert.equal(refused(planDrop({ zone: "move", id: id("a.md"), to: -1 }, model, ctx)), "releaseBoard.reorder.firstSay");
  assert.equal(refused(planDrop({ zone: "move", id: id("c.md"), to: 1 }, model, ctx)), "releaseBoard.reorder.lastSay");
  assert.equal(refused(planDrop({ zone: "move", id: id("b.md"), to: 2 }, model, ctx)), "releaseBoard.drop.gone");
  const m = build({ ...cfg, order: { app: ["c.md", "b.md"] } });
  assert.deepEqual(paths(planDrop({ zone: "move", id: id("a.md", m), to: -1 }, m, ctx)), ["c.md", "a.md", "b.md"], "moves in the order shown");
});

test("each refusal: a group the board found, a pattern, several projects, no group, another group, ids that are not on the board", () => {
  const auto = buildBoard({ ...cfg, groups: [] }, [row("PLAN_x_1.md"), row("PLAN_x_2.md"), row("PLAN_x_3.md")], undefined, true, undefined);
  const found = auto.items.find((i) => i.group);
  if (found) {
    assert.equal(refused(planDrop({ zone: "move", id: found.id, to: 1 }, auto, ctx)), "releaseBoard.reorder.autoGroup");
  }
  assert.equal(refused(planDrop({ zone: "move", id: id("w1.md"), to: 1 }, model, ctx)), "releaseBoard.reorder.claimed");
  assert.equal(refused(planDrop({ zone: "gap", id: id("w1.md"), to: gid("w1.md"), at: 2 }, model, ctx)), "releaseBoard.reorder.claimed");
  assert.equal(refused(planDrop({ zone: "move", id: id("z.md"), to: 1 }, model, ctx)), "releaseBoard.reorder.noGroup");
  assert.equal(refused(planDrop({ zone: "gap", id: id("z.md"), to: gid("a.md"), at: 1 }, model, ctx)), "releaseBoard.reorder.noGroup");
  assert.equal(refused(planDrop({ zone: "gap", id: id("a.md"), to: gid("s.md"), at: 0 }, model, ctx)), "releaseBoard.reorder.otherGroup");
  assert.equal(refused(planDrop({ zone: "gap", id: id("a.md"), to: "no-such-group", at: 0 }, model, ctx)), "releaseBoard.drop.gone");
  assert.equal(refused(planDrop({ zone: "gap", id: id("a.md"), to: gid("a.md"), at: 9 }, model, ctx)), "releaseBoard.drop.gone");
  assert.equal(refused(planDrop({ zone: "gap", id: id("a.md"), to: gid("a.md"), at: 1.5 }, model, ctx)), "releaseBoard.drop.gone");
  assert.equal(refused(planDrop({ zone: "gap", id: 99, to: gid("a.md"), at: 1 }, model, ctx)), "releaseBoard.drop.gone");
  const two = buildBoard({ ...cfg, projects: [...cfg.projects, { id: "web", name: "Web", path: "web", roots: [], ruleSets: [] }], groups: [{ name: "Both", match: ["app/a.md", "web/x.md"] }] }, [row("a.md"), { ...row("x.md"), project: "web" }], undefined, true, undefined);
  assert.equal(refused(planDrop({ zone: "move", id: id("a.md", two), to: 1 }, two, ctx)), "releaseBoard.reorder.mixed");
});

test("the rules file gets the project's list: the group's rows last, only paths gone from disk pruned, no duplicates", () => {
  const out = (text: string | undefined, p: string[], gone: string[] = []): Record<string, unknown> => {
    const r = setProjectOrder(text, { project: "app", paths: p, gone: new Set(gone) });
    assert.ok(r.ok, r.ok ? "" : r.reason);
    return JSON.parse(r.text);
  };
  assert.deepEqual(out(undefined, ["b.md", "a.md"]), { version: 1, order: { app: ["b.md", "a.md"] } });
  const before = JSON.stringify({ order: { app: ["d.md", "gone.md", "a.md", "d.md"], web: ["x.md"] } });
  assert.deepEqual(out(before, ["b.md", "a.md"], ["gone.md"]).order, { app: ["d.md", "b.md", "a.md"], web: ["x.md"] });
});

test("a partial scan erases nothing: other groups' entries stay unless the file is verifiably gone", () => {
  // The scan holds only a.md and b.md; other.md (another group) and missing.md are not in it.
  const before = JSON.stringify({ order: { app: ["other.md", "missing.md", "a.md", "b.md"] } });
  const kept = setProjectOrder(before, { project: "app", paths: ["b.md", "a.md"], gone: new Set() });
  assert.ok(kept.ok && JSON.stringify(JSON.parse(kept.text).order.app) === JSON.stringify(["other.md", "missing.md", "b.md", "a.md"]));
  const pruned = setProjectOrder(before, { project: "app", paths: ["b.md", "a.md"], gone: new Set(["missing.md"]) });
  assert.ok(pruned.ok && JSON.stringify(JSON.parse(pruned.text).order.app) === JSON.stringify(["other.md", "b.md", "a.md"]));
});

test("an order that comes out as it was, a bad name or a bad shape writes nothing", () => {
  const gone = new Set<string>();
  const same = JSON.stringify({ order: { app: ["a.md", "b.md"] } });
  assert.deepEqual(setProjectOrder(same, { project: "app", paths: ["a.md", "b.md"], gone }), { ok: false, reason: "same" });
  assert.deepEqual(setProjectOrder(undefined, { project: "app", paths: ["a*.md"], gone }), { ok: false, reason: "glob" });
  assert.deepEqual(setProjectOrder('{"order":[]}', { project: "app", paths: ["a.md"], gone }), { ok: false, reason: "shape" });
  assert.deepEqual(setProjectOrder('{"order":{"app":"a"}}', { project: "app", paths: ["a.md"], gone }), { ok: false, reason: "shape" });
  assert.deepEqual(setProjectOrder("{nope", { project: "app", paths: ["a.md"], gone }), { ok: false, reason: "parse" });
});

test("the cap is the same on read and write: a full list is refused, never trimmed, and 600 hand-written entries read and re-write the same", () => {
  const gone = new Set<string>();
  const old = Array.from({ length: MAX_ORDER }, (_, i) => "p" + i);
  const full = setProjectOrder(JSON.stringify({ groups: [{ name: "G", match: [] }], order: { app: old } }), { project: "app", paths: ["a.md"], gone });
  assert.deepEqual(full, { ok: false, reason: "full" }, "no other entry is discarded to make room");
  assert.deepEqual(setProjectOrder(undefined, { project: "app", paths: Array.from({ length: MAX_ORDER + 1 }, (_, i) => "p" + i), gone }), { ok: false, reason: "full" });
  // A room made by a path that is gone from disk.
  const room = setProjectOrder(JSON.stringify({ groups: [{ name: "G", match: [] }], order: { app: old } }), { project: "app", paths: ["a.md"], gone: new Set(["p0"]) });
  assert.ok(room.ok);
  const out = JSON.parse(room.ok ? room.text : "{}");
  assert.equal(out.order.app.length, MAX_ORDER);
  assert.equal(out.order.app.at(-1), "a.md");
  assert.deepEqual(out.groups, [{ name: "G", match: [] }]);
  // 600 hand-written entries: the board reads the first MAX_ORDER; the write keeps those and drops the rest.
  const six = Array.from({ length: 600 }, (_, i) => "q" + i);
  assert.deepEqual(orderLists({ app: six }).app, six.slice(0, MAX_ORDER));
  const re = setProjectOrder(JSON.stringify({ order: { app: six } }), { project: "app", paths: ["q1", "q0"], gone });
  assert.ok(re.ok);
  assert.deepEqual(JSON.parse(re.ok ? re.text : "{}").order.app, [...six.slice(2, MAX_ORDER), "q1", "q0"]);
  // The planner refuses a group of more rows than the list holds.
  const many = Array.from({ length: MAX_ORDER + 2 }, (_, i) => "f" + i + ".md");
  const big = buildBoard({ ...cfg, groups: [{ name: "Big", match: many.map((p) => "app/" + p) }] }, many.map(row), undefined, true, undefined);
  assert.equal(refused(planDrop({ zone: "move", id: big.items.find((i) => i.path === "f5.md")!.id, to: 1 }, big, ctx)), "releaseBoard.reorder.full");
});

test("a gap id that is not text, is refused with its own words; edge presses are said", () => {
  assert.equal(refused(planDrop({ zone: "gap", id: id("a.md"), to: 5, at: 0 }, model, ctx)), "releaseBoard.drop.gone");
  assert.equal(refused(planDrop({ zone: "gap", id: id("a.md"), to: null, at: 0 }, model, ctx)), "releaseBoard.drop.gone");
  assert.equal(refused(planDrop({ zone: "move", id: id("a.md"), to: -1 }, model, ctx)), "releaseBoard.reorder.firstSay");
  assert.equal(refused(planDrop({ zone: "move", id: id("c.md"), to: 1 }, model, ctx)), "releaseBoard.reorder.lastSay");
});

test("a group of several projects keeps the automatic order on the page", () => {
  const two = buildBoard({ ...cfg, projects: [...cfg.projects, { id: "web", name: "Web", path: "web", roots: [], ruleSets: [] }], groups: [{ name: "Both", match: ["app/a.md", "web/x.md", "app/b.md"] }], order: { app: ["b.md", "a.md"] } }, [row("a.md"), row("b.md"), { ...row("x.md"), project: "web" }], undefined, true, undefined);
  const html = renderBoard(two, t, "n", 0, { groupBy: "group" });
  assert.ok(!html.includes('data-drop="gap"'));
});

test("the page script sends the gap and the move as ids and numbers, and announces the moved row", () => {
  assert.ok(DRAG_SCRIPT.includes("at:Number(z.dataset.at)") && DRAG_SCRIPT.includes("zone:'move'"));
  assert.ok(DRAG_SCRIPT.includes("e.altKey") && DRAG_SCRIPT.includes("ArrowUp") && DRAG_SCRIPT.includes("lv.say") && !DRAG_SCRIPT.includes("setState"));
});
