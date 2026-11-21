// The Gantt model: the finished-history picker, the work-queue layout (placeQueue), the per-layout
// grouping (local, split, unified), row status and flags, the board-size cut of finished rows, the
// outline cap, and the Up next list. All inputs are hand-built models; nothing reads a file.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { BoardItem, BoardModel, BoardProject } from "../../board/boardModelParts";
import { MAX_FINISHED, MAX_OUTLINED, UP_NEXT, buildGantt, finishedTargets, inProgressCount, placeQueue, shownModel, upNext } from "../../board/ganttModel";
import type { GanttRow } from "../../board/ganttModel";
import type { Link } from "../../board/links";
import { sinceKey } from "../../board/sinceLast";

// Float-safe comparison: bar positions are rounded to one decimal, but the width is a difference of two values.
const near = (actual: number, expected: number, msg?: string): void => assert.ok(Math.abs(actual - expected) < 1e-6, `${msg ?? "value"}: expected ${expected}, got ${actual}`);

// An open item with the required fields filled in; `over` sets whatever a test cares about.
const item = (id: number, over: Partial<BoardItem> = {}): BoardItem => ({
  id,
  project: "app",
  path: `d${id}.md`,
  title: `T${id}`,
  status: "amber",
  kind: "",
  hub: false,
  blocksCount: 0,
  waitsOn: [],
  pinned: false,
  stopping: false,
  blocks: false,
  ...over,
});

// A project holding the given items; `over` sets the light, folderRank, extra and so on.
const project = (id: string, items: BoardItem[], over: Partial<BoardProject> = {}): BoardProject => ({
  id,
  name: id.toUpperCase(),
  light: "unverified",
  reasons: [],
  items,
  blocked: 0,
  blockedStopping: 0,
  counts: {} as BoardProject["counts"],
  dependsOn: [],
  ...over,
});

// Only the fields the Gantt reads are set; the rest of the board model is irrelevant here.
const modelOf = (projects: BoardProject[], extra: Partial<BoardModel> = {}): BoardModel => ({ projects, items: projects.flatMap((p) => p.items), ...extra }) as unknown as BoardModel;

// A bare open row for placeQueue (id set) or a finished row (id omitted).
const row = (id: number | undefined, after: number[] = [], minutes = 0): GanttRow => ({ ...(id === undefined ? {} : { id }), title: `R${id}`, path: `r${id}.md`, status: "amber", start: 0, width: 0, minutes, after, waits: [], askedNames: [], inferred: [], changed: false });

const link = (over: Partial<Link>): Link => ({ fromProject: "app", fromPath: "from.md", target: "t", state: "done", ...over });

test("finishedTargets keeps only done links that resolved to a document, once each, in link order", () => {
  const links = [
    link({ state: "open", toProject: "app", toPath: "open.md" }),
    link({ toProject: "app", toPath: "b.md" }),
    // A done link with no resolved path cannot name a history row.
    link({ toProject: "app" }),
    link({ toProject: "app", toPath: "a.md" }),
    // The same target from a second document is one history row, not two.
    link({ fromPath: "other.md", toProject: "app", toPath: "b.md" }),
  ];
  const out = finishedTargets(links, (p, path) => `${p}:${path}`);
  assert.deepEqual(out.map((f) => f.path), ["b.md", "a.md"]);
  // The title comes from the lookup the caller passes in.
  assert.equal(out[0].title, "app:b.md");
});

test("finishedTargets returns nothing for no links", () => {
  assert.deepEqual(finishedTargets([], () => "x"), []);
});

test("finishedTargets never lists a reference document as history", () => {
  const links = [link({ toProject: "app", toPath: "ref.md" }), link({ toProject: "app", toPath: "real.md" })];
  const out = finishedTargets(links, () => "t", (_p, path) => path === "ref.md");
  assert.deepEqual(out.map((f) => f.path), ["real.md"]);
});

test("finishedTargets caps history per project, and one project's cap does not use up another's", () => {
  const links: Link[] = [];
  for (let k = 0; k < MAX_FINISHED + 5; k++) {
    links.push(link({ toProject: "app", toPath: `f${k}.md` }));
  }
  links.push(link({ toProject: "lib", toPath: "x.md" }));
  const out = finishedTargets(links, () => "t");
  assert.equal(out.filter((f) => f.project === "app").length, MAX_FINISHED);
  // The cap keeps the first ones in link order, so the extras are the last five.
  assert.equal(out.filter((f) => f.project === "app").pop()?.path, `f${MAX_FINISHED - 1}.md`);
  assert.equal(out.filter((f) => f.project === "lib").length, 1);
});

