// Reading a daily report as board evidence. Stale, missing or unreadable reports are never a pass.

import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_AGE_HOURS, clampAgeHours, clampIdleMinutes, deriveFeedNote, readFeedReport } from "../../board/recipeEvidence";
import { formatSummaryLine } from "../../board/reportSummary";

const HOUR = 3600000;
const DAY = 24 * HOUR;
const NOW = Date.parse("2026-10-27T12:00:00.000Z");
const LIMIT = 36 * HOUR;

function file(recipe: string, ageMs: number, result: "pass" | "fail" | "unknown", count?: number, mtimeAgeMs = ageMs) {
  return { text: `${formatSummaryLine({ recipe, time: NOW - ageMs, result, count })}\n# Report\n`, mtimeMs: NOW - mtimeAgeMs };
}

test("no report file is grey with the reason 'No report yet'", () => {
  assert.deepEqual(readFeedReport("tests", undefined, NOW, LIMIT), { ok: false, feed: "tests", why: "none", detail: "No report yet", ageMs: undefined });
});

test("a fresh passing tests report is a pass with its age and an exact detail", () => {
  const r = readFeedReport("tests", file("ritual.tests", 6 * HOUR, "pass", 0), NOW, LIMIT);
  assert.deepEqual(r, { ok: true, feed: "tests", result: "pass", count: 0, at: NOW - 6 * HOUR, ageMs: 6 * HOUR, detail: "Test report: passing (6 h ago)" });
});

test("a fresh failing report names its count", () => {
  const t = readFeedReport("tests", file("ritual.tests", 2 * HOUR, "fail", 3), NOW, LIMIT);
  assert.ok(t.ok && t.result === "fail" && t.detail === "Test report: failing, 3 failed (2 h ago)");
  const l = readFeedReport("lint", file("ritual.lint", 2 * HOUR, "fail", 12), NOW, LIMIT);
  assert.ok(l.ok && l.detail === "Lint report: failing, 12 findings (2 h ago)");
  const b = readFeedReport("build", file("ritual.ci", 2 * HOUR, "fail", 2), NOW, LIMIT);
  assert.ok(b.ok && b.detail === "Build report: failing, 2 failing (2 h ago)");
});

test("a report older than the limit is grey and says how old", () => {
  const r = readFeedReport("lint", file("ritual.lint", 3 * DAY + HOUR, "pass", 0), NOW, LIMIT);
  assert.deepEqual(r, { ok: false, feed: "lint", why: "stale", detail: "Report is 3 days old", ageMs: 3 * DAY + HOUR });
  const hours = readFeedReport("lint", file("ritual.lint", 20 * HOUR, "pass", 0), NOW, 10 * HOUR);
  assert.ok(!hours.ok && hours.detail === "Report is 20 hours old");
  const one = readFeedReport("lint", file("ritual.lint", DAY + HOUR, "pass", 0), NOW, HOUR);
  assert.ok(!one.ok && one.detail === "Report is 1 day old");
});

test("a report exactly at the limit is still fresh; one millisecond past is stale", () => {
  assert.equal(readFeedReport("tests", file("ritual.tests", LIMIT, "pass", 0), NOW, LIMIT).ok, true);
  assert.equal(readFeedReport("tests", file("ritual.tests", LIMIT + 1, "pass", 0), NOW, LIMIT).ok, false);
});

test("the older of the summary time and the file time sets the age", () => {
  const touched = readFeedReport("tests", file("ritual.tests", 50 * HOUR, "pass", 0, HOUR), NOW, LIMIT);
  assert.ok(!touched.ok && touched.why === "stale", "a touched old report is not fresh");
  const copied = readFeedReport("tests", file("ritual.tests", HOUR, "pass", 0, 50 * HOUR), NOW, LIMIT);
  assert.ok(!copied.ok && copied.why === "stale", "a report file that is itself old is not fresh");
});

test("a report with no summary line, or another recipe's, is unreadable", () => {
  assert.deepEqual(readFeedReport("tests", { text: "# Test trend\nok\n", mtimeMs: NOW }, NOW, LIMIT), { ok: false, feed: "tests", why: "unreadable", detail: "The report has no summary line", ageMs: undefined });
  const wrong = readFeedReport("tests", file("ritual.lint", HOUR, "pass", 0), NOW, LIMIT);
  assert.ok(!wrong.ok && wrong.why === "unreadable");
});

