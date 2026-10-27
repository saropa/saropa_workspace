// Tests for the merged icon keyword map: it is exactly the union of the two data parts.

import { test } from "node:test";
import assert from "node:assert/strict";
import { ICON_KEYWORDS } from "../views/iconKeywords";
import { ICON_KEYWORDS_PART_1 } from "../views/iconKeywordsData1";
import { ICON_KEYWORDS_PART_2 } from "../views/iconKeywordsData2";

test("the merged map holds every entry of both parts with the same words", () => {
  const expectedCount = Object.keys(ICON_KEYWORDS_PART_1).length + Object.keys(ICON_KEYWORDS_PART_2).length;
  assert.equal(Object.keys(ICON_KEYWORDS).length, expectedCount);
  for (const [id, words] of Object.entries({ ...ICON_KEYWORDS_PART_1, ...ICON_KEYWORDS_PART_2 })) {
    assert.equal(ICON_KEYWORDS[id], words, id);
  }
});

test("no icon id appears in both parts", () => {
  const second = new Set(Object.keys(ICON_KEYWORDS_PART_2));
  assert.deepEqual(Object.keys(ICON_KEYWORDS_PART_1).filter((id) => second.has(id)), []);
});

test("a known concept is found through its keywords", () => {
  assert.match(ICON_KEYWORDS["account"], /\buser\b/);
  assert.match(ICON_KEYWORDS["add"], /\bplus\b/);
});