test("placeQueue lays unrelated rows end to end and scales the queue to fill 0 to 100", () => {
  const rows = [row(1), row(2)];
  placeQueue(rows);
  // Unknown minutes count as the 30-minute standard, so two rows split the axis evenly.
  near(rows[0].start, 0);
  near(rows[0].width, 50);
  near(rows[1].start, 50);
  near(rows[1].width, 50);
});

test("placeQueue sizes a bar by its minutes", () => {
  const rows = [row(1, [], 60), row(2, [], 30)];
  placeQueue(rows);
  // 60 then 30 minutes: total 90, so the first bar is two thirds of the axis.
  near(rows[0].width, 66.7);
  near(rows[1].start, 66.7);
  near(rows[1].width, 33.3);
});

test("placeQueue keeps a very short bar visible with a minimum width", () => {
  const rows = [row(1, [], 1), row(2, [], 30)];
  placeQueue(rows);
  // One minute is raised to 35 percent of the 30-minute standard (10.5), so it is wider than 1/31 of the axis.
  assert.ok(rows[0].width > 100 / 31, `width ${rows[0].width}`);
  near(rows[0].width, 25.9);
});

test("placeQueue places a dependency shown later before its waiter, keeping the display order", () => {
  const rows = [row(1, [2]), row(2)];
  placeQueue(rows);
  // Row 2 is placed first (0 to 30) so row 1 starts at its end, though row 1 is listed first.
  near(rows[1].start, 0);
  near(rows[0].start, 50);
  assert.deepEqual(rows.map((r) => r.id), [1, 2]);
});

test("placeQueue ignores a dependency that is not among the rows", () => {
  const rows = [row(1, [99])];
  placeQueue(rows);
  near(rows[0].start, 0);
  near(rows[0].width, 100);
});

test("placeQueue cuts a loop of dependencies instead of recursing forever", () => {
  const rows = [row(1, [2]), row(2, [1])];
  placeQueue(rows);
  // The loop is cut where it closes: row 2 is placed first, then row 1 after it. Both get a bar.
  near(rows[1].start, 0);
  near(rows[0].start, 50);
  assert.ok(rows.every((r) => r.width > 0));
});

test("placeQueue leaves finished rows (no id) as they are", () => {
  const done = row(undefined);
  done.start = 7;
  done.width = 9;
  const rows = [done, row(1)];
  placeQueue(rows);
  assert.equal(done.start, 7);
  assert.equal(done.width, 9);
  near(rows[1].width, 100);
});

test("placeQueue with no rows or only finished rows changes nothing and does not throw", () => {
  placeQueue([]);
  const done = row(undefined);
  done.width = 12;
  placeQueue([done]);
  assert.equal(done.width, 12);
});

test("placeQueue keeps the last bar inside the axis even when it is tiny next to a huge one", () => {
  const rows = [row(1, [], 10000), row(2, [], 1)];
  placeQueue(rows);
  // Start is capped at 99.9 and the width is clamped to what is left of the axis, so the bar stays visible
  // (positive width) without leaving 0 to 100.
  assert.ok(rows[1].start <= 99.9);
  assert.ok(rows[1].width > 0);
  assert.ok(rows[1].start + rows[1].width <= 100 + 1e-9);
});

test("shownModel in local layout drops extra projects and their items, and returns the same model when none are extra", () => {
  const home = project("home", [item(1, { project: "home" })]);
  const extra = project("away", [item(2, { project: "away" })], { extra: true });
  const model = modelOf([home, extra]);
  const local = shownModel(model, "local");
  assert.deepEqual(local.projects.map((p) => p.id), ["home"]);
  assert.deepEqual(local.items.map((i) => i.id), [1]);
  // Split and unified draw every project.
  assert.equal(shownModel(model, "split"), model);
  assert.equal(shownModel(model, "unified"), model);
  // Nothing to hide: no copy is made.
  const plain = modelOf([home]);
  assert.equal(shownModel(plain, "local"), plain);
});

