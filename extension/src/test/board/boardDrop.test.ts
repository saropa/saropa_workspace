// Drag and drop: what a dropped row means (each refusal, ids that are not on the board) and the
// page markup that makes rows draggable and gives the drop zones their words.

import { test } from "node:test";
import assert from "node:assert/strict";
import { BoardStrings, renderBoard } from "../../board/boardHtml";
import { DRAG_SCRIPT, statusBands } from "../../board/boardHtmlDrag";
import { ganttPanel } from "../../board/boardHtmlGantt";
import { DropContext, planDrop } from "../../board/boardDrop";
import { buildBoard } from "../../board/boardModel";
import { readFacts } from "../../board/docFacts";
import { RuleCategory } from "../../board/ruleAssign";
import { ScanSnapshot } from "../../board/scanner";
import { BoardConfig, BoardStatus, Classified, emptyCounts } from "../../board/types";

const t: BoardStrings = new Proxy({} as BoardStrings, { get: (_o, k: string) => `[${k}]` });

const cfg: BoardConfig = {
  version: 1,
  ignore: [],
  ruleSets: {},
  projects: [{ id: "app", name: "App", path: "app", roots: [], ruleSets: [] }],
  groups: [{ name: "Launch <b>", match: ["app/a.md"] }],
};
const row = (path: string, status: BoardStatus): Classified => ({ project: "app", path, status, kind: "", note: "" });
const files: Record<string, string> = { "a.md": "# Alpha\n", "b.md": "# Beta\n\nNeeds: a.md\n", "c.md": "# Gamma\n", "d.sql": "select 1;\n" };
const snapshot: ScanSnapshot = {
  version: 1,
  takenAt: 1,
  projects: { app: { counts: emptyCounts(), folders: {}, ruleCounts: {}, greyFolders: {}, files: {}, facts: Object.fromEntries(Object.entries(files).map(([p, text]) => [p, { size: text.length, mtimeMs: 1, facts: readFacts(text, p) }])) } },
};
const rows = [row("a.md", "amber"), row("b.md", "red"), row("c.md", "amber"), row("d.sql", "amber")];
const model = buildBoard(cfg, rows, undefined, true, snapshot);
const id = (title: string): number => model.items.find((i) => i.title === title)!.id;
const cat = (status: BoardStatus, kind?: string): RuleCategory => ({ status, kind, label: kind ? `${kind} (${status})` : status });
const ctx: DropContext = { rows, projects: cfg.projects, categories: [cat("red", "bug"), cat("red"), cat("purple")] };
const refused = (p: ReturnType<typeof planDrop>): string => (p.ok ? "" : p.key);

test("a status band gives the plainest category of that status", () => {
  const p = planDrop({ zone: "band", id: id("Alpha"), to: "red" }, model, ctx);
  assert.ok(p.ok && p.kind === "status" && p.category.kind === undefined && p.item.title === "Alpha");
});

test("a band the rules cannot set, or the status the row already has, changes nothing", () => {
  assert.equal(refused(planDrop({ zone: "band", id: id("Alpha"), to: "green" }, model, ctx)), "releaseBoard.drop.noStatus");
  assert.equal(refused(planDrop({ zone: "band", id: id("Alpha"), to: "amber" }, model, ctx)), "releaseBoard.drop.same");
});

test("a group listed by hand takes the row, the empty id takes it out, a found group is refused", () => {
  const group = model.items.find((i) => i.title === "Alpha")!.group!;
  const p = planDrop({ zone: "group", id: id("Gamma"), to: group.id }, model, ctx);
  assert.ok(p.ok && p.kind === "group" && p.name === "Launch <b>");
  const out = planDrop({ zone: "group", id: id("Alpha"), to: "" }, model, ctx);
  assert.ok(out.ok && out.kind === "group" && out.name === undefined);
  const auto = buildBoard({ ...cfg, groups: [] }, [row("PLAN_x_1.md", "amber"), row("PLAN_x_2.md", "amber"), row("c.md", "amber")], undefined, true, undefined);
  const found = auto.items.find((i) => i.group)?.group;
  if (found) {
    assert.equal(refused(planDrop({ zone: "group", id: 2, to: found.id }, auto, ctx)), "releaseBoard.drop.autoGroup");
  }
  assert.equal(refused(planDrop({ zone: "group", id: id("Gamma"), to: "no-such-group" }, model, ctx)), "releaseBoard.drop.gone");
});

test("dropping a row on another row's slot makes that row wait on it, with the line to write", () => {
  const p = planDrop({ zone: "waits", id: id("Gamma"), to: id("Alpha") }, model, ctx);
  assert.ok(p.ok && p.kind === "waits");
  assert.equal(p.ok && p.kind === "waits" ? p.target : "", "c.md");
  assert.equal(p.ok && p.kind === "waits" ? p.from.title : "", "Alpha");
});

