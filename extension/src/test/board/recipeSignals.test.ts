// The other daily reports in the board: dependencies (can worsen), and the notes, Tidy
// candidates and since-you-looked lines (information only). Stale, missing, unknown or
// contradictory reports never turn anything green and never change a light.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildBoard } from "../../board/boardModel";
import { BoardStrings, renderBoard } from "../../board/boardHtml";
import { FeedReports, ProjectHealth, evaluateHealth } from "../../board/health";
import { PathOptions, pathToGo } from "../../board/pathToGo";
import { EvidenceFeed, readFeedReport } from "../../board/recipeEvidence";
import { feedInfo, formatSummaryLine } from "../../board/reportSummary";
import { isSinceReport, isTidyReport, kindsAt, showsOnRow, signalsOf, trendOf } from "../../board/reportSignals";
import { BoardConfig } from "../../board/types";

const HOUR = 3600000;
const DAY = 24 * HOUR;
const NOW = 100 * DAY;
const LIMIT = 36 * HOUR;

function read(feed: EvidenceFeed, ageMs: number, result: "pass" | "fail" | "unknown", count?: number, recipe = feedInfo(feed).recipeId) {
  return readFeedReport(feed, { text: formatSummaryLine({ recipe, time: NOW - ageMs, result, count }), mtimeMs: NOW - ageMs }, NOW, LIMIT);
}

test("detail lines of the new feeds, exact", () => {
  const detail = (feed: EvidenceFeed, result: "pass" | "fail", count?: number): string | undefined => {
    const r = read(feed, 3 * HOUR, result, count);
    return r.ok ? r.detail : undefined;
  };
  assert.equal(detail("deps", "pass", 4), "Dependency report: 4 behind (3 h ago)");
  assert.equal(detail("deps", "pass", 0), "Dependency report: all up to date (3 h ago)");
  assert.equal(detail("deps", "fail", 2), "Dependency report: 2 vulnerable or discontinued (3 h ago)");
  assert.equal(detail("prs", "pass", 3), "Review queue report: 3 waiting for review (3 h ago)");
  assert.equal(detail("prs", "pass", 0), "Review queue report: nothing waiting (3 h ago)");
  assert.equal(detail("uncommitted", "fail", 5), "Uncommitted-work report: 5 files not committed (3 h ago)");
  assert.equal(detail("uncommitted", "pass", 0), "Uncommitted-work report: nothing uncommitted (3 h ago)");
  assert.equal(detail("debt", "pass", 37), "Tech-debt report: 37 markers (3 h ago)");
  assert.equal(detail("branches", "pass", 2), "Branch report: 2 merged branches (3 h ago)");
  assert.equal(detail("bloat", "fail", 1), "Bloat report: 1 oversized or unguarded folders (3 h ago)");
  assert.equal(detail("standup", "pass", 7), "Standup report: 7 commits (3 h ago)");
  assert.equal(detail("readiness", "pass", 0), "Release readiness report: tests and lint passing (3 h ago)");
  assert.equal(detail("readiness", "fail", 2), "Release readiness report: 2 checks failing (3 h ago)");
  assert.equal(detail("changelog", "fail", 1), "Changelog check: 1 mismatch (3 h ago)");
  assert.equal(detail("version", "pass", 0), "Version check: all files agree (3 h ago)");
  assert.equal(detail("staleBranches", "fail", 4), "Branch age report: 4 old branches (3 h ago)");
  assert.equal(detail("bigFiles", "fail", 2), "New-file size report: 2 large files (3 h ago)");
  assert.equal(detail("links", "fail", 9), "Link report: 9 broken links (3 h ago)");
});

test("a report that contradicts itself is unreadable, never a pass", () => {
  for (const feed of ["uncommitted", "bloat", "readiness", "changelog", "version", "staleBranches", "bigFiles", "links"] as const) {
    const r = read(feed, HOUR, "pass", 3);
    assert.equal(r.ok, false, `${feed} pass with a count`);
    assert.equal(!r.ok && r.why, "unreadable", feed);
  }
  for (const feed of ["uncommitted", "bloat", "readiness", "staleBranches", "bigFiles", "links"] as const) {
    assert.equal(read(feed, HOUR, "fail", 0).ok, false, `${feed} fail with no count`);
    assert.equal(read(feed, HOUR, "fail").ok, false, `${feed} fail with no count at all`);
  }
  assert.equal(read("deps", HOUR, "pass", 6).ok, true, "a dependency report may count the packages behind");
  assert.equal(read("prs", HOUR, "pass", 6).ok, true);
});