test("buildGantt builds one group per project with the open rows in work order", () => {
  // B waits on A but is listed first; work order puts A first.
  const a = item(1, { status: "red", blocks: true, openMinutes: 60 });
  const b = item(2, { waitsOn: [1] });
  const groups = buildGantt(modelOf([project("app", [b, a], { name: "App", light: "no-go" })]));
  assert.equal(groups.length, 1);
  const g = groups[0];
  assert.equal(g.id, "app");
  assert.equal(g.name, "App");
  assert.equal(g.light, "no-go");
  assert.equal(g.open, 2);
  // Only a row that blocks the release counts toward the red total a closed header shows.
  assert.equal(g.blocks, 1);
  assert.equal(g.finishedCut, 0);
  assert.deepEqual(g.rows.map((r) => r.id), [1, 2]);
  assert.equal(g.rows[0].minutes, 60);
  near(g.rows[0].width, 66.7);
  assert.deepEqual(g.rows[1].after, [1]);
  assert.deepEqual(g.rows[1].waits, ["T1"]);
});

test("buildGantt keeps a project with no open item so its release light stays visible", () => {
  const groups = buildGantt(modelOf([project("empty", []), project("app", [item(1)])]));
  assert.deepEqual(groups.map((g) => g.id), ["empty", "app"]);
  assert.equal(groups[0].open, 0, "the empty project has zero open rows");
  assert.equal(groups[0].rows.length, 0, "the empty project has no rows");
});

test("buildGantt row status: blockers are red, a red-folder non-blocker is amber and serious, purple stays purple", () => {
  const items = [item(1, { status: "red", blocks: true }), item(2, { status: "red", blocks: false }), item(3, { status: "purple" }), item(4, { status: "amber" })];
  const rows = buildGantt(modelOf([project("app", items)]))[0].rows;
  const by = (id: number): GanttRow => rows.find((r) => r.id === id)!;
  assert.equal(by(1).status, "red");
  assert.equal(by(1).serious, undefined);
  // Red folder but the owner did not mark it as blocking: shown amber with the "Address now" flag.
  assert.equal(by(2).status, "amber");
  assert.equal(by(2).serious, true);
  assert.equal(by(3).status, "purple");
  assert.equal(by(4).status, "amber");
});

test("buildGantt separates waits (Needs) from answers (after) and inferred links, and drops unknown ids from the names", () => {
  const items = [item(1), item(2), item(3, { waitsOn: [1, 99], after: [2], inferred: [1, 98] })];
  const r = buildGantt(modelOf([project("app", items)]))[0].rows.find((x) => x.id === 3)!;
  // Both kinds of dependency place the bar, in this order.
  assert.deepEqual(r.after, [1, 99, 2]);
  // Titles are looked up by id; an id that is not on the board has no title to show.
  assert.deepEqual(r.waits, ["T1"]);
  assert.deepEqual(r.askedNames, ["T2"]);
  assert.deepEqual(r.inferred, ["T1"]);
});

test("buildGantt tags a row with its folder group unless the project is flat", () => {
  const items = [item(1, { group: { id: "g1", name: "One" } }), item(2, { group: { id: "g2", name: "Two", flat: true } }), item(3)];
  const rows = buildGantt(modelOf([project("app", items)]))[0].rows;
  assert.deepEqual(rows.find((r) => r.id === 1)?.sub, { id: "g1", name: "One" });
  assert.equal(rows.find((r) => r.id === 2)?.sub, undefined);
  assert.equal(rows.find((r) => r.id === 3)?.sub, undefined);
});

test("buildGantt gathers a folder's rows together: groups with a blocker first, ungrouped rows in between", () => {
  const items = [item(1), item(2, { group: { id: "g1", name: "One" } }), item(3, { status: "red", blocks: true, group: { id: "g2", name: "Two" } })];
  const ids = buildGantt(modelOf([project("app", items)]))[0].rows.map((r) => r.id);
  // g2 holds a blocker so it leads; the ungrouped row follows; the quiet group g1 comes last.
  assert.deepEqual(ids, [3, 1, 2]);
});

test("buildGantt orders quiet folders by the owner's folder ranking, else by first appearance", () => {
  const items = [item(1, { group: { id: "g1", name: "One" } }), item(2, { group: { id: "g2", name: "Two" } })];
  const plain = buildGantt(modelOf([project("app", items)]))[0].rows.map((r) => r.id);
  assert.deepEqual(plain, [1, 2]);
  // A lower number is placed earlier, so ranking g2 ahead of g1 flips them.
  const ranked = buildGantt(modelOf([project("app", items, { folderRank: { g2: 1, g1: 2 } })]))[0].rows.map((r) => r.id);
  assert.deepEqual(ranked, [2, 1]);
});

