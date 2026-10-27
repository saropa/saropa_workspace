// Daily reports in the board: how a report moves the Build, Lint and Tests evidence, the light
// and the Path to GO. No report leaves everything as it was; stale or missing is never green.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildBoard } from "../../board/boardModel";
import { BoardStrings, renderBoard } from "../../board/boardHtml";
import { FeedReports, ProjectHealth, evaluateHealth } from "../../board/health";
import { PathOptions, pathToGo } from "../../board/pathToGo";
import { readFeedReport } from "../../board/recipeEvidence";
import { formatSummaryLine } from "../../board/reportSummary";
import { BoardConfig } from "../../board/types";
import { SidebarLabels, buildSidebarRows } from "../../board/sidebar";

const HOUR = 3600000;
const DAY = 24 * HOUR;
const NOW = 100 * DAY;
const LIMIT = 36 * HOUR;

function report(feed: "build" | "lint" | "tests", ageMs: number, result: "pass" | "fail" | "unknown", count = 0): FeedReports[typeof feed] {
  const recipe = feed === "build" ? "ritual.ci" : feed === "lint" ? "ritual.lint" : "ritual.tests";
  return readFeedReport(feed, { text: formatSummaryLine({ recipe, time: NOW - ageMs, result, count }), mtimeMs: NOW - ageMs }, NOW, LIMIT);
}

const passRun = { name: "t", outcome: "success" as const, exitCode: 0, endedAt: NOW - 2 * DAY, run: 5, failed: 0 };

test("no report: the result is exactly what it was, with no build fields", () => {
  const before = evaluateHealth(undefined, { tests: passRun }, undefined, NOW);
  assert.deepEqual(evaluateHealth(undefined, { tests: passRun }, undefined, NOW, {}), before);
  const none = readFeedReport("build", undefined, NOW, LIMIT);
  assert.deepEqual(evaluateHealth(undefined, { tests: passRun }, undefined, NOW, { build: none, lint: readFeedReport("lint", undefined, NOW, LIMIT), tests: readFeedReport("tests", undefined, NOW, LIMIT) }), before);
  assert.equal("build" in before, false);
});

test("a stale or unreadable report never makes a row green, and its detail says why", () => {
  const stale = evaluateHealth({ testsApply: false }, undefined, undefined, NOW, { lint: report("lint", 3 * DAY, "pass") });
  assert.equal(stale.lint, "missing");
  assert.equal(stale.lintDetail, "Report is 3 days old");
  assert.equal(stale.clean, false);
  const unknown = evaluateHealth({ lintApplies: false }, undefined, undefined, NOW, { tests: report("tests", HOUR, "unknown") });
  assert.equal(unknown.tests, "missing");
  assert.equal(unknown.testsDetail, "The report could not tell");
  assert.equal(unknown.clean, false);
});

test("fresh passing reports of both kinds make the evidence clean", () => {
  const h = evaluateHealth(undefined, undefined, undefined, NOW, { lint: report("lint", 6 * HOUR, "pass"), tests: report("tests", 6 * HOUR, "pass") });
  assert.equal(h.lint, "passing");
  assert.equal(h.tests, "passing");
  assert.equal(h.lintDetail, "Lint report: passing (6 h ago)");
  assert.equal(h.testsDetail, "Test report: passing (6 h ago)");
  assert.equal(h.clean, true);
});

test("a fresh passing report of one kind is not enough for GO", () => {
  const h = evaluateHealth(undefined, undefined, undefined, NOW, { tests: report("tests", HOUR, "pass") });
  assert.equal(h.tests, "passing");
  assert.equal(h.lint, "missing");
  assert.equal(h.clean, false);
});

test("a fresh failing report makes the row worse than a passing recorded run", () => {
  const h = evaluateHealth({ lintApplies: false }, { tests: { ...passRun, endedAt: NOW - 20 * HOUR } }, undefined, NOW, { tests: report("tests", 2 * HOUR, "fail", 4) });
  assert.equal(h.tests, "failing");
  assert.equal(h.testsDetail, "Test report: failing, 4 failed (2 h ago)");
  assert.equal(h.clean, false);
});

test("a newer passing run beats an older failing report; at the same time, failing wins", () => {
  const newer = evaluateHealth({ lintApplies: false }, { tests: { ...passRun, endedAt: NOW - HOUR } }, undefined, NOW, { tests: report("tests", 5 * HOUR, "fail", 1) });
  assert.equal(newer.tests, "passing");
  const tie = evaluateHealth({ lintApplies: false }, { tests: { ...passRun, endedAt: NOW - HOUR } }, undefined, NOW, { tests: report("tests", HOUR, "fail", 1) });
  assert.equal(tie.tests, "failing");
});

test("a recorded run that ran no tests does not hide a fresh passing report", () => {
  const h = evaluateHealth({ lintApplies: false }, { tests: { ...passRun, endedAt: NOW - HOUR, run: 0 } }, undefined, NOW, { tests: report("tests", 3 * HOUR, "pass") });
  assert.equal(h.tests, "passing");
});

