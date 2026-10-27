// Code health evidence and the GO light. GO needs every check; anything missing is UNVERIFIED.

import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateHealth, parseLintsFile, parseTestTally } from "../../board/health";
import { buildBoard } from "../../board/boardModel";
import { BoardConfig } from "../../board/types";

const DAY = 86400000;
const NOW = 100 * DAY;
const lintJson = (s: object, extra: object = {}): string => JSON.stringify({ summary: s, ...extra });

test("a Lints file is trusted only when it analyzed enough files", () => {
  const ok = parseLintsFile(lintJson({ filesAnalyzed: 100, filesExpected: 120, byImpact: { error: 2, warning: 5 } }, { timestamp: "1970-04-09T00:00:00Z" }), 0);
  assert.ok(ok.ok && ok.result.errors === 2 && ok.result.warnings === 5);
  assert.deepEqual(parseLintsFile(lintJson({ filesAnalyzed: 5, filesExpected: 100 }), 0), { ok: false, why: "partial" });
  assert.deepEqual(parseLintsFile(lintJson({ filesAnalyzed: 0 }), 0), { ok: false, why: "empty" });
  assert.deepEqual(parseLintsFile("not json", 0), { ok: false, why: "unreadable" });
});

test("test tallies are read from common runners, and absent when unknown", () => {
  assert.deepEqual(parseTestTally("# tests 1545\n# suites 6\n# pass 1545\n# fail 0\n"), { run: 1545, failed: 0 });
  assert.deepEqual(parseTestTally("Tests:       2 failed, 8 passed, 10 total\n"), { run: 10, failed: 2 });
  assert.deepEqual(parseTestTally("00:05 +120 -3: Some tests failed.\n"), { run: 123, failed: 3 });
  assert.deepEqual(parseTestTally("==== 3 failed, 7 passed in 1.20s ====\n"), { run: 10, failed: 3 });
  assert.equal(parseTestTally("all good\n"), undefined);
});

test("evidence: stale and missing results are never a pass; failures are failures", () => {
  const fresh = parseLintsFile(lintJson({ filesAnalyzed: 10, byImpact: { error: 0 } }), NOW - DAY);
  const run = { name: "t", outcome: "success" as const, exitCode: 0, endedAt: NOW - DAY, run: 50, failed: 0 };
  assert.equal(evaluateHealth(undefined, { tests: run }, fresh, NOW).clean, true);
  assert.equal(evaluateHealth(undefined, undefined, fresh, NOW).tests, "missing");
  const old = parseLintsFile(lintJson({ filesAnalyzed: 10 }), NOW - 30 * DAY);
  assert.equal(evaluateHealth(undefined, { tests: run }, old, NOW).lint, "missing");
  assert.equal(evaluateHealth(undefined, { tests: { ...run, failed: 2 } }, fresh, NOW).tests, "failing");
  assert.equal(evaluateHealth({ testsApply: false, lintApplies: false }, undefined, undefined, NOW).clean, true);
  assert.equal(evaluateHealth(undefined, { tests: { ...run, outcome: "failure", exitCode: 1, run: undefined } }, fresh, NOW).tests, "failing");
});

const cfg: BoardConfig = { version: 1, ignore: [], ruleSets: {}, projects: [{ id: "app", name: "App", path: "app", roots: [], ruleSets: [] }] };
const good = evaluateHealth({ testsApply: false }, undefined, parseLintsFile(lintJson({ filesAnalyzed: 10, byImpact: { error: 0 } }), NOW - DAY), NOW);

test("GO only with an accepted baseline, no blocker, no grey and clean health", () => {
  assert.equal(buildBoard(cfg, [], undefined, true, undefined, undefined, { app: good }).projects[0].light, "go");
  assert.equal(buildBoard(cfg, [], undefined, true).projects[0].light, "unverified");
  assert.equal(buildBoard(cfg, [], undefined, false, undefined, undefined, { app: good }).projects[0].light, "unverified");
  const grey = [{ project: "app", path: "docs/x.md", status: "grey" as const, kind: "", note: "" }];
  assert.equal(buildBoard(cfg, grey, undefined, true, undefined, undefined, { app: good }).projects[0].light, "unverified");
  const bad = evaluateHealth({ testsApply: false }, undefined, parseLintsFile(lintJson({ filesAnalyzed: 10, byImpact: { error: 1 } }), NOW - DAY), NOW);
  assert.equal(buildBoard(cfg, [], undefined, true, undefined, undefined, { app: bad }).projects[0].light, "no-go");
});

test("a run that ran zero tests is not a pass; a newer failing lint run beats an older clean file", () => {
  const run = { name: "t", outcome: "success" as const, exitCode: 0, endedAt: NOW - DAY, run: 0, failed: 0 };
  assert.equal(evaluateHealth(undefined, { tests: run }, undefined, NOW).tests, "missing");
  const file = parseLintsFile(lintJson({ filesAnalyzed: 10, byImpact: { error: 0 } }), NOW - 3 * DAY);
  const lintRun = { name: "l", outcome: "failure" as const, exitCode: 1, endedAt: NOW - DAY };
  assert.equal(evaluateHealth(undefined, { lint: lintRun }, file, NOW).lint, "failing");
});

test("a Lints file with no error count or a future date is not evidence", () => {
  assert.deepEqual(parseLintsFile(lintJson({ filesAnalyzed: 10 }), 0), { ok: false, why: "unreadable" });
  const future = parseLintsFile(lintJson({ filesAnalyzed: 10, byImpact: { error: 0 } }), NOW + 30 * DAY);
  assert.equal(evaluateHealth(undefined, undefined, future, NOW).lint, "missing");
});

test("tally parsing ignores diff-like lines and counts pytest errors", () => {
  assert.equal(parseTestTally("diff +3: added line\nhello\n"), undefined);
  assert.deepEqual(parseTestTally("=== 2 passed, 3 errors in 0.5s ===\n"), { run: 5, failed: 3 });
  assert.deepEqual(parseTestTally("ℹ tests 12\nℹ pass 11\nℹ fail 1\n"), { run: 12, failed: 1 });
});

test("a failing test run is NO-GO even when everything else is clean", () => {
  const fail = evaluateHealth({ lintApplies: false }, { tests: { name: "t", outcome: "failure", exitCode: 1, endedAt: NOW - DAY } }, undefined, NOW);
  assert.equal(buildBoard(cfg, [], undefined, true, undefined, undefined, { app: fail }).projects[0].light, "no-go");
});
