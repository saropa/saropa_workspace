// Gantt focus: the Up next list, the in-progress pill, sections closed by default with a red count, the row limit
// from the board size, and folder-group sub-headers. Everything through buildBoard and the real panel renderer.

import { test } from "node:test";
import assert from "node:assert/strict";
import { BoardStrings } from "../../board/boardHtmlUtil";
import { GANTT_SCRIPT, ganttPanel, ganttRows } from "../../board/boardHtmlGantt";
import { UP_NEXT, buildGantt, upNext } from "../../board/ganttModel";
import { buildBoard } from "../../board/boardModel";
import { readFacts } from "../../board/docFacts";
import { ScanSnapshot } from "../../board/scanner";
import { BoardConfig, BoardStatus, Classified, emptyCounts } from "../../board/types";

const t: BoardStrings = new Proxy({} as BoardStrings, { get: (_o, k: string) => `[${k}]` });
const project = (id: string) => ({ id, name: id.toUpperCase(), path: id, roots: [], ruleSets: [] });
const cfgOf = (...ids: string[]): BoardConfig => ({ version: 1, ignore: [], ruleSets: {}, projects: ids.map(project) });
const row = (p: string, path: string, status: BoardStatus): Classified => ({ project: p, path, status, kind: "", note: "" });

function snapshotOf(files: Record<string, string>): ScanSnapshot {
  const facts = Object.fromEntries(Object.entries(files).map(([p, text]) => [p, { size: text.length, mtimeMs: 1, facts: readFacts(text, p) }]));
  return { version: 1, takenAt: 1, projects: { app: { counts: emptyCounts(), folders: {}, ruleCounts: {}, greyFolders: {}, files: {}, facts } } };
}

// Reds: a (free), b waits on a, c (free, d and e wait on it), f to k (free, no one waits). Purple: p, q.
const chain = {
  "a.md": "# A\n",
  "b.md": "# B\n\nNeeds: a.md\n",
  "c.md": "# C\n",
  "d.md": "# D\n\nNeeds: c.md\n",
  "e.md": "# E\n\nNeeds: c.md\n",
  "f.md": "# F\n",
  "g.md": "# G\n",
  "h.md": "# H\n",
  "p.md": "# P\n",
  "q.md": "# Q\n",
};
const status = (p: string): BoardStatus => (p === "p.md" || p === "q.md" ? "purple" : "red");
const cfg1 = cfgOf("app");
const small = buildBoard(cfg1, Object.keys(chain).map((p) => row("app", p, status(p))), undefined, true, snapshotOf(chain));

test("Up next: in progress first, then blockers that wait on nothing by how much they unblock; at most five; nothing twice", () => {
  const titles = upNext(small).map((i) => i.title);
  assert.equal(titles.length, UP_NEXT);
  assert.deepEqual(titles.slice(0, 2).sort(), ["P", "Q"], "in progress first");
  assert.equal(titles[2], "C", "C unblocks two items");
  assert.ok(!titles.includes("B") && !titles.includes("D"), "an item that waits is not picked");
  assert.equal(new Set(titles).size, titles.length);
  assert.deepEqual(upNext(small, 2).length, 2);
});

test("Up next: an empty board and an all-blocked board give nothing", () => {
  assert.deepEqual(upNext(buildBoard(cfg1, [], undefined, true)), []);
  assert.ok(!ganttPanel(buildBoard(cfg1, [], undefined, true), t).includes("gUpNext"));
  const loop = { "x.md": "# X\n\nNeeds: y.md\n", "y.md": "# Y\n\nNeeds: x.md\n" };
  const m = buildBoard(cfg1, Object.keys(loop).map((p) => row("app", p, "red")), undefined, true, snapshotOf(loop));
  assert.ok(upNext(m).length <= 1, "a loop is cut once, so at most one end is free");
});

test("the panel draws Up next with the reason in each tooltip, marks the same rows below, and the pill turns amber past three", () => {
  const html = ganttPanel(small, t);
  assert.ok(html.includes('id="gUpNext"'));
  assert.equal(html.match(/<li class="gu" title="upNextWhy"/g)?.length, UP_NEXT);
  assert.equal(html.match(/<span class="upn"/g)?.length, UP_NEXT, "each is marked in its project");
  assert.ok(html.includes('class="gwip"') && !html.includes("gwip over"), "two in progress: not amber");
  const four = { ...chain, "r.md": "# R\n", "s.md": "# S\n" };
  const m = buildBoard(cfg1, Object.keys(four).map((p) => row("app", p, ["p.md", "q.md", "r.md", "s.md"].includes(p) ? "purple" : "red")), undefined, true, snapshotOf(four));
  assert.ok(ganttPanel(m, t).includes('class="gwip over"'), "four in progress: amber");
});

