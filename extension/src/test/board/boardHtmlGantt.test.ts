// The Gantt tab: groups, work-order bars, finished rows as history, the light, the since-you-left
// border, escaping and the key pill.

import { test } from "node:test";
import assert from "node:assert/strict";
import { BoardStrings } from "../../board/boardHtmlUtil";
import { GANTT_SCRIPT, ganttPanel, ganttRows } from "../../board/boardHtmlGantt";
import { MAX_FINISHED, buildGantt, finishedTargets } from "../../board/ganttModel";
import { STYLE, script } from "../../board/boardHtmlAssets";
import { Link } from "../../board/links";
import { buildBoard } from "../../board/boardModel";
import { readFacts } from "../../board/docFacts";
import { ScanSnapshot } from "../../board/scanner";
import { SinceView } from "../../board/sinceLast";
import { BoardConfig, BoardStatus, Classified, asGanttLayout, emptyCounts } from "../../board/types";

const t: BoardStrings = new Proxy({} as BoardStrings, { get: (_o, k: string) => `[${k}]` });

const cfg: BoardConfig = { version: 1, ignore: [], ruleSets: {}, projects: [{ id: "app", name: "App <b>", path: "app", roots: [], ruleSets: [] }] };
const row = (path: string, status: BoardStatus): Classified => ({ project: "app", path, status, kind: "", note: "" });

function snapshotOf(files: Record<string, string>): ScanSnapshot {
  const facts = Object.fromEntries(Object.entries(files).map(([p, text]) => [p, { size: text.length, mtimeMs: 1, facts: readFacts(text, p) }]));
  return { version: 1, takenAt: 1, projects: { app: { counts: emptyCounts(), folders: {}, ruleCounts: {}, greyFolders: {}, files: {}, facts } } };
}

const files = { "a.md": "# Alpha\n", "b.md": "# Beta\n\nNeeds: a.md\n", "c.md": "# Gamma\n\nNeeds: done.md\n", "done.md": "# Finished <i>\n" };
const rows = [row("a.md", "amber"), row("b.md", "red"), row("c.md", "purple"), row("done.md", "green")];
const model = buildBoard(cfg, rows, undefined, true, snapshotOf(files));

test("an item that waits starts after what it waits on, and its row names the dependency", () => {
  const [g] = buildGantt(model);
  const a = g.rows.find((r) => r.title === "Alpha")!;
  const b = g.rows.find((r) => r.title === "Beta")!;
  assert.equal(a.start, 0);
  assert.ok(b.start >= a.start + a.width - 0.1);
  assert.deepEqual(b.after, [a.id]);
  assert.deepEqual(b.waits, ["Alpha"]);
});

test("a finished document an open item needed stays as a dimmed history row", () => {
  const [g] = buildGantt(model);
  const done = g.rows.find((r) => r.status === "green")!;
  assert.equal(done.title, "Finished <i>");
  assert.equal(done.id, undefined);
  assert.equal(g.rows[0], done, "history comes first");
  assert.equal(g.open, 3);
  assert.ok(ganttPanel(model, t).includes('class="gr done"'));
});

test("the panel escapes titles and names, closes each group with its light and carries the key pill", () => {
  const html = ganttPanel(model, t);
  assert.ok(!html.includes("<i>") && !html.includes("<b>"));
  assert.ok(html.includes("Finished &#60;i&#62;") && html.includes("App &#60;b&#62;"));
  assert.ok(html.includes('class="go gtl no-go"'));
  assert.ok(html.includes('aria-label="ganttKeyLabel" title="ganttKey">?</button>'));
  assert.ok(html.includes('id="gKey" hidden') && html.includes('aria-controls="gKey"'), "the key is a hidden panel the button toggles");
  assert.ok(html.includes('role="tabpanel" aria-labelledby="tb-gantt"'));
  assert.ok(html.includes('tabindex="0" data-gid='), "rows are reachable by keyboard");
});

