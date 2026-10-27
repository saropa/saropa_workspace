// Tests for part 1 of the generated icon keyword data: shape and ordering of its entries.

import { test } from "node:test";
import assert from "node:assert/strict";
import { ICON_KEYWORDS_PART_1 as PART } from "../views/iconKeywordsData1";

const ids = Object.keys(PART);

test("the part is not empty", () => {
  assert.ok(ids.length > 100, `only ${ids.length} entries`);
});

test("every id is a lowercase codicon id of letters, digits and dashes", () => {
  assert.deepEqual(ids.filter((id) => !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id)), []);
});

test("every value is one or more lowercase words (dashes allowed) separated by single spaces", () => {
  const bad = ids.filter((id) => !/^[a-z0-9-]+( [a-z0-9-]+)*$/.test(PART[id]));
  assert.deepEqual(bad, []);
});

test("the ids run in alphabetical order", () => {
  const sorted = [...ids].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  assert.deepEqual(ids, sorted);
});