// Five projects of 220 documents in folders: a board of 1100, so the layout folds.
const big = (): ReturnType<typeof buildBoard> => {
  const ids = ["p0", "p1", "p2", "p3", "p4"];
  const rows: Classified[] = ids.flatMap((id, n) => Array.from({ length: 220 }, (_v, k) => row(id, `docs/area${k % 4}/sub${k % 3}/PLAN_${k}.md`, k < (n + 1) * 2 ? "red" : "amber")));
  return buildBoard(cfgOf(...ids), rows, undefined, true);
};

test("a big board starts with the three projects with the most blockers open; closed headers still show the red count", () => {
  const m = big();
  const groups = buildGantt(m);
  assert.deepEqual(groups.map((g) => g.blocks), [2, 4, 6, 8, 10]);
  const html = ganttPanel(m, t);
  const sections = html.match(/<section class="gg[^"]*" data-gk="[^"]+"/g) ?? [];
  assert.equal(sections.length, 5);
  assert.deepEqual(sections.filter((s) => s.includes("gg col")).map((s) => /data-gk="([^"]+)"/.exec(s)![1]).sort(), ["p0", "p1"], "the two with the fewest blockers are closed");
  assert.ok((html.match(/<span class="gred">/g)?.length ?? 0) >= 5, "every project header shows its red count");
  assert.ok(/aria-expanded="false" aria-controls="gr0"/.test(html), "a closed header says so");
});

test("rows past the limit wait for Show more; rows of a closed section keep their drop slot and move buttons", () => {
  const m = big();
  const html = ganttPanel(m, t);
  const g = buildGantt(m)[4];
  assert.ok(g.rows.some((r) => r.sub), "the fixture has folder groups");
  const open = /<section class="gg" data-gk="p4"[\s\S]*?<\/section>/.exec(html)![0];
  const from = Number(/data-rowsmore[^>]*data-from="(\d+)"/.exec(open)![1]);
  assert.equal(open.match(/<li class="gr[^"]*" tabindex/g)?.length, from, "the first view draws exactly the rows before Show more");
  assert.ok(from <= 150);
  const rest = ganttRows(m, t, undefined, "p4", from)!;
  assert.equal(rest.count, g.rows.length - from);
  assert.equal(rest.html.match(/<li class="gr/g)?.length, g.rows.length - from);
  assert.ok(rest.html.includes("data-drop=\"waits\""), "every loaded row is a drop target");
  const closed = /<section class="gg col" data-gk="p0"[\s\S]*?<\/section>/.exec(html)![0];
  assert.ok(closed.includes('data-drop="waits"') && closed.includes("data-drag="), "a closed section still holds its rows");
});

test("folder groups are collapsed sub-headers with counts; their rows start hidden and carry the fold key", () => {
  const m = big();
  const html = ganttPanel(m, t);
  const heads = html.match(/<li class="gsub"><button type="button" class="gsb" data-sk="[^"]+" aria-expanded="false"/g) ?? [];
  assert.ok(heads.length >= 4, "every group of the first view has a header");
  const rows = buildGantt(m)[0].rows.filter((r) => r.sub);
  assert.ok(rows.length > 0);
  const subs = new Set(rows.map((r) => r.sub!.id));
  const firsts = buildGantt(m)[0].rows.filter((r, k, all) => r.sub && all[k - 1]?.sub?.id !== r.sub.id);
  assert.equal(firsts.length, subs.size, "each group's rows are together, so one header each");
  assert.ok(/<li class="gr[^"]*" tabindex="0" data-gid="\d+" data-after="[^"]*" data-sk="[^"]+" hidden/.test(html));
  const u = buildGantt(m, undefined, "unified");
  assert.ok(u[0].rows.every((r) => r.sub === undefined), "no groups in the unified list");
});

test("the page script remembers opened sections and groups, and opens a closed one under a dragged row", () => {
  assert.ok(GANTT_SCRIPT.includes("gopen") && GANTT_SCRIPT.includes("gcol"));
  assert.ok(GANTT_SCRIPT.includes("'dragover'") && GANTT_SCRIPT.includes("document.body.classList.contains('dragging')"));
});
