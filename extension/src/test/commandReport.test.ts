// Unit tests for buildCommandReport — the single formatter every scheduled shell
// ritual's report goes through (report-bug items 1 and 2: raw command output was
// rendered as Markdown prose and read as slop). Pure string building, so it runs
// under the built-in runner with the vscode stub. The assertions pin the fixes: a
// fenced output block, a clean header, an explicit empty-output line, and a fence
// that a body containing its own backtick run cannot break out of.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCommandReport } from "../exec/actionRunner";

test("command output is wrapped in a fenced code block under a clean header", () => {
  const md = buildCommandReport("Standup digest", 'git log --oneline', "abc123 fix\ndef456 feat");
  assert.match(md, /^# Standup digest\n/);
  assert.match(md, /\*\*Generated\*\* /);
  // The command is code-formatted so it is copy-paste safe.
  assert.match(md, /\*\*Command\*\* `git log --oneline`/);
  // The output sits inside a fence, not as bare prose.
  assert.match(md, /```text\nabc123 fix\ndef456 feat\n```/);
});

test("an empty result is stated plainly, not left as a blank fence", () => {
  const md = buildCommandReport("PR review queue", "gh pr list", "   \n  ");
  assert.match(md, /_No output\._/);
  assert.doesNotMatch(md, /```/);
});

test("a body containing a fence cannot break out of the block", () => {
  // Output that itself contains ``` must be wrapped in a LONGER fence, so the report
  // stays a single code block (a grep over Markdown can produce this).
  const body = "file.md:1:```dart\nfile.md:2:code";
  const md = buildCommandReport("Tech-debt harvest", "git grep", body);
  // The chosen fence is four backticks (one longer than the 3-run in the body).
  assert.match(md, /````text\n/);
  assert.match(md, /\n````\n/);
});
