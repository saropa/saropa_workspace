// The summary line at the top of a feeding recipe's report, and the table that maps recipes to rows.

import { test } from "node:test";
import assert from "node:assert/strict";
import { FEEDS, catchUpOrder, feedOfAction, formatSummaryLine, parseLintCount, parseSummaryLine, summarizeShellRun } from "../../board/reportSummary";

const T = Date.parse("2026-10-27T05:30:12.000Z");

test("the summary line has one exact format and reads back to the same values", () => {
  const line = formatSummaryLine({ recipe: "ritual.tests", time: T, result: "pass", count: 0 });
  assert.equal(line, "<!-- saropa-summary recipe=ritual.tests time=2026-10-27T05:30:12.000Z result=pass count=0 -->");
  assert.deepEqual(parseSummaryLine(line), { recipe: "ritual.tests", time: T, result: "pass", count: 0 });
  assert.equal(formatSummaryLine({ recipe: "ritual.ci", time: T, result: "unknown" }), "<!-- saropa-summary recipe=ritual.ci time=2026-10-27T05:30:12.000Z result=unknown -->");
  assert.deepEqual(parseSummaryLine(formatSummaryLine({ recipe: "ritual.ci", time: T, result: "unknown" })), { recipe: "ritual.ci", time: T, result: "unknown", count: undefined });
});

test("the summary line is found in the first lines and nowhere later", () => {
  const line = formatSummaryLine({ recipe: "ritual.lint", time: T, result: "fail", count: 7 });
  assert.equal(parseSummaryLine(`${line}\n# Dawn lint sweep\n`)?.count, 7);
  assert.equal(parseSummaryLine(`\r\n${line}\r\n`)?.result, "fail");
  assert.equal(parseSummaryLine(`a\nb\nc\n${line}\n`), undefined);
});

test("a malformed summary line is not read", () => {
  assert.equal(parseSummaryLine(""), undefined);
  assert.equal(parseSummaryLine("<!-- saropa-summary recipe=ritual.ci time=soon result=pass -->"), undefined);
  assert.equal(parseSummaryLine("<!-- saropa-summary recipe=ritual.ci time=2026-10-27T05:30:12.000Z result=great -->"), undefined);
  assert.equal(parseSummaryLine("<!-- saropa-summary recipe=ritual.ci time=2026-10-27T05:30:12.000Z result=pass count=-1 -->"), undefined);
});

test("a negative or fractional count is left out of the line", () => {
  assert.ok(!formatSummaryLine({ recipe: "ritual.ci", time: T, result: "pass", count: -1 }).includes("count"));
  assert.ok(!formatSummaryLine({ recipe: "ritual.ci", time: T, result: "pass", count: 1.5 }).includes("count"));
});

test("lint findings are counted from common linters, and absent when unknown", () => {
  assert.equal(parseLintCount("Analyzing app...\n\n  warning - x.dart:1:1 - Unused\n\n12 issues found.\n"), 12);
  assert.equal(parseLintCount("1 issue found.\n"), 1);
  assert.equal(parseLintCount("✖ 5 problems (3 errors, 2 warnings)\n"), 5);
  assert.equal(parseLintCount("Found 4 errors.\n"), 4);
  assert.equal(parseLintCount("All checks passed!\n"), 0);
  assert.equal(parseLintCount("No issues found!\n"), 0);
  assert.equal(parseLintCount("something else\n"), undefined);
});

test("a lint run passes on exit 0 and fails otherwise; no exit is unknown", () => {
  assert.deepEqual(summarizeShellRun("lint", 0, "No issues found!\n", T), { recipe: "ritual.lint", time: T, result: "pass", count: 0 });
  assert.deepEqual(summarizeShellRun("lint", 1, "3 issues found.\n", T), { recipe: "ritual.lint", time: T, result: "fail", count: 3 });
  assert.deepEqual(summarizeShellRun("lint", null, "", T), { recipe: "ritual.lint", time: T, result: "unknown", count: undefined });
});

test("a tests run passes only with exit 0 and no failed test", () => {
  assert.deepEqual(summarizeShellRun("tests", 0, "# tests 10\n# pass 10\n# fail 0\n", T), { recipe: "ritual.tests", time: T, result: "pass", count: 0 });
  assert.deepEqual(summarizeShellRun("tests", 0, "# tests 10\n# pass 8\n# fail 2\n", T), { recipe: "ritual.tests", time: T, result: "fail", count: 2 });
  assert.deepEqual(summarizeShellRun("tests", 1, "no summary\n", T), { recipe: "ritual.tests", time: T, result: "fail", count: undefined });
  assert.deepEqual(summarizeShellRun("tests", 0, "no summary\n", T), { recipe: "ritual.tests", time: T, result: "pass", count: undefined });
});

test("only lint and tests runs are summarized from shell output", () => {
  assert.equal(summarizeShellRun("build", 0, "", T), undefined);
  assert.equal(summarizeShellRun("deps", 0, "", T), undefined);
});

test("the feed of a recipe action comes from its command or its report file name", () => {
  assert.equal(feedOfAction({ commandId: "saropaWorkspace.recipe.ciStatus" })?.feed, "build");
  assert.equal(feedOfAction({ commandId: "saropaWorkspace.recipe.pubspecOutdated" })?.feed, "deps");
  assert.equal(feedOfAction({ reportFile: "reports/2026.10.27_workspace/2026.10.27_workspace_053012_tests.txt" })?.feed, "tests");
  assert.equal(feedOfAction({ reportFile: "reports/x/x_lint.txt" })?.feed, "lint");
  assert.equal(feedOfAction({ reportFile: "reports/x/x_debt.md" }), undefined);
  assert.equal(feedOfAction({ commandId: "saropaWorkspace.recipe.overnightDelta" }), undefined);
  assert.equal(feedOfAction(undefined), undefined);
});

test("catch-up order is build, lint, tests, dependencies; other jobs keep their order and come first", () => {
  const items = ["deps", "x1", "tests", "lint", "x2", "ci"];
  const info = (s: string) => FEEDS.find((f) => f.feed === (s === "ci" ? "build" : s));
  assert.deepEqual(catchUpOrder(items, info), ["x1", "x2", "ci", "lint", "tests", "deps"]);
});

test("only the full test run and dependencies are heavy", () => {
  assert.deepEqual(FEEDS.filter((f) => f.heavy).map((f) => f.feed), ["tests", "deps"]);
});