test("buildGantt keeps a group's stored order inside the places its members hold", () => {
  const items = [item(1, { group: { id: "g1", name: "One" } }), item(2, { group: { id: "g1", name: "One" } })];
  // The stored order is by path, per project: d2 before d1.
  const m = modelOf([project("app", items)], { order: { app: ["d2.md", "d1.md"] } });
  assert.deepEqual(buildGantt(m)[0].rows.map((r) => r.id), [2, 1]);
});

test("buildGantt draws answered blockers of one rank most severe first, then the one more items wait on", () => {
  const blocker = (id: number, over: Partial<BoardItem>): BoardItem => item(id, { status: "red", blocks: true, answered: true, ...over });
  const items = [blocker(1, { severity: "low" }), blocker(2, { severity: "extreme" }), blocker(3, { severity: "high", blocksCount: 1 }), blocker(4, { severity: "high", blocksCount: 3 })];
  const ids = buildGantt(modelOf([project("app", items)]))[0].rows.map((r) => r.id);
  // extreme, then the two highs with the bigger blocksCount first, then low.
  assert.deepEqual(ids, [2, 4, 3, 1]);
});

test("buildGantt leaves same-rank rows in list order when the project was never answered", () => {
  const blocker = (id: number, severity: BoardItem["severity"]): BoardItem => item(id, { status: "red", blocks: true, severity });
  const ids = buildGantt(modelOf([project("app", [blocker(1, "low"), blocker(2, "extreme")])]))[0].rows.map((r) => r.id);
  assert.deepEqual(ids, [1, 2]);
});

test("buildGantt does not hang on items that wait on each other", () => {
  const items = [item(1, { waitsOn: [2] }), item(2, { waitsOn: [1] })];
  const rows = buildGantt(modelOf([project("app", items)]))[0].rows;
  // The loop is cut where it closes: item 2 has rank 0 and item 1 rank 1.
  assert.deepEqual(rows.map((r) => r.id), [2, 1]);
  assert.ok(rows.every((r) => r.width > 0));
});

test("buildGantt puts finished documents first as green rows with no id and a one-slot width", () => {
  const items = [item(1), item(2, { waitsOn: [1] })];
  const m = modelOf([project("app", items)], { finished: [{ project: "app", path: "done.md", title: "Done" }, { project: "other", path: "x.md", title: "X" }] });
  const g = buildGantt(m)[0];
  assert.equal(g.rows[0].id, undefined);
  assert.equal(g.rows[0].title, "Done");
  assert.equal(g.rows[0].status, "green");
  // Two ranks in the project means a finished row is half the axis wide; another project's finished row is not shown here.
  assert.equal(g.rows[0].width, 50);
  assert.equal(g.rows.length, 3);
  assert.equal(g.open, 2);
});

test("buildGantt keeps a project that has only finished documents, with no open rows", () => {
  const m = modelOf([project("app", [])], { finished: [{ project: "app", path: "done.md", title: "Done" }] });
  const g = buildGantt(m);
  assert.equal(g.length, 1);
  assert.equal(g[0].open, 0);
  assert.equal(g[0].rows.length, 1);
});

test("buildGantt keeps only the last two finished rows on a board of 50 documents and counts the cut ones", () => {
  const items = Array.from({ length: 50 }, (_v, k) => item(k + 1));
  const finished = [1, 2, 3, 4, 5].map((k) => ({ project: "app", path: `done${k}.md`, title: `Done ${k}` }));
  const g = buildGantt(modelOf([project("app", items)], { finished }))[0];
  assert.deepEqual(g.rows.filter((r) => r.id === undefined).map((r) => r.path), ["done4.md", "done5.md"]);
  assert.equal(g.finishedCut, 3);
});

test("buildGantt keeps no finished rows on a board of 200 documents, only the cut count", () => {
  const items = Array.from({ length: 200 }, (_v, k) => item(k + 1));
  const finished = [1, 2, 3].map((k) => ({ project: "app", path: `done${k}.md`, title: `Done ${k}` }));
  const g = buildGantt(modelOf([project("app", items)], { finished }))[0];
  assert.equal(g.rows.filter((r) => r.id === undefined).length, 0);
  assert.equal(g.finishedCut, 3);
});

