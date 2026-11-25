// The first cause shown beside a NO-GO or UNVERIFIED light, so a red or amber project with
// nothing open still says why. Pure: built from hand-made project literals.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { BoardProject } from "../../board/boardModelParts";
import { lightCause, stepKeyFor } from "../../board/lightCause";
import { buildBoard } from "../../board/boardModel";
import { GANTT_STYLE, ganttPanel } from "../../board/boardHtmlGantt";
import { verdict } from "../../board/boardHtmlRows";
import type { ProjectHealth } from "../../board/health";
import type { BoardConfig, BoardStatus, Classified } from "../../board/types";
import { emptyCounts } from "../../board/types";
import { causeHtml } from "../../board/boardHtmlCause";
import type { BoardStrings } from "../../board/boardHtmlUtil";

// Only the fields lightCause reads are set; the cast keeps the fixture short.
const proj = (over: Partial<BoardProject>): BoardProject =>
  ({ id: "p", name: "P", light: "no-go", reasons: [], items: [], blocked: 0, blockedStopping: 0, counts: emptyCounts(), dependsOn: [], ...over }) as BoardProject;

test("returns nothing for a GO project", () => {
  assert.equal(lightCause(proj({ light: "go" })), undefined);
});

test("names a failing build before lint, with its detail", () => {
  const c = lightCause(proj({ health: { build: "failing", buildDetail: "exit 1", lint: "failing" } as BoardProject["health"] }));
  assert.deepEqual(c, { kind: "build", detail: "exit 1" });
});

test("names failing lint when nothing is open", () => {
  assert.equal(lightCause(proj({ health: { lint: "failing", lintDetail: "3 errors" } as BoardProject["health"] }))?.kind, "lint");
});

test("names waiting documents that stop the release", () => {
  assert.deepEqual(lightCause(proj({ blockedStopping: 2 })), { kind: "blocked", count: 2 });
});

test("names red documents when none is listed as stopping", () => {
  assert.deepEqual(lightCause(proj({ counts: { ...emptyCounts(), red: 4 } })), { kind: "red", count: 4 });
});

test("names the held scan for a NO-GO carried over from the accepted scan", () => {
  // The cause reads the heldScanRed fact that buildProject sets (accepted scan had red work, current scan held);
  // a bare "baseline" reason is the UNVERIFIED case and names no NO-GO cause.
  assert.equal(lightCause(proj({ heldScanRed: true }))?.kind, "baselineRed");
});

test("UNVERIFIED names the unaccepted scan first", () => {
  assert.equal(lightCause(proj({ light: "unverified", reasons: ["unread", "baseline"] }))?.kind, "baseline");
});

test("UNVERIFIED counts documents with an unreadable severity", () => {
  const items = [{ severity: undefined }, { severity: "low" }, { severity: undefined }] as BoardProject["items"];
  assert.deepEqual(lightCause(proj({ light: "unverified", reasons: ["unread"], items })), { kind: "unread", count: 2 });
});

test("an answered project names only its pinned blocking items, not waiting or red documents", () => {
  const items = [{ blocks: true }] as BoardProject["items"];
  const c = lightCause(proj({ answered: true, blockedStopping: 2, counts: { ...emptyCounts(), red: 4 }, items }));
  assert.deepEqual(c, { kind: "items", count: 1 });
});

test("an answered project with no pinned blocker has no NO-GO cause to name from counts", () => {
  assert.equal(lightCause(proj({ answered: true, blockedStopping: 2, counts: { ...emptyCounts(), red: 4 } })), undefined);
});

test("a count of 1 uses the singular string, other counts the plural", () => {
  const t = { polish: { "cause.red": "{count} red documents", "cause.red.one": "1 red document" } } as unknown as BoardStrings;
  // The label goes through pillify, so the number sits in its own pill element and the noun follows it.
  assert.ok(causeHtml({ kind: "red", count: 1 }, t).includes("1</span> red document<"));
  assert.ok(causeHtml({ kind: "red", count: 4 }, t).includes("4</span> red documents<"));
});

test("a linked cause is a keyboard-reachable button carrying its project and step key, escaped", () => {
  const t = { polish: { "cause.lint": "Lint failing", causeGoTip: "{cause}. Click" } } as unknown as BoardStrings;
  const html = causeHtml({ kind: "lint" }, t, 'a"b<');
  assert.ok(html.startsWith('<button type="button" class="cause"') && html.includes("data-cause"));
  assert.ok(html.includes('data-pid="a&#34;b&#60;"')&& html.includes('data-k="lint"'));
  assert.ok(!html.includes('a"b<'), "the project id is never written raw");
  assert.ok(html.includes('title="Lint failing. Click"'));
});

test("without a project id the cause stays a plain span, for a row that is itself a button", () => {
  const t = { polish: { "cause.lint": "Lint failing" } } as unknown as BoardStrings;
  const html = causeHtml({ kind: "lint" }, t);
  assert.ok(html.startsWith('<span class="cause"') && !html.includes("<button"));
});

test("each cause kind maps to the Path to GO step that explains it", () => {
  assert.equal(stepKeyFor("build"), "build");
  assert.equal(stepKeyFor("blocked"), "blocked");
  assert.equal(stepKeyFor("unread"), "unread");
  assert.equal(stepKeyFor("items"), "item:");
  assert.equal(stepKeyFor("red"), "item:");
  assert.equal(stepKeyFor("baseline"), "accept");
  assert.equal(stepKeyFor("baselineRed"), "accept");
});

