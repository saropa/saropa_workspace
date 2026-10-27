// The release readiness summary passes only on fresh, passing tests and lint with nothing else failing or unclear.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Readiness, buildReadinessMarkdown, combineReadiness, readinessSummaryLine } from "../../board/releaseReadiness";
import { EvidenceFeed, readFeedReport } from "../../board/recipeEvidence";
import { feedInfo, formatSummaryLine } from "../../board/reportSummary";

const HOUR = 3600000;
const NOW = Date.parse("2026-10-27T12:00:00.000Z");
const LIMIT = 36 * HOUR;

function read(feed: EvidenceFeed, ageMs: number, result: "pass" | "fail" | "unknown", count = 0) {
  return readFeedReport(feed, { text: formatSummaryLine({ recipe: feedInfo(feed).recipeId, time: NOW - ageMs, result, count }), mtimeMs: NOW - ageMs }, NOW, LIMIT);
}
const none = (feed: EvidenceFeed) => readFeedReport(feed, undefined, NOW, LIMIT);

test("fresh passing tests and lint pass, and the missing build and dependency reports are not covered", () => {
  const c = combineReadiness({ tests: read("tests", HOUR, "pass"), lint: read("lint", HOUR, "pass", 0), build: none("build"), deps: none("deps") });
  assert.equal(c.result, "pass");
  assert.equal(c.count, 0);
  assert.deepEqual(c.rows.map((r) => [r.feed, r.state]), [["build", "none"], ["tests", "pass"], ["lint", "pass"], ["deps", "none"]]);
});

test("missing tests or lint never passes, whatever else is green", () => {
  assert.equal(combineReadiness({ lint: read("lint", HOUR, "pass", 0), build: read("build", HOUR, "pass"), deps: read("deps", HOUR, "pass", 2) }).result, "unknown");
  assert.equal(combineReadiness({ tests: read("tests", HOUR, "pass") }).result, "unknown");
  assert.equal(combineReadiness({}).result, "unknown");
});

test("a stale, unreadable or unknown required report keeps it from passing", () => {
  assert.equal(combineReadiness({ tests: read("tests", 3 * 24 * HOUR, "pass"), lint: read("lint", HOUR, "pass", 0) }).result, "unknown");
  assert.equal(combineReadiness({ tests: read("tests", HOUR, "unknown"), lint: read("lint", HOUR, "pass", 0) }).result, "unknown");
  assert.equal(combineReadiness({ tests: { ...read("tests", HOUR, "pass"), ok: false, why: "unreadable", detail: "x" } as never, lint: read("lint", HOUR, "pass", 0) }).result, "unknown");
});

test("a stale or unclear optional report keeps it from passing; a dependency report that cannot tell does not", () => {
  const base = { tests: read("tests", HOUR, "pass"), lint: read("lint", HOUR, "pass", 0) };
  assert.equal(combineReadiness({ ...base, build: read("build", 5 * 24 * HOUR, "pass") }).result, "unknown");
  assert.equal(combineReadiness({ ...base, build: read("build", HOUR, "unknown") }).result, "unknown");
  assert.equal(combineReadiness({ ...base, deps: read("deps", HOUR, "unknown") }).result, "pass");
  assert.equal(combineReadiness({ ...base, deps: read("deps", 5 * 24 * HOUR, "pass", 1) }).result, "unknown");
});

test("any failing report fails it with the number failing, even when the others are missing", () => {
  const c = combineReadiness({ tests: read("tests", HOUR, "fail", 2), build: read("build", HOUR, "fail", 1) });
  assert.equal(c.result, "fail");
  assert.equal(c.count, 2);
  assert.equal(combineReadiness({ deps: read("deps", HOUR, "fail", 3) }).count, 1);
});

test("the summary line and report say exactly what was found", () => {
  const pass = combineReadiness({ tests: read("tests", HOUR, "pass"), lint: read("lint", HOUR, "pass", 0) });
  assert.equal(readinessSummaryLine(pass, NOW), "<!-- saropa-summary recipe=ritual.readiness time=2026-10-27T12:00:00.000Z result=pass count=0 -->");
  assert.equal(readinessSummaryLine({ result: "unknown", count: 0, rows: [] } as Readiness, NOW), "<!-- saropa-summary recipe=ritual.readiness time=2026-10-27T12:00:00.000Z result=unknown -->");
  const md = buildReadinessMarkdown(pass, "NOW");
  assert.ok(md.includes("| Tests | passing | Test report: passing (1 h ago) |"));
  assert.ok(md.includes("| Build | no report | No report yet |"));
  assert.ok(md.includes("Not covered (no report): Build, Dependencies."));
  assert.ok(md.includes("does not change the Release Board light"));
  assert.ok(buildReadinessMarkdown(combineReadiness({ tests: read("tests", HOUR, "fail", 1) }), "NOW").includes("**Result:** 1 check(s) failing."));
});