test("buildGantt marks the rows Up next lists", () => {
  // Item 1 is a blocker waiting on nothing (in Up next); item 2 waits on it and is not a free blocker.
  const items = [item(1, { status: "red", blocks: true }), item(2, { status: "red", blocks: true, waitsOn: [1] }), item(3)];
  const rows = buildGantt(modelOf([project("app", items)]))[0].rows;
  assert.equal(rows.find((r) => r.id === 1)?.up, true);
  assert.equal(rows.find((r) => r.id === 2)?.up, undefined);
  assert.equal(rows.find((r) => r.id === 3)?.up, undefined);
});

test("buildGantt flags rows changed since the last look and does not flag any without a since view", () => {
  const items = [item(1), item(2)];
  const m = modelOf([project("app", items)]);
  const since = { heading: "h", lines: [], marked: [sinceKey(items[1])] };
  const rows = buildGantt(m, since)[0].rows;
  assert.equal(rows.find((r) => r.id === 1)?.changed, false);
  assert.equal(rows.find((r) => r.id === 2)?.changed, true);
  assert.ok(buildGantt(m)[0].rows.every((r) => !r.changed && !r.outlined));
});

test("buildGantt outlines at most MAX_OUTLINED changed rows, Up next rows first, the rest in display order", () => {
  const quiet = Array.from({ length: MAX_OUTLINED + 1 }, (_v, k) => item(k + 1));
  // The blocker is listed last but is in Up next, so it takes an outline before any quiet row does.
  const blocker = item(100, { status: "red", blocks: true });
  const all = [...quiet, blocker];
  const since = { heading: "h", lines: [], marked: all.map(sinceKey) };
  const rows = buildGantt(modelOf([project("app", all)]), since)[0].rows;
  assert.equal(rows.filter((r) => r.outlined).length, MAX_OUTLINED);
  assert.equal(rows.find((r) => r.id === 100)?.outlined, true);
  // Every changed row still says changed; only the outline is capped.
  assert.ok(rows.every((r) => r.changed));
  // The quiet rows past the cap are the last two in display order.
  assert.deepEqual(rows.filter((r) => !r.outlined).map((r) => r.id), [MAX_OUTLINED, MAX_OUTLINED + 1]);
});

test("buildGantt in local layout leaves out extra projects, and in split layout shows them", () => {
  const home = project("home", [item(1, { project: "home" })]);
  const away = project("away", [item(2, { project: "away" })], { extra: true });
  const m = modelOf([home, away]);
  assert.deepEqual(buildGantt(m, undefined, "local").map((g) => g.id), ["home"]);
  assert.deepEqual(buildGantt(m, undefined, "split").map((g) => g.id), ["home", "away"]);
});

test("buildGantt unified layout merges projects into one section: blockers first, rows tagged with their project", () => {
  const calm = project("calm", [item(1, { project: "calm" })], { name: "Calm", light: "go" });
  const hot = project("hot", [item(2, { project: "hot", status: "red", blocks: true })], { name: "Hot", light: "no-go" });
  const groups = buildGantt(modelOf([calm, hot]), undefined, "unified", "Everything");
  assert.equal(groups.length, 1);
  const g = groups[0];
  assert.equal(g.id, "all");
  assert.equal(g.name, "Everything");
  // The worst light of any project leads.
  assert.equal(g.light, "no-go");
  assert.equal(g.open, 2);
  assert.equal(g.blocks, 1);
  // The red row is sorted ahead of the amber one although its project is listed second.
  assert.deepEqual(g.rows.map((r) => [r.id, r.project]), [[2, "Hot"], [1, "Calm"]]);
  // The merged queue is placed as one: two standard bars share the axis.
  near(g.rows[0].start, 0);
  near(g.rows[1].start, 50);
});

test("buildGantt unified layout with a single project section is left as that project", () => {
  const groups = buildGantt(modelOf([project("app", [item(1)])]), undefined, "unified");
  assert.equal(groups.length, 1);
  assert.equal(groups[0].id, "app");
  // Nothing to merge, so no project tag is added.
  assert.equal(groups[0].rows[0].project, undefined);
});

