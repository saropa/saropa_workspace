// Board glob: the translation to a regular expression, one rule per test.

import { test } from "node:test";
import assert from "node:assert/strict";
import { globToRegExp } from "../../board/glob";

test("a star matches within one folder only", () => {
  const re = globToRegExp("docs/*.md");
  assert.ok(re.test("docs/a.md"));
  assert.ok(!re.test("docs/sub/a.md"));
  assert.ok(!re.test("other/docs/a.md"), "the whole text must match");
});

test("a double star followed by a slash matches zero or more folders", () => {
  const re = globToRegExp("**/plans/*.md");
  assert.ok(re.test("plans/a.md"));
  assert.ok(re.test("a/b/plans/a.md"));
  assert.ok(!re.test("a/b/plans/c/a.md"));
});

test("a double star on its own matches anything, slashes included", () => {
  const re = globToRegExp("docs/**");
  assert.ok(re.test("docs/a/b/c.md"));
  assert.ok(re.test("docs/"));
  assert.ok(!re.test("doc/a.md"));
});

test("a question mark is exactly one character, never a slash", () => {
  const re = globToRegExp("a?c");
  assert.ok(re.test("abc"));
  assert.ok(!re.test("ac"));
  assert.ok(!re.test("a/c"));
});

test("braces give alternatives that may hold wildcards", () => {
  const re = globToRegExp("{BUG_*,FIX_*}.md");
  assert.ok(re.test("BUG_one.md"));
  assert.ok(re.test("FIX_two.md"));
  assert.ok(!re.test("PLAN_one.md"));
});

test("an unclosed brace is literal text", () => {
  assert.ok(globToRegExp("a{b").test("a{b"));
  assert.ok(!globToRegExp("a{b").test("ab"));
});

test("regular expression characters in a glob are literal", () => {
  const re = globToRegExp("v1.0+(beta).md");
  assert.ok(re.test("v1.0+(beta).md"));
  assert.ok(!re.test("v1x0+(beta).md"));
  assert.ok(globToRegExp("a|b").test("a|b"));
  assert.ok(!globToRegExp("a|b").test("a"));
});
