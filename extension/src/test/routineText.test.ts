// Tests for the routine summary text helpers: status labels, the one-line detail
// sanitizer, and the heading demotion that embeds a member report in the summary.

import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultNote, embedMemberReport, sanitizeDetail, statusLabel } from "../exec/routineText";

test("every member status has its own label", () => {
  assert.deepEqual(
    (["ok", "failed", "skipped", "missing", "dispatched"] as const).map(statusLabel),
    ["OK", "Failed", "Skipped", "Missing", "Started"]
  );
});

test("only a missing member gets a default note", () => {
  assert.equal(
    defaultNote("missing"),
    "Shortcut not found — it was removed or renamed since this routine was configured. Edit the routine to re-link or remove this member."
  );
  for (const status of ["ok", "failed", "skipped", "dispatched"] as const) {
    assert.equal(defaultNote(status), "", status);
  }
});

test("a multi-line detail is joined into one trimmed line", () => {
  assert.equal(sanitizeDetail("  first line\n   second  \n\nthird "), "first line second third");
});

test("a detail over 200 characters is cut with an ellipsis, one of exactly 200 is kept", () => {
  assert.equal(sanitizeDetail("x".repeat(200)), "x".repeat(200));
  assert.equal(sanitizeDetail("x".repeat(201)), `${"x".repeat(200)}…`);
});

test("embedding drops the report's own title line", () => {
  assert.equal(embedMemberReport("\n# Standup digest\n\nBody text"), "Body text");
});

test("only a leading title is dropped; a later top-level heading is kept and demoted", () => {
  assert.equal(embedMemberReport("# Title\n\n# Second"), "### Second");
});

test("headings move down two levels, capped at level six", () => {
  assert.equal(embedMemberReport("## A\n### B\n#### C\n##### D\n###### E"), "#### A\n##### B\n###### C\n###### D\n###### E");
});

test("a hash line inside a code fence is left alone, and a longer fence is not closed by a shorter one", () => {
  const input = ["## Real", "```", "# not a heading", "```", "````", "## still code", "```", "## inside", "````", "## After"].join("\n");
  assert.equal(
    embedMemberReport(input),
    ["#### Real", "```", "# not a heading", "```", "````", "## still code", "```", "## inside", "````", "#### After"].join("\n")
  );
});

test("a tilde fence is tracked separately from a backtick fence", () => {
  assert.equal(embedMemberReport("~~~\n## code\n```\n## still code\n~~~\n## out"), "~~~\n## code\n```\n## still code\n~~~\n#### out");
});

test("a hash without a following space is not a heading", () => {
  assert.equal(embedMemberReport("#hashtag and ##tag"), "#hashtag and ##tag");
});