test("a row changed since the last look gets the static marker class", () => {
  const since = { marked: ["app/b.md"] } as SinceView;
  assert.equal(ganttPanel(model, t, since).match(/class="gr[^"]* chg"/g)?.length, 1);
  assert.ok(!ganttPanel(model, t).includes(" chg"));
});

test("no items shows the empty line, and the script draws arrows only for the hovered or selected row", () => {
  const empty = buildBoard(cfg, [], undefined, true);
  assert.ok(ganttPanel(empty, t).includes("ganttEmpty"));
  assert.ok(GANTT_SCRIPT.includes("[hov,sel]"));
  assert.ok(!GANTT_SCRIPT.includes("postMessage"), "the view is read-only");
});

function chainModel(specs: Array<[string, string]>) {
  const fs = Object.fromEntries(specs.map(([p, needs]) => [p, `# T ${p}\n\n${needs ? `Needs: ${needs}\n` : ""}`]));
  return buildBoard(cfg, specs.map(([p]) => row(p, "amber")), undefined, true, snapshotOf(fs));
}

test("a chain of 50 never starts a bar before its predecessor ends, and nothing overflows the axis", () => {
  const specs: Array<[string, string]> = Array.from({ length: 50 }, (_v, i) => [`n${i}.md`, i === 0 ? "" : `n${i - 1}.md`]);
  const [g] = buildGantt(chainModel(specs));
  assert.equal(g.rows.length, 50);
  const byTitle = new Map(g.rows.map((r) => [r.title, r]));
  for (let i = 1; i < 50; i++) {
    const prev = byTitle.get(`T n${i - 1}.md`)!;
    const cur = byTitle.get(`T n${i}.md`)!;
    assert.ok(cur.start >= prev.start + prev.width - 0.001, `n${i} starts after n${i - 1} ends`);
    assert.ok(cur.start + cur.width <= 100.001);
  }
});

test("a loop of Needs lines does not hang and still places both items", () => {
  const [g] = buildGantt(chainModel([["a.md", "b.md"], ["b.md", "a.md"]]));
  assert.equal(g.rows.length, 2);
  assert.ok(g.rows.every((r) => Number.isFinite(r.start) && r.width > 0));
});

test("a waited-on item that is not on the board leaves no names clause", () => {
  const [g] = buildGantt(chainModel([["a.md", "gone.md"]]));
  assert.deepEqual(g.rows[0].waits, []);
});

test("finished history is capped per project and leaves out reference documents", () => {
  const link = (project: string, i: number): Link => ({ fromProject: "x", fromPath: "x.md", target: "t", state: "done", toProject: project, toPath: `d${i}.md` });
  const links = [...Array.from({ length: MAX_FINISHED + 5 }, (_v, i) => link("p1", i)), ...Array.from({ length: 3 }, (_v, i) => link("p2", i))];
  const out = finishedTargets(links, (_p, path) => path, (p, path) => p === "p1" && path === "d0.md");
  assert.equal(out.filter((f) => f.project === "p1").length, MAX_FINISHED);
  assert.equal(out.filter((f) => f.project === "p2").length, 3);
  assert.ok(!out.some((f) => f.path === "d0.md" && f.project === "p1"));
});

test("the loading shimmer skips the Gantt lights, and each row has one tab stop", () => {
  assert.ok(STYLE.includes(".loading .go:not(.gtl)"));
  const html = ganttPanel(model, t);
  assert.ok(html.includes('tabindex="-1"'));
  assert.ok(GANTT_SCRIPT.includes("gcol"), "folds are remembered");
});

// Two projects: "app" and "lib". lib's x.md waits on app's a.md, across projects.
const cfg2: BoardConfig = { ...cfg, projects: [...cfg.projects, { id: "lib", name: "Lib", path: "lib", roots: [], ruleSets: [] }] };
const rows2: Classified[] = [...rows, { project: "lib", path: "x.md", status: "amber", kind: "", note: "" }, { project: "lib", path: "y.md", status: "red", kind: "", note: "" }];

function twoProjects() {
  const snap = snapshotOf({ ...files, "x.md": "# X\n\nNeeds: app:a.md\n", "y.md": "# Y\n" });
  snap.projects.lib = { ...snap.projects.app, facts: Object.fromEntries(["x.md", "y.md"].map((p) => [p, snap.projects.app.facts[p]])) };
  return buildBoard(cfg2, rows2, undefined, true, snap);
}

test("unified puts every project's rows in one group, finished first, in work order, with the worst light", () => {
  const m = twoProjects();
  const split = buildGantt(m);
  assert.equal(split.length, 2);
  const [u, ...rest] = buildGantt(m, undefined, "unified", "All projects");
  assert.equal(rest.length, 0);
  assert.equal(u.id, "all");
  assert.equal(u.name, "All projects");
  assert.equal(u.rows.length, split[0].rows.length + split[1].rows.length);
  assert.equal(u.open, split[0].open + split[1].open);
  const firstOpen = u.rows.findIndex((r) => r.id !== undefined);
  assert.ok(u.rows.slice(0, firstOpen).every((r) => r.status === "green") && u.rows.slice(firstOpen).every((r) => r.id !== undefined));
  const starts = u.rows.slice(firstOpen).map((r) => r.start);
  assert.deepEqual(starts, [...starts].sort((a, b) => a - b));
  assert.ok(u.rows.every((r) => r.project === "App <b>" || r.project === "Lib"));
  const worst = split.some((g) => g.light === "no-go") ? "no-go" : split.some((g) => g.light === "unverified") ? "unverified" : "go";
  assert.equal(u.light, worst);
  assert.ok(split.every((g) => g.rows.every((r) => r.project === undefined)), "split rows carry no project name");
});

test("one project is never unified, so the toggle stays hidden", () => {
  assert.equal(buildGantt(model, undefined, "unified")[0].id, "app");
  assert.ok(!ganttPanel(model, t, undefined, "unified").includes("data-glayout"));
});

test("the toggle shows with two projects in either layout, marks the current one and escapes project names", () => {
  const m = twoProjects();
  for (const layout of ["split", "unified"] as const) {
    const html = ganttPanel(m, t, undefined, layout);
    assert.equal(html.match(/data-glayout="/g)?.length, 2);
    assert.ok(html.includes(`data-glayout="${layout}" aria-pressed="true"`));
    assert.ok(html.includes('aria-pressed="false"') && html.includes('title="ganttSplitTip"'));
  }
  const u = ganttPanel(m, t, undefined, "unified");
  assert.equal(u.match(/<section class="gg"/g)?.length, 1);
  assert.ok(u.includes('class="gpn"') && u.includes("App &#60;b&#62;") && !u.includes("<b>"));
});

test("Show more works with the unified group id, and a layout message value is checked against the fixed list", () => {
  const m = twoProjects();
  assert.equal(ganttRows(m, t, undefined, "all", 1, "unified")?.count, buildGantt(m, undefined, "unified")[0].rows.length - 1);
  assert.equal(ganttRows(m, t, undefined, "all", 1, "split"), undefined);
  assert.equal(asGanttLayout("unified"), "unified");
  assert.equal(asGanttLayout("split"), "split");
  for (const bad of ["", "Unified", "all", 1, null, undefined, {}]) {
    assert.equal(asGanttLayout(bad), undefined);
  }
  const page = script(1, "x", "deliberate");
  assert.ok(page.includes("type:'ganttLayout'") && page.includes("rev:REV"));
});