test("another recipe's summary line, a stale report and an unknown verdict are grey with their reason", () => {
  assert.equal(!read("prs", HOUR, "pass", 1, "ritual.debt").ok && (read("prs", HOUR, "pass", 1, "ritual.debt") as { why: string }).why, "unreadable");
  const stale = read("links", 3 * DAY, "fail", 4);
  assert.deepEqual(stale, { ok: false, feed: "links", why: "stale", detail: "Report is 3 days old", ageMs: 3 * DAY });
  const unknown = read("uncommitted", HOUR, "unknown");
  assert.equal(!unknown.ok && unknown.why, "unknown");
});

test("signals come only from fresh, readable reports of the signal feeds", () => {
  const reads: FeedReports = {
    prs: read("prs", HOUR, "pass", 2),
    uncommitted: read("uncommitted", 50 * HOUR, "fail", 3),
    links: read("links", HOUR, "unknown"),
    changelog: read("changelog", HOUR, "pass", 3),
    debt: { ...(read("debt", HOUR, "pass", 12) as Extract<ReturnType<typeof read>, { ok: true }>), previousCount: 8 },
    deps: read("deps", HOUR, "pass", 1),
    tests: read("tests", HOUR, "pass", 0),
  };
  const s = signalsOf(reads);
  assert.deepEqual(s.map((x) => x.kind), ["prs", "debt"]);
  assert.deepEqual(s[0], { kind: "prs", result: "pass", count: 2, at: NOW - HOUR, previousCount: undefined, detail: "Review queue report: 2 waiting for review (1 h ago)" });
  assert.equal(s[1].previousCount, 8);
  assert.deepEqual(signalsOf(undefined), []);
});

test("which signals show where", () => {
  const sig = (kind: Parameters<typeof showsOnRow>[0]["kind"], result: "pass" | "fail", count?: number) => ({ kind, result, count, at: 1, detail: "" });
  assert.equal(showsOnRow(sig("prs", "pass", 0)), false);
  assert.equal(showsOnRow(sig("prs", "pass", 2)), true);
  assert.equal(showsOnRow(sig("uncommitted", "pass", 0)), false);
  assert.equal(showsOnRow(sig("uncommitted", "fail", 2)), true);
  assert.equal(showsOnRow(sig("readiness", "pass", 0)), true);
  assert.equal(showsOnRow(sig("debt", "pass", 5)), false, "tidy feeds are not row notes");
  assert.equal(isTidyReport(sig("debt", "pass", 5)), true);
  assert.equal(isTidyReport(sig("debt", "pass", 0)), false);
  assert.equal(isTidyReport(sig("bloat", "pass", 0)), false);
  assert.equal(isTidyReport(sig("bloat", "fail", 2)), true);
  assert.equal(isSinceReport(sig("standup", "pass", 0)), false);
  assert.equal(isSinceReport(sig("delta", "pass", 4)), true);
  assert.deepEqual(kindsAt("since"), ["standup", "delta"]);
  assert.deepEqual(kindsAt("tidy"), ["debt", "branches", "bloat", "bigFiles"]);
});

test("trend: up, down, same, and nothing without an earlier report", () => {
  assert.equal(trendOf(12, 8), "up");
  assert.equal(trendOf(3, 8), "down");
  assert.equal(trendOf(8, 8), "same");
  assert.equal(trendOf(8, undefined), undefined);
  assert.equal(trendOf(undefined, 8), undefined);
});

// ---- health and the light ----

const good = { lint: read("lint", HOUR, "pass", 0), tests: read("tests", HOUR, "pass", 0) };

test("no extra report: the result is exactly what it was, with no dependency or signal fields", () => {
  const before = evaluateHealth(undefined, undefined, undefined, NOW, good);
  const none = { ...good, deps: readFeedReport("deps", undefined, NOW, LIMIT) };
  assert.deepEqual(evaluateHealth(undefined, undefined, undefined, NOW, none), before);
  assert.equal("deps" in before, false);
  assert.equal("signals" in before, false);
});

test("dependencies: fresh failing stops GO; stale, unknown or missing never do; passing adds nothing", () => {
  const failing = evaluateHealth(undefined, undefined, undefined, NOW, { ...good, deps: read("deps", HOUR, "fail", 2) });
  assert.equal(failing.deps, "failing");
  assert.equal(failing.depsDetail, "Dependency report: 2 vulnerable or discontinued (1 h ago)");
  assert.equal(failing.clean, false);
  const stale = evaluateHealth(undefined, undefined, undefined, NOW, { ...good, deps: read("deps", 4 * DAY, "fail", 2) });
  assert.equal(stale.deps, "missing");
  assert.equal(stale.depsDetail, "Report is 4 days old");
  assert.equal(stale.clean, true);
  const unknown = evaluateHealth(undefined, undefined, undefined, NOW, { ...good, deps: read("deps", HOUR, "unknown") });
  assert.equal(unknown.deps, "missing");
  assert.equal(unknown.clean, true);
  const passing = evaluateHealth(undefined, undefined, undefined, NOW, { deps: read("deps", HOUR, "pass", 3) });
  assert.equal(passing.deps, "passing");
  assert.equal(passing.clean, false, "a passing dependency report alone is not lint and test evidence");
});

