// One fence rule for the Needs reader, the Needs editor and the patch writer.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFacts } from "../../board/docFacts";
import { blankFences, scanFences } from "../../board/fences";
import { addNeed } from "../../board/needsEdit";

test("a ~~~ block is code: its Needs line is blanked and line breaks stay", () => {
  const text = "# T\n~~~\nNeeds: A.md\n~~~\nNeeds: B.md\n";
  assert.equal(blankFences(text), "# T\n\n\n\nNeeds: B.md\n");
});

test("a fence closes only on the same character, as long, with nothing after it", () => {
  const text = "~~~\n```\nNeeds: A.md\n~~~ tail\n~~~\nNeeds: B.md\n";
  assert.deepEqual(scanFences(text).fenced, [true, true, true, true, true, false]);
});

test("an unclosed fence runs to the end of the text", () => {
  assert.equal(blankFences("Needs: A.md\n```\nNeeds: B.md\n"), "Needs: A.md\n\n\n");
});

test("one line of inline code between backticks is not a fence", () => {
  assert.deepEqual(scanFences("```x```\nNeeds: A.md\n").fenced, [false, false]);
});

test("CRLF endings survive blanking", () => {
  assert.equal(blankFences("~~~\r\nNeeds: A.md\r\n~~~\r\nz\r\n"), "\r\n\r\n\r\nz\r\n");
});

test("the Needs reader skips a Needs line inside a ~~~ block", () => {
  const facts = readFacts("# T\n\n~~~\nNeeds: Hidden.md\n~~~\n\nNeeds: Shown.md\n", "plans/PLAN_X.md");
  assert.deepEqual(facts.needs, ["Shown.md"]);
});

test("adding a Needs line counts the one inside ~~~ as none", () => {
  const r = addNeed("# T\n\n~~~\nNeeds: Hidden.md\n~~~\n", "New.md");
  assert.equal(r.ok, true);
  const text = (r as { text: string }).text;
  assert.deepEqual(readFacts(text, "plans/PLAN_X.md").needs, ["New.md"]);
});
