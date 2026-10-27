// Document facts: what is read from the text of one document, and the marks rolled up
// from them.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFacts, sizeClass, stepTotals } from "../../board/docFacts";

const DOC = [
  "# Plan: share keys",
  "",
  "See docs/OTHER.md and pull request 1923 or #1888. Also https://example.com/x.",
  "Edit lib/service/a.dart and lib/service/a.dart and scripts/run.py.",
  "Needs the supabase side.",
  "",
  "## Steps",
  "- [x] one",
  "- [ ] two",
  "* [ ] three",
  "",
  "| Item | Status |",
  "|---|---|",
  "| a | Done |",
  "| b | Pending |",
  "",
  "```sql",
  "select 1; -- # not a heading, docs/IN_CODE.md",
  "```",
  "```dart",
  "void main() {}",
  "```",
].join("\n");

test("title, headings, steps, rows, code, references and mentions", () => {
  const f = readFacts(DOC, "docs/PLAN.md", { mentions: { db: "supabase", web: "website" } });
  assert.equal(f.title, "Plan: share keys");
  assert.equal(f.headings, 2);
  assert.equal(f.stepsDone, 1);
  assert.equal(f.stepsOpen, 2);
  assert.deepEqual([f.rowsDone, f.rowsAll], [1, 2]);
  assert.deepEqual(stepTotals(f), { done: 2, total: 5 });
  assert.equal(f.codeBlocks, 2);
  assert.deepEqual(f.langs, { sql: 1, dart: 1 });
  assert.equal(f.docRefs, 1, "docs/IN_CODE.md is inside code and not counted; docs/OTHER.md is");
  assert.equal(f.sourceRefs, 2, "the same file named twice counts once");
  assert.equal(f.prs, 2);
  assert.equal(f.urls, 1);
  assert.deepEqual(f.mentions, ["db"]);
});

test("a table header row and a heading-less document", () => {
  const f = readFacts("no heading here\n| Item | Status |\n|---|---|\n", "docs/x.md");
  assert.equal(f.title, "");
  assert.equal(f.rowsAll, 0);
});

test("sql: the title is the first descriptive comment and there is one sql block", () => {
  const sql = "-- cspell: disable\n-- Date: 2026-10-23\n-- Blank the old-format shared contact details.\nupdate t set x = 1;";
  const f = readFacts(sql, "db-access/a.sql");
  assert.equal(f.title, "Blank the old-format shared contact details.");
  assert.deepEqual(f.langs, { sql: 1 });
  assert.equal(f.headings, 0);
});

test("size classes", () => {
  assert.deepEqual([100, 801, 3001, 20001].map(sizeClass), [1, 2, 3, 4]);
});

test("a bad mention pattern in a user rule file mentions nothing and does not throw", () => {
  assert.deepEqual(readFacts("x", "a.md", { mentions: { a: "(" } }).mentions, []);
});

test("a heading-looking line inside a code block is not a heading", () => {
  const f = readFacts("# Real\n\n```md\n# not a heading\n```\n", "docs/a.md");
  assert.equal(f.headings, 1);
  assert.equal(f.title, "Real");
});