test("the phrase escapes the detail and marks UNVERIFIED causes amber", () => {
  const t = { polish: { "cause.lint": "Lint failing", "cause.baseline": "Accept the scan", causeTip: "{cause}: {detail}" } } as unknown as BoardStrings;
  const red = causeHtml({ kind: "lint", detail: "<b>x</b>" }, t);
  assert.ok(red.includes('class="cause"') && !red.includes("<b>x</b>"));
  assert.ok(causeHtml({ kind: "baseline" }, t).includes('class="cause warn"'));
  assert.equal(causeHtml(undefined, t), "");
});

// The light and its cause go through one blocker test, so for every project a built board produces,
// NO-GO and a NO-GO cause appear together, and UNVERIFIED and GO never carry a NO-GO cause.
const cfg: BoardConfig = { version: 1, ignore: [], ruleSets: {}, projects: [{ id: "app", name: "App", path: "app", roots: [], ruleSets: [] }] };
const row = (path: string, status: BoardStatus, note = ""): Classified => ({ project: "app", path, status, kind: "", note });
const failing = (over: Partial<ProjectHealth>): Record<string, ProjectHealth> => ({ app: { lint: "passing", tests: "passing", clean: false, ...over } as ProjectHealth });

const CASES: { name: string; rows: Classified[]; accepted: boolean; health?: Record<string, ProjectHealth>; light: string; kind?: string }[] = [
  { name: "red folder", rows: [row("bugs/a.md", "red")], accepted: true, light: "no-go", kind: "items" },
  { name: "failing lint with nothing open", rows: [], accepted: true, health: failing({ lint: "failing" }), light: "no-go", kind: "lint" },
  { name: "failing build", rows: [], accepted: true, health: failing({ build: "failing" }), light: "no-go", kind: "build" },
  { name: "unread open document", rows: [row("docs/a.md", "amber")], accepted: true, light: "unverified", kind: "unread" },
  { name: "unaccepted scan", rows: [], accepted: false, light: "unverified", kind: "baseline" },
  { name: "nothing wrong", rows: [], accepted: true, health: failing({}), light: "go" },
];

for (const c of CASES) {
  test(`the light and the cause agree: ${c.name}`, () => {
    const p = buildBoard(cfg, c.rows, undefined, c.accepted, undefined, undefined, c.health).projects[0];
    assert.equal(p.light, c.light);
    assert.equal(lightCause(p)?.kind, c.kind);
  });
}

test("the light and the cause agree: a held scan that had red work", () => {
  const prev = { version: 1, takenAt: 1, projects: { app: { counts: { ...emptyCounts(), red: 2 }, folders: {}, ruleCounts: {}, greyFolders: {}, files: {}, facts: {} } } };
  const p = buildBoard(cfg, [], undefined, false, undefined, prev as never, failing({})).projects[0];
  assert.equal(p.light, "no-go");
  assert.equal(lightCause(p)?.kind, "baselineRed");
});

test("the light and the cause agree: an answered project is NO-GO only for a pinned blocker", () => {
  const p = buildBoard(cfg, [row("bugs/a.md", "red")], undefined, true, undefined, undefined, failing({}), { answered: ["app"] } as never).projects[0];
  // The owner answered and pinned nothing, so the red document does not block: not NO-GO, and no blocker is named.
  assert.notEqual(p.light, "no-go");
  assert.notEqual(lightCause(p)?.kind, "items");
  const pinned = buildBoard(cfg, [row("bugs/a.md", "red")], undefined, true, undefined, undefined, failing({}), { answered: ["app"], pins: ["app/bugs/a.md"] } as never).projects[0];
  assert.equal(pinned.light, "no-go");
  assert.deepEqual(lightCause(pinned), { kind: "items", count: 1 });
});

test("the Gantt header keeps the cause outside the toggle button and may cut a long one with an ellipsis", () => {
  const t = new Proxy({} as BoardStrings, { get: (_o, k: string) => `[${k}]` });
  const m = buildBoard(cfg, [], undefined, true, undefined, undefined, failing({ lint: "failing" }));
  const html = ganttPanel(m, t);
  const toggle = /<button type="button" class="gtog"[\s\S]*?<\/button>/.exec(html)?.[0] ?? "";
  assert.ok(toggle && !toggle.includes("cause"), "a button inside the toggle button would be invalid and unreachable");
  assert.ok(html.includes('class="cause"') && html.includes('data-pid="app"') && html.includes("title="), "the full text stays in the title");
  assert.ok(/\.gh \.cause\{[^}]*text-overflow:ellipsis/.test(GANTT_STYLE));
});

test("a toggling project row keeps the cause a span; a plain row makes it a button", () => {
  const t = new Proxy({} as BoardStrings, { get: (_o, k: string) => `[${k}]` });
  const m = buildBoard(cfg, [], undefined, true, undefined, undefined, failing({ lint: "failing" }));
  const lights = new Map([["app", "no-go"]]);
  assert.ok(verdict(m.projects[0], t, lights, true).includes('<span class="cause"'));
  assert.ok(verdict(m.projects[0], t, lights, false).includes('<button type="button" class="cause"'));
});