const cfg: BoardConfig = { version: 1, ignore: [], ruleSets: {}, projects: [{ id: "app", name: "App", path: "app", roots: [], ruleSets: [] }] };
const opts: PathOptions = { maxSteps: 20, canRun: () => true };

test("the light: failing dependencies make NO-GO; every note leaves GO exactly as it was", () => {
  const lightOf = (h: ProjectHealth): string => buildBoard(cfg, [], undefined, true, undefined, undefined, { app: h }).projects[0].light;
  assert.equal(lightOf(evaluateHealth(undefined, undefined, undefined, NOW, good)), "go");
  assert.equal(lightOf(evaluateHealth(undefined, undefined, undefined, NOW, { ...good, deps: read("deps", HOUR, "fail", 1) })), "no-go");
  const noted = evaluateHealth(undefined, undefined, undefined, NOW, {
    ...good,
    uncommitted: read("uncommitted", HOUR, "fail", 9),
    changelog: read("changelog", HOUR, "fail", 1),
    links: read("links", HOUR, "fail", 4),
    readiness: read("readiness", HOUR, "fail", 1),
    staleBranches: read("staleBranches", HOUR, "fail", 2),
  });
  assert.equal(noted.signals?.length, 5);
  assert.equal(noted.clean, true);
  assert.equal(lightOf(noted), "go");
});

test("Path to GO: failing dependencies are a step after the build; notes add no step", () => {
  const failing = evaluateHealth(undefined, undefined, undefined, NOW, { deps: read("deps", HOUR, "fail", 2), build: read("build", HOUR, "fail", 1) });
  const m = buildBoard(cfg, [], undefined, true, undefined, undefined, { app: failing });
  const steps = pathToGo(m, m.projects[0], opts).steps;
  assert.deepEqual(steps.map((s) => s.kind), ["build", "deps", "lint", "tests"]);
  assert.equal(steps[1].detail, "Dependency report: 2 vulnerable or discontinued (1 h ago)");
  const notesOnly = evaluateHealth(undefined, undefined, undefined, NOW, { ...good, prs: read("prs", HOUR, "pass", 3) });
  const m2 = buildBoard(cfg, [], undefined, true, undefined, undefined, { app: notesOnly });
  assert.deepEqual(pathToGo(m2, m2.projects[0], opts).steps, []);
});

// ---- the page ----

const t: BoardStrings = new Proxy({} as BoardStrings, {
  get: (_o, k: string) => {
    const table: Record<string, string> = {
      sigPrs: "Pull requests waiting for your review: {count}",
      sigUncommitted: "Files not committed: {count}",
      sigStaleBranches: "Old unmerged branches: {count}",
      sigChangelog: "The changelog does not match",
      sigVersion: "The version differs",
      sigLinks: "Broken links: {count}",
      sigReadyPass: "Release checks: tests and lint passing",
      sigReadyFail: "Release checks failing: {count}",
      healthDeps: "Dependencies",
      ptgDepsFailing: "Dependencies are failing.",
      tidyHeading: "Tidy",
      tidyNote: "Idle {days} days",
      tidyReportsNote: "From the daily reports.",
      tidyOpenReport: "Open report",
      tidyRepDebt: "Debt: {count}",
      tidyRepDebtTrend: "Debt: {count}, {trend}",
      tidyTrendUp: "rising",
      tidyTrendDown: "falling",
      tidyTrendSame: "unchanged",
      tidyRepBranches: "Merged branches: {count}",
      tidyRepBloat: "Bloat: {count}",
      tidyRepBigFiles: "Large files: {count}",
      tidyTitle: "{count} to tidy",
      tidyMove: "Move",
    };
    return table[k] ?? `[${k}]`;
  },
});

function page(h: ProjectHealth, extra?: Parameters<typeof buildBoard>[7]): string {
  const m = buildBoard(cfg, [], undefined, true, undefined, undefined, { app: h }, extra);
  return renderBoard(m, t, "N", 1, {}, m.projects.map((p) => pathToGo(m, p, opts)));
}

