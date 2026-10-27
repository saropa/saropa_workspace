// Board placement: which column the tab opens in.

import { test } from "node:test";
import assert from "node:assert/strict";
import { COLUMN_ACTIVE, COLUMN_BESIDE, chooseColumn, parsePlacement } from "../../board/placement";

const base = { setting: "beside" as const, stored: undefined, groupCount: 1, activeColumn: 1, background: false };

test("beside with an active editor and nothing stored opens beside", () => {
  assert.equal(chooseColumn(base), COLUMN_BESIDE);
  assert.equal(chooseColumn({ ...base, background: true }), COLUMN_BESIDE);
});

test("beside without an active editor opens in the active group", () => {
  assert.equal(chooseColumn({ ...base, activeColumn: undefined }), COLUMN_ACTIVE);
});

test("a stored column that is an open group is reused", () => {
  assert.equal(chooseColumn({ ...base, stored: 2, groupCount: 3 }), 2);
  assert.equal(chooseColumn({ ...base, stored: 1, groupCount: 3 }), 1);
});

test("a stored column one past the last group is reused (one new group)", () => {
  assert.equal(chooseColumn({ ...base, stored: 2, groupCount: 1 }), 2);
  assert.equal(chooseColumn({ ...base, stored: 4, groupCount: 3 }), 4);
});

test("a stored column further out falls back to beside", () => {
  assert.equal(chooseColumn({ ...base, stored: 3, groupCount: 1 }), COLUMN_BESIDE);
  assert.equal(chooseColumn({ ...base, stored: 9, groupCount: 3 }), COLUMN_BESIDE);
});

test("a stored value that is not a column is ignored", () => {
  for (const stored of [0, -2, 1.5, NaN, "2", null, {}]) {
    assert.equal(chooseColumn({ ...base, stored }), COLUMN_BESIDE);
  }
});

test("sameGroup uses the active editor group and ignores the stored column", () => {
  assert.equal(chooseColumn({ ...base, setting: "sameGroup", stored: 3, groupCount: 3, activeColumn: 2 }), 2);
});

test("sameGroup without an active editor: column one, or the active group in the background", () => {
  assert.equal(chooseColumn({ ...base, setting: "sameGroup", activeColumn: undefined }), 1);
  assert.equal(chooseColumn({ ...base, setting: "sameGroup", activeColumn: undefined, background: true }), COLUMN_ACTIVE);
});

test("parsePlacement accepts the two values and defaults to beside", () => {
  assert.equal(parsePlacement("sameGroup"), "sameGroup");
  assert.equal(parsePlacement("beside"), "beside");
  assert.equal(parsePlacement("other"), "beside");
  assert.equal(parsePlacement(undefined), "beside");
});
