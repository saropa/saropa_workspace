// Board shared types: the state list and the zeroed counts.

import { test } from "node:test";
import assert from "node:assert/strict";
import { ALL_STATUSES, emptyCounts } from "../../board/types";

test("every state is listed once", () => {
  assert.deepEqual([...ALL_STATUSES], ["red", "amber", "purple", "blue", "green", "reference", "grey"]);
  assert.equal(new Set(ALL_STATUSES).size, ALL_STATUSES.length);
});

test("empty counts hold zero for every state and nothing else", () => {
  const c = emptyCounts();
  assert.deepEqual(Object.keys(c).sort(), [...ALL_STATUSES].sort());
  assert.ok(Object.values(c).every((n) => n === 0));
});

test("each call gives a fresh object", () => {
  const a = emptyCounts();
  a.red = 5;
  assert.equal(emptyCounts().red, 0);
});
