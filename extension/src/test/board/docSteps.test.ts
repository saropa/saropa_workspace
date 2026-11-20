// The heading reader shared by the open-step and fact readers (headingText in docSteps).

import { test } from "node:test";
import assert from "node:assert/strict";
import { headingText } from "../../board/docSteps";

test("headingText returns the text after the hashes and the space", () => {
  assert.equal(headingText("# Title", 6, false), "Title");
  assert.equal(headingText("### Deep heading", 6, false), "Deep heading");
});

test("headingText returns undefined when the hash run is not followed by a space", () => {
  assert.equal(headingText("#Title", 6, false), undefined);
});

test("headingText returns undefined for plain text and for more hashes than allowed", () => {
  assert.equal(headingText("not a heading", 6, false), undefined);
  assert.equal(headingText("####### seven", 6, false), undefined);
  assert.equal(headingText("### three", 2, false), undefined);
});

test("headingText keeps closing hashes unless lazy is set", () => {
  assert.equal(headingText("## T ##", 6, false), "T ##");
  assert.equal(headingText("## T ##", 6, true), "T");
});

test("headingText does not hang on a long run of spaces after the hashes", () => {
  // The reader is linear; the input here would take far too long for a quadratic pattern. The assertion is the
  // result, not a time budget.
  assert.equal(headingText("#" + " ".repeat(50_000) + "x", 6, false), "x");
});