test("the build: failing stops GO, missing and stale never do, passing adds nothing", () => {
  const good = { lint: report("lint", HOUR, "pass"), tests: report("tests", HOUR, "pass") };
  const failing = evaluateHealth(undefined, undefined, undefined, NOW, { ...good, build: report("build", HOUR, "fail", 2) });
  assert.equal(failing.build, "failing");
  assert.equal(failing.buildDetail, "Build report: failing, 2 failing (1 h ago)");
  assert.equal(failing.clean, false);
  const stale = evaluateHealth(undefined, undefined, undefined, NOW, { ...good, build: report("build", 4 * DAY, "pass") });
  assert.equal(stale.build, "missing");
  assert.equal(stale.buildDetail, "Report is 4 days old");
  assert.equal(stale.clean, true, "a missing build is never required");
  const passing = evaluateHealth(undefined, undefined, undefined, NOW, { ...good, build: report("build", HOUR, "pass") });
  assert.equal(passing.build, "passing");
  assert.equal(passing.clean, true);
});

const cfg: BoardConfig = { version: 1, ignore: [], ruleSets: {}, projects: [{ id: "app", name: "App", path: "app", roots: [], ruleSets: [] }] };
const opts: PathOptions = { maxSteps: 20, canRun: () => true };
const good = evaluateHealth(undefined, undefined, undefined, NOW, { lint: report("lint", HOUR, "pass"), tests: report("tests", HOUR, "pass") });

function lightOf(h: ProjectHealth): string {
  return buildBoard(cfg, [], undefined, true, undefined, undefined, { app: h }).projects[0].light;
}

test("the light: clean evidence is GO, a failing build is NO-GO, a missing build leaves GO alone", () => {
  assert.equal(lightOf(good), "go");
  assert.equal(lightOf({ ...good, build: "missing", buildDetail: "Report is 4 days old" }), "go");
  assert.equal(lightOf(evaluateHealth(undefined, undefined, undefined, NOW, { lint: report("lint", HOUR, "pass"), tests: report("tests", HOUR, "pass"), build: report("build", HOUR, "fail", 1) })), "no-go");
});

test("the sidebar names a failing build as the cause", () => {
  const failing = evaluateHealth(undefined, undefined, undefined, NOW, { build: report("build", HOUR, "fail", 1) });
  const model = buildBoard(cfg, [], undefined, true, undefined, undefined, { app: failing });
  const labels: SidebarLabels = {
    light: { "no-go": "NO-GO", unverified: "UNVERIFIED", go: "GO" },
    blockerOne: "1 blocker",
    blockerMany: "{count} blockers",
    reasons: { baseline: "scan not accepted", grey: "{count} unplaced", health: "no lint or test result", unread: "unread" },
    causeLint: "lint failing",
    causeBuild: "build failing",
    causeDeps: "dependencies vulnerable",
    causeTests: "tests failing",
    causeBlocked: "{count} in blocked folders",
    causeHeld: "held",
  };
  const rows = buildSidebarRows(model, { blockersPerProject: 3, expandProjects: "whenNoGo" }, labels);
  assert.equal(rows[0].light, "no-go");
  assert.ok(rows[0].tooltip.includes("build failing"), rows[0].tooltip.join(" | "));
});

test("Path to GO: a failing build is its own step, ahead of lint and tests", () => {
  const failing = evaluateHealth(undefined, undefined, undefined, NOW, { build: report("build", HOUR, "fail", 1) });
  const m = buildBoard(cfg, [], undefined, true, undefined, undefined, { app: failing });
  const steps = pathToGo(m, m.projects[0], opts).steps;
  assert.deepEqual(steps.map((s) => s.kind), ["build", "lint", "tests"]);
  assert.equal(steps[0].evidence, "failing");
  assert.equal(steps[0].detail, "Build report: failing, 1 failing (1 h ago)");
});

test("Path to GO: the daily report job note rides on a missing step, with the turn-on button for 'off'", () => {
  const h: ProjectHealth = { ...evaluateHealth({ lintApplies: false }, undefined, undefined, NOW), feeds: { tests: { state: "off" } } };
  const m = buildBoard(cfg, [], undefined, true, undefined, undefined, { app: h });
  const s = pathToGo(m, m.projects[0], opts).steps.find((x) => x.kind === "tests")!;
  assert.equal(s.evidence, "missing");
  assert.equal(s.feed, "off");
  assert.equal(s.enable, true);
  const checking: ProjectHealth = { ...h, feeds: { tests: { state: "checking" } } };
  const c = pathToGo(buildBoard(cfg, [], undefined, true, undefined, undefined, { app: checking }), buildBoard(cfg, [], undefined, true, undefined, undefined, { app: checking }).projects[0], opts).steps[0];
  assert.equal(c.feed, "checking");
  assert.equal(c.enable, undefined);
});