test("html: the row notes read exactly, warnings are marked, a clean report adds nothing", () => {
  const h = evaluateHealth(undefined, undefined, undefined, NOW, {
    ...good,
    prs: read("prs", HOUR, "pass", 3),
    uncommitted: read("uncommitted", HOUR, "fail", 5),
    staleBranches: read("staleBranches", HOUR, "pass", 0),
    links: read("links", HOUR, "fail", 2),
    readiness: read("readiness", HOUR, "pass", 0),
  });
  const out = page(h);
  assert.ok(out.includes('<span class="fn" title="Review queue report: 3 waiting for review (1 h ago)">Pull requests waiting for your review: <span class="pill" title="pillTip">3</span></span>'));
  assert.ok(out.includes('<span class="fn warn" title="Uncommitted-work report: 5 files not committed (1 h ago)">Files not committed: <span class="pill" title="pillTip">5</span></span>'));
  assert.ok(out.includes('<span class="fn warn" title="Link report: 2 broken links (1 h ago)">Broken links: <span class="pill" title="pillTip">2</span></span>'));
  assert.ok(out.includes('<span class="fn" title="Release readiness report: tests and lint passing (1 h ago)">Release checks: tests and lint passing</span>'));
  assert.ok(!out.includes("Old unmerged"));
  assert.ok(!out.includes("reports/"));
});

test("html: a project with no signal has no note span; the dependency mark shows only with a report", () => {
  const plain = page(evaluateHealth(undefined, undefined, undefined, NOW, good));
  assert.ok(!plain.includes('class="fn'));
  assert.ok(!plain.includes("Dependencies: "));
  const withDeps = page(evaluateHealth(undefined, undefined, undefined, NOW, { ...good, deps: read("deps", HOUR, "fail", 2) }));
  assert.ok(withDeps.includes('title="g.redDot: Dependencies: Dependency report: 2 vulnerable or discontinued (1 h ago)"'));
  assert.ok(withDeps.includes("Dependencies are failing."));
});

// ---- Tidy ----

const tidyOn = { now: NOW, afterDays: 7, archiveFolder: "docs/history" };

test("Tidy: the report candidates are the tech-debt, branch, bloat and large-file reports that found something", () => {
  const h = evaluateHealth(undefined, undefined, undefined, NOW, {
    debt: { ...(read("debt", HOUR, "pass", 12) as Extract<ReturnType<typeof read>, { ok: true }>), previousCount: 8 },
    branches: read("branches", HOUR, "pass", 3),
    bloat: read("bloat", HOUR, "pass", 0),
    bigFiles: read("bigFiles", HOUR, "fail", 2),
  });
  const m = buildBoard(cfg, [], undefined, true, undefined, undefined, { app: h }, { tidy: tidyOn });
  assert.deepEqual(m.tidy?.reports, [
    { project: "app", projectName: "App", kind: "debt", count: 12, trend: "up", at: NOW - HOUR },
    { project: "app", projectName: "App", kind: "branches", count: 3, at: NOW - HOUR },
    { project: "app", projectName: "App", kind: "bigFiles", count: 2, at: NOW - HOUR },
  ]);
});

test("Tidy: the setting off, no report or only stale ones give no candidates", () => {
  const h = evaluateHealth(undefined, undefined, undefined, NOW, { debt: read("debt", HOUR, "pass", 12) });
  assert.deepEqual(buildBoard(cfg, [], undefined, true, undefined, undefined, { app: h }, { tidy: { ...tidyOn, reports: false } }).tidy?.reports, []);
  assert.deepEqual(buildBoard(cfg, [], undefined, true, undefined, undefined, { app: evaluateHealth(undefined, undefined, undefined, NOW) }, { tidy: tidyOn }).tidy?.reports, []);
  const stale = evaluateHealth(undefined, undefined, undefined, NOW, { debt: read("debt", 5 * DAY, "pass", 12) });
  assert.deepEqual(buildBoard(cfg, [], undefined, true, undefined, undefined, { app: stale }, { tidy: tidyOn }).tidy?.reports, []);
});

test("html: the Tidy box lists report candidates read-only, by index, with no path and no move button", () => {
  const h = evaluateHealth(undefined, undefined, undefined, NOW, {
    debt: { ...(read("debt", HOUR, "pass", 12) as Extract<ReturnType<typeof read>, { ok: true }>), previousCount: 12 },
    branches: read("branches", HOUR, "pass", 3),
  });
  const out = page(h, { tidy: tidyOn });
  assert.ok(out.includes('<span class="f">Debt: <span class="pill" title="pillTip">12</span>, unchanged</span><button class="sec" data-tidyrep="0" title="tidyReport">Open report</button>'));
  assert.ok(out.includes('<span class="f">Merged branches: <span class="pill" title="pillTip">3</span></span><button class="sec" data-tidyrep="1" title="tidyReport">Open report</button>'));
  assert.ok(out.includes("From the daily reports."));
  assert.ok(!out.includes("data-tidy="), "no document move button");
  assert.ok(!out.includes("Idle 7 days"), "the document note is left out when no document is listed");
  assert.ok(!out.includes("reports/"));
});

test("html: with no document and no report the Tidy box is not drawn", () => {
  const out = page(evaluateHealth(undefined, undefined, undefined, NOW, good), { tidy: tidyOn });
  assert.ok(!out.includes('id="tidy-box"'));
});