test("buildGantt unified layout drops folder groups from the merged rows and sums the cut finished rows", () => {
  const a = project("a", Array.from({ length: 50 }, (_v, k) => item(k + 1, { project: "a", group: { id: "g", name: "G" } })));
  const b = project("b", [item(100, { project: "b" })]);
  const finished = [1, 2, 3, 4, 5].map((k) => ({ project: "a", path: `done${k}.md`, title: `D${k}` }));
  // 51 items is in the 50-document band, which keeps the last two finished rows and cuts the other three.
  const g = buildGantt(modelOf([a, b], { finished }), undefined, "unified")[0];
  // The merged section has no folder headings, so the group tag is removed.
  assert.ok(g.rows.every((r) => r.sub === undefined));
  assert.equal(g.finishedCut, 3);
  assert.equal(g.rows.filter((r) => r.id === undefined).length, 2);
});

test("upNext lists in-progress items first, then free blockers, and skips blocked and non-blocking items", () => {
  const items = [
    item(1, { status: "red", blocks: true }),
    // Waits on item 1, so it is not free to start.
    item(2, { status: "red", blocks: true, waitsOn: [1] }),
    // Comes after another item by the owner's answer: not free either.
    item(3, { status: "red", blocks: true, after: [1] }),
    // Not a blocker: never padded in.
    item(4),
    item(5, { status: "purple" }),
  ];
  assert.deepEqual(upNext(modelOf([project("app", items)])).map((i) => i.id), [5, 1]);
});

test("upNext ranks by what unblocks most, then severity, then the shortest job", () => {
  const blocker = (id: number, over: Partial<BoardItem>): BoardItem => item(id, { status: "red", blocks: true, ...over });
  const items = [
    blocker(1, { severity: "low" }),
    blocker(2, { severity: "extreme" }),
    blocker(3, { severity: "medium", blocksCount: 2 }),
    blocker(4, { severity: "medium", openMinutes: 50 }),
    blocker(5, { severity: "medium", openMinutes: 10 }),
  ];
  // 3 unblocks the most; then extreme; then the two mediums by shortest (10 before 50); low last.
  assert.deepEqual(upNext(modelOf([project("app", items)]), 10).map((i) => i.id), [3, 2, 5, 4, 1]);
});

test("upNext treats a missing severity as medium and unknown minutes as the 30-minute standard", () => {
  const items = [item(1, { status: "red", blocks: true, severity: "low" }), item(2, { status: "red", blocks: true }), item(3, { status: "red", blocks: true, openMinutes: 20 })];
  // 2 (medium) beats 1 (low) on severity; 3 (medium, 20 minutes) beats 2 (medium, 30 assumed).
  assert.deepEqual(upNext(modelOf([project("app", items)])).map((i) => i.id), [3, 2, 1]);
});

test("upNext breaks a full tie by project then path, so the order never depends on list order", () => {
  const items = [item(1, { project: "b", path: "z.md", status: "red", blocks: true }), item(2, { project: "a", path: "y.md", status: "red", blocks: true }), item(3, { project: "a", path: "x.md", status: "red", blocks: true })];
  assert.deepEqual(upNext(modelOf([project("a", items)])).map((i) => i.id), [3, 2, 1]);
});

test("upNext caps the list at UP_NEXT by default and at n when given", () => {
  const items = Array.from({ length: UP_NEXT + 3 }, (_v, k) => item(k + 1, { status: "red", blocks: true }));
  const m = modelOf([project("app", items)]);
  assert.equal(upNext(m).length, UP_NEXT);
  assert.equal(upNext(m, 2).length, 2);
  assert.equal(upNext(m, 0).length, 0);
});

test("upNext puts an item of a lower-ranked folder behind one with no folder rank, whatever it unblocks", () => {
  const items = [item(1, { status: "red", blocks: true, blocksCount: 9, group: { id: "g1", name: "One" } }), item(2, { status: "red", blocks: true })];
  const withRank = modelOf([project("app", items, { folderRank: { g1: 3 } })]);
  // The owner's folder answer outranks the unblock count.
  assert.deepEqual(upNext(withRank).map((i) => i.id), [2, 1]);
  // Without any ranking the unblock count decides.
  assert.deepEqual(upNext(modelOf([project("app", items)])).map((i) => i.id), [1, 2]);
});

test("upNext on an empty board is empty, and inProgressCount counts purple items only", () => {
  assert.deepEqual(upNext(modelOf([])), []);
  const items = [item(1, { status: "purple" }), item(2, { status: "purple" }), item(3), item(4, { status: "red" })];
  assert.equal(inProgressCount(modelOf([project("app", items)])), 2);
  assert.equal(inProgressCount(modelOf([])), 0);
});