test("a link that exists, a circle, itself and a document that reads no Needs lines are refused", () => {
  assert.equal(refused(planDrop({ zone: "waits", id: id("Alpha"), to: id("Beta") }, model, ctx)), "releaseBoard.drop.already");
  assert.equal(refused(planDrop({ zone: "waits", id: id("Beta"), to: id("Alpha") }, model, ctx)), "releaseBoard.needs.circle");
  assert.equal(refused(planDrop({ zone: "waits", id: id("Alpha"), to: id("Alpha") }, model, ctx)), "releaseBoard.drop.self");
  const sql = model.items.find((i) => i.path === "d.sql")!;
  assert.equal(refused(planDrop({ zone: "waits", id: id("Alpha"), to: sql.id }, model, ctx)), "releaseBoard.drop.noNeeds");
});

test("an id that is not on the board, a fractional or string id, or an unknown zone changes nothing", () => {
  const gone = "releaseBoard.drop.gone";
  assert.equal(refused(planDrop({ zone: "band", id: 99, to: "red" }, model, ctx)), gone);
  assert.equal(refused(planDrop({ zone: "band", id: 0.5, to: "red" }, model, ctx)), gone);
  assert.equal(refused(planDrop({ zone: "band", id: "0", to: "red" }, model, ctx)), gone);
  assert.equal(refused(planDrop({ zone: "band", id: -1, to: "red" }, model, ctx)), gone);
  assert.equal(refused(planDrop({ zone: "waits", id: id("Gamma"), to: 99 }, model, ctx)), gone);
  assert.equal(refused(planDrop({ zone: "nowhere", id: id("Gamma"), to: "red" }, model, ctx)), gone);
  assert.equal(refused(planDrop({ zone: "band", id: id("Gamma"), to: 5 }, model, ctx)), gone);
});

test("the page makes rows draggable, names zones by id and words, and escapes the group name", () => {
  const html = renderBoard(model, t, "n", 0, { groupBy: "group", statuses: [{ label: "bug <i>", status: "red", kind: "bug" }, { label: "Address now", status: "red" }, { label: "Done", status: "green" }] });
  assert.ok(html.includes(`draggable="true" data-drag="${id("Alpha")}"`), "Board tab rows");
  assert.ok(new RegExp(`<li class="gr[^"]*" tabindex="0" data-gid="${id("Alpha")}"[^>]* draggable="true" data-drag="${id("Alpha")}"`).test(html), "Gantt rows");
  assert.ok(html.includes(`data-drop="waits" data-to="${id("Alpha")}"`) && html.includes('aria-hidden="true">⛓'), "the slot is a drop zone, not a control");
  assert.ok(html.includes('data-drop="group" data-to=""'), "the no-group card");
  assert.ok(/data-drop="group" data-to="[^"]+" data-say="dropGroup"/.test(html));
  assert.equal(html.match(/data-drop="band"/g)?.length, 2, "one band per status, the plain label kept");
  assert.ok(html.includes("Address now") && !html.includes("bug <i>") && !html.includes("bug &#60;i&#62;</span>"));
  assert.ok(html.includes('data-menu="row"'), "an open Gantt row has the row menu for the keyboard");
});

test("the status bands exist only with statuses, and carry the announcement words", () => {
  assert.equal(statusBands(t), "");
  const html = statusBands(t, [{ label: "Done", status: "green" }]);
  assert.ok(html.includes('role="group" aria-label="dropLabel" data-start="dropStart"'));
  assert.ok(html.includes('data-say="dropBand"'));
});

test("finished Gantt history rows are neither dragged nor drop targets", () => {
  const withDone = buildBoard(cfg, [row("a.md", "amber"), row("b.md", "red"), row("done.md", "green")], undefined, true, { ...snapshot, projects: { app: { ...snapshot.projects.app, facts: { ...snapshot.projects.app.facts, "b.md": { size: 30, mtimeMs: 1, facts: readFacts("# Beta\n\nNeeds: done.md\n", "b.md") }, "done.md": { size: 8, mtimeMs: 1, facts: readFacts("# Done\n", "done.md") } } } } });
  const html = ganttPanel(withDone, t);
  const done = html.match(/<li class="gr done"[^>]*>/)?.[0] ?? "";
  assert.ok(done !== "" && !done.includes("draggable"));
});

test("the page script sends ids only, a refused drop moves nothing in the page", () => {
  assert.ok(DRAG_SCRIPT.includes("type:'drop'") && DRAG_SCRIPT.includes("rev:REV"));
  assert.ok(!/\.path|dataset\.path|\.href/.test(DRAG_SCRIPT), "no path is read from the page");
  assert.ok(!/appendChild|insertBefore/.test(DRAG_SCRIPT), "the page never reorders rows itself");
  assert.ok(DRAG_SCRIPT.includes("getElementById('live')"), "zones are announced in the polite live region");
});
