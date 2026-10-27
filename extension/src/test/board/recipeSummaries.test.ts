// The summary lines of the recipes that write their own report. A run that could not look is unknown.

import { test } from "node:test";
import assert from "node:assert/strict";
import { bloatSummaryLine, deltaSummaryLine, outdatedSummaryLine, standupSummaryLine } from "../../board/recipeSummaries";
import { parseSummaryLine } from "../../board/reportSummary";

const T = Date.parse("2026-10-27T05:30:12.000Z");
const at = "2026-10-27T05:30:12.000Z";

test("dependencies: a discontinued package fails with those packages counted; otherwise it passes with the packages behind", () => {
  assert.equal(outdatedSummaryLine([{ discontinued: false }, { discontinued: true }, { discontinued: true }], T), `<!-- saropa-summary recipe=ritual.deps time=${at} result=fail count=2 -->`);
  assert.equal(outdatedSummaryLine([{ discontinued: false }, { discontinued: false }], T), `<!-- saropa-summary recipe=ritual.deps time=${at} result=pass count=2 -->`);
  assert.equal(outdatedSummaryLine([], T), `<!-- saropa-summary recipe=ritual.deps time=${at} result=pass count=0 -->`);
});

test("standup: commits pass; none is unknown because a git failure looks the same", () => {
  assert.equal(standupSummaryLine(7, T), `<!-- saropa-summary recipe=ritual.standup time=${at} result=pass count=7 -->`);
  assert.equal(standupSummaryLine(0, T), `<!-- saropa-summary recipe=ritual.standup time=${at} result=unknown -->`);
});

test("since yesterday: unavailable git or no baseline is unknown; otherwise the commit count passes", () => {
  assert.equal(deltaSummaryLine({ unavailable: true, commits: 0 }, T), `<!-- saropa-summary recipe=ritual.delta time=${at} result=unknown -->`);
  assert.equal(deltaSummaryLine({ unavailable: false, commits: 3 }, T), `<!-- saropa-summary recipe=ritual.delta time=${at} result=unknown -->`);
  assert.equal(deltaSummaryLine({ unavailable: false, baseline: "abc", commits: 3 }, T), `<!-- saropa-summary recipe=ritual.delta time=${at} result=pass count=3 -->`);
});

test("bloat scan: findings fail, none passes, and a scan that measured nothing is unknown", () => {
  assert.equal(bloatSummaryLine(2, 1, T), `<!-- saropa-summary recipe=hygiene.bloat time=${at} result=fail count=2 -->`);
  assert.equal(bloatSummaryLine(0, 3, T), `<!-- saropa-summary recipe=hygiene.bloat time=${at} result=pass count=0 -->`);
  assert.equal(bloatSummaryLine(0, 0, T), `<!-- saropa-summary recipe=hygiene.bloat time=${at} result=unknown -->`);
});

test("every line reads back with the same values", () => {
  assert.deepEqual(parseSummaryLine(standupSummaryLine(7, T)), { recipe: "ritual.standup", time: T, result: "pass", count: 7 });
});