test("Path to GO: a failing result is never reworded by a job note", () => {
  const h: ProjectHealth = { ...evaluateHealth({ lintApplies: false }, undefined, undefined, NOW, { tests: report("tests", HOUR, "fail", 1) }), feeds: { tests: { state: "checking" } } };
  const m = buildBoard(cfg, [], undefined, true, undefined, undefined, { app: h });
  const s = pathToGo(m, m.projects[0], opts).steps[0];
  assert.equal(s.evidence, "failing");
  assert.equal(s.feed, undefined);
});

test("Path to GO: a build note appears only while the project is not GO, so GO keeps an empty path", () => {
  const goWithNote: ProjectHealth = { ...good, feeds: { build: { state: "off" } } };
  const goModel = buildBoard(cfg, [], undefined, true, undefined, undefined, { app: goWithNote });
  assert.equal(goModel.projects[0].light, "go");
  assert.deepEqual(pathToGo(goModel, goModel.projects[0], opts).steps, []);
  const notGo: ProjectHealth = { ...evaluateHealth(undefined, undefined, undefined, NOW), feeds: { build: { state: "off" } } };
  const m = buildBoard(cfg, [], undefined, true, undefined, undefined, { app: notGo });
  const build = pathToGo(m, m.projects[0], opts).steps.find((x) => x.kind === "build")!;
  assert.equal(build.feed, "off");
  assert.equal(build.enable, true);
});

const t: BoardStrings = new Proxy({} as BoardStrings, {
  get: (_o, k: string) => {
    const table: Record<string, string> = {
      ptgFeedOff: "Turn on the daily {what} report",
      ptgFeedChecking: "Checking the {what} now.",
      ptgFeedWaiting: "The {what} check is waiting for a quiet moment.",
      ptgFeedFailed: "The daily {what} check could not start: {reason}",
      feedWhatBuild: "build",
      feedWhatLint: "lint",
      feedWhatTests: "test",
      ptgEnable: "Turn on",
      healthBuild: "Build",
      ptgBuildFailing: "Build failing.",
    };
    return table[k] ?? `[${k}] {title} {count}`;
  },
});

function html(h: ProjectHealth): string {
  const m = buildBoard(cfg, [], undefined, true, undefined, undefined, { app: h });
  return renderBoard(m, t, "N", 1, {}, m.projects.map((p) => pathToGo(m, p, opts)));
}

test("html: the off note reads 'Turn on the daily test report' with Turn on and the earlier run button, no path in the page", () => {
  const out = html({ ...evaluateHealth({ lintApplies: false }, undefined, undefined, NOW), feeds: { tests: { state: "off" } } });
  assert.ok(out.includes("Turn on the daily test report"));
  const buttons = out.match(/<button class="ptgb"[^>]*>[^<]*<\/button>/g) ?? [];
  assert.equal(buttons.length, 2);
  assert.equal(buttons[0], '<button class="ptgb" data-p="0" data-s="0" data-run="1" title="ptgEnable">Turn on</button>');
  assert.equal(buttons[1], '<button class="ptgb" data-p="0" data-s="0" data-run="1" title="ptgRunTests">[ptgRunTests] {title} {count}</button>');
  assert.ok(!out.includes("reports/"));
});

test("html: while a job checks or waits there is no run button", () => {
  const out = html({ ...evaluateHealth({ lintApplies: false }, undefined, undefined, NOW), feeds: { tests: { state: "checking" } } });
  assert.equal((out.match(/<button class="ptgb"/g) ?? []).length, 0);
});

test("html: a running job shows 'Checking the build now.' on the row and in the list", () => {
  const out = html({ ...evaluateHealth(undefined, undefined, undefined, NOW), feeds: { build: { state: "checking" } } });
  assert.ok(out.includes('<span class="fn" title="feedLine">Checking the build now.</span>'));
  assert.ok(out.includes('<span class="st">Checking the build now.</span>'));
});

test("html: a failed start shows its reason, escaped", () => {
  const out = html({ ...evaluateHealth({ lintApplies: false }, undefined, undefined, NOW), feeds: { tests: { state: "failed", reason: "<b>boom</b>" } } });
  assert.ok(out.includes("The daily test check could not start: &#60;b&#62;boom&#60;/b&#62;"));
  assert.ok(!out.includes("<b>boom"));
});

test("html: the row says nothing about a job once the evidence is a result", () => {
  const out = html({ ...evaluateHealth({ lintApplies: false }, undefined, undefined, NOW, { tests: report("tests", HOUR, "pass") }), feeds: { tests: { state: "checking" } } });
  assert.ok(!out.includes('class="fn"'));
});

test("html: the build mark shows only when a build report was read", () => {
  const without = html(evaluateHealth(undefined, undefined, undefined, NOW));
  assert.ok(!without.includes("Build: "));
  const withBuild = html(evaluateHealth(undefined, undefined, undefined, NOW, { build: report("build", HOUR, "fail", 1) }));
  assert.ok(withBuild.includes('title="g.redDot: Build: Build report: failing, 1 failing (1 h ago)"'));
});
