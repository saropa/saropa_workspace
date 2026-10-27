// Edge cases for the report helpers beyond the headline tests in actionRunner.test.ts:
// fence width, CI wording, and how the headline reads for mixed output.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCommandReport, fenceBlock, summarizeReportBody } from "../exec/actionReport";

test("a fence is three backticks unless the body contains a longer run", () => {
  assert.equal(fenceBlock("hi"), "```text\nhi\n```");
  assert.equal(fenceBlock("a ``` b"), "````text\na ``` b\n````");
  assert.equal(fenceBlock("`` and `````"), "``````text\n`` and `````\n``````");
});

test("trailing newlines are dropped but inner blank lines stay", () => {
  assert.equal(fenceBlock("a\n\nb\n\n\n"), "```text\na\n\nb\n```");
});

test("a timed-out CI run counts as failing even without a workflow name", () => {
  const body = "completed\ttimed_out\ttitle\t\tmain\t1\n";
  assert.deepEqual(summarizeReportBody(body.trim()), { text: "1 of the last 1 CI runs failing", attention: true });
});

test("queued and in-progress runs are counted as still running", () => {
  const body = ["completed\tsuccess\ta\tCI\tmain", "in_progress\t\tb\tCI\tmain", "queued\t\tc\tCI\tmain"].join("\n");
  assert.deepEqual(summarizeReportBody(body), { text: "CI green, 2 still running", attention: false });
});

test("a single commit with no shortstat is singular", () => {
  assert.deepEqual(summarizeReportBody("abc1234 fix the thing"), { text: "1 commit", attention: false });
});

test("several shortstat lines are summed", () => {
  const body = [
    "abc1234 one",
    " 2 files changed, 10 insertions(+), 1 deletion(-)",
    "def5678 two",
    " 1 file changed, 5 insertions(+)",
  ].join("\n");
  assert.deepEqual(summarizeReportBody(body), { text: "2 commits · 3 files changed · +15 / -1", attention: false });
});

test("a status listing is reported as uncommitted files", () => {
  assert.deepEqual(summarizeReportBody(" M a.ts\n?? b.ts"), { text: "2 uncommitted files", attention: true });
  assert.deepEqual(summarizeReportBody(" M a.ts"), { text: "1 uncommitted file", attention: true });
});

test("a report with no output says so, and one with attention says Attention", () => {
  const empty = buildCommandReport("Name", "git status", "   ");
  assert.match(empty, /^# Name\n\n\*\*Generated\*\* /);
  assert.ok(empty.includes("**Headline:** Nothing to report."));
  assert.ok(empty.endsWith("_No output._\n"));
  const dirty = buildCommandReport("Name", "git status --short", " M a.ts\n");
  assert.ok(dirty.includes("**Attention:** 1 uncommitted file"));
  assert.ok(dirty.includes("**Command** `git status --short`"));
});

test("a report counts a leading unstaged-change line, whose first column is a space", () => {
  const report = buildCommandReport("Status", "git status --short", " M a.ts\n M b.ts\n");
  assert.ok(report.includes("**Attention:** 2 uncommitted files"));
});