test("a report that could not tell is grey, never a pass", () => {
  const r = readFeedReport("build", file("ritual.ci", HOUR, "unknown"), NOW, LIMIT);
  assert.deepEqual(r, { ok: false, feed: "build", why: "unknown", detail: "The report could not tell", ageMs: HOUR });
});

test("a report dated more than a day ahead is not evidence", () => {
  const r = readFeedReport("tests", file("ritual.tests", -2 * DAY, "pass", 0, -2 * DAY), NOW, LIMIT);
  assert.ok(!r.ok && r.why === "future" && r.detail === "The report is dated in the future");
});

test("the age limit and the idle wait stay inside their bounds", () => {
  assert.equal(clampAgeHours(0), 1);
  assert.equal(clampAgeHours(5000), 720);
  assert.equal(clampAgeHours(36.4), 36);
  assert.equal(clampAgeHours("many"), DEFAULT_AGE_HOURS);
  assert.equal(clampIdleMinutes(-3), 0);
  assert.equal(clampIdleMinutes(99), 60);
  assert.equal(clampIdleMinutes(undefined), 2);
});

test("a row's job note: running and queued say checking, a heavy queue says waiting", () => {
  const base = { heavy: false, hasShortcut: true, scheduleOn: true, fresh: false };
  assert.deepEqual(deriveFeedNote({ ...base, job: { state: "running" } }), { state: "checking" });
  assert.deepEqual(deriveFeedNote({ ...base, job: { state: "queued" } }), { state: "checking" });
  assert.deepEqual(deriveFeedNote({ ...base, heavy: true, job: { state: "queued" } }), { state: "waiting" });
});

test("a row's job note: a failed start gives the reason until a fresh report exists", () => {
  const base = { heavy: false, hasShortcut: true, scheduleOn: true };
  assert.deepEqual(deriveFeedNote({ ...base, fresh: false, job: { state: "failed", reason: "gh is not installed" } }), { state: "failed", reason: "gh is not installed" });
  assert.equal(deriveFeedNote({ ...base, fresh: true, job: { state: "failed", reason: "x" } }), undefined);
});

test("a row's job note: off only when the recipe exists, its schedule is off and no fresh report exists", () => {
  const base = { heavy: false, job: undefined };
  assert.deepEqual(deriveFeedNote({ ...base, hasShortcut: true, scheduleOn: false, fresh: false }), { state: "off" });
  assert.equal(deriveFeedNote({ ...base, hasShortcut: true, scheduleOn: false, fresh: true }), undefined);
  assert.equal(deriveFeedNote({ ...base, hasShortcut: true, scheduleOn: true, fresh: false }), undefined);
  assert.equal(deriveFeedNote({ ...base, hasShortcut: false, scheduleOn: false, fresh: false }), undefined);
  assert.equal(deriveFeedNote({ ...base, job: { state: "running" }, hasShortcut: false, scheduleOn: false, fresh: false }), undefined);
});

test("a passing tests or build summary with a count contradicts itself; lint may pass with findings", () => {
  const t = readFeedReport("tests", file("ritual.tests", HOUR, "pass", 2), NOW, LIMIT);
  assert.deepEqual(t, { ok: false, feed: "tests", why: "unreadable", detail: "The report contradicts itself", ageMs: undefined });
  const b = readFeedReport("build", file("ritual.ci", HOUR, "pass", 1), NOW, LIMIT);
  assert.ok(!b.ok && b.why === "unreadable");
  const l = readFeedReport("lint", file("ritual.lint", HOUR, "pass", 5), NOW, LIMIT);
  assert.ok(l.ok && l.result === "pass" && l.count === 5);
});

test("a report under an hour old says 'just now'", () => {
  const r = readFeedReport("lint", file("ritual.lint", 20 * 60000, "pass", 0), NOW, LIMIT);
  assert.ok(r.ok && r.detail === "Lint report: passing (just now)");
});
