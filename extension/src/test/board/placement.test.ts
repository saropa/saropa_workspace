// Board placement: the editor column the Release Board tab opens in, and how the placement setting
// is read. Covers the column sentinels, the stored-column boundaries and every window-start branch.

import { test } from "node:test";
import assert from "node:assert/strict";
import { COLUMN_ACTIVE, COLUMN_BESIDE, PlacementInput, chooseColumn, parsePlacement } from "../../board/placement";

// A foreground open with one group, an active editor in column 1 and nothing stored.
const base: PlacementInput = { setting: "beside", stored: undefined, groupCount: 1, activeColumn: 1, background: false };

test("the column sentinels are the editor's Active and Beside numbers and never a real column", () => {
  // These must equal vscode.ViewColumn.Active and Beside, and stay negative so a real column (1 and up) never matches.
  assert.equal(COLUMN_ACTIVE, -1);
  assert.equal(COLUMN_BESIDE, -2);
});

test("parsePlacement reads sameGroup and treats every other value as beside", () => {
  assert.equal(parsePlacement("sameGroup"), "sameGroup");
  assert.equal(parsePlacement("beside"), "beside");
  // An unknown, wrongly cased or mistyped value must fall back to the default rather than throw or pass through.
  for (const v of [undefined, null, "", "SAMEGROUP", "same", 1, true, {}]) {
    assert.equal(parsePlacement(v), "beside");
  }
});

test("a stored column equal to the last group or one past it is reused, and two past is not", () => {
  const input = { ...base, groupCount: 5 };
  assert.equal(chooseColumn({ ...input, stored: 5 }), 5);
  // One past the last group is the single new group the editor would create beside it.
  assert.equal(chooseColumn({ ...input, stored: 6 }), 6);
  assert.equal(chooseColumn({ ...input, stored: 7 }), COLUMN_BESIDE);
});

test("a group count of zero is treated as one group when judging a stored column", () => {
  // The upper bound is max(1, count) + 1, so 2 is the largest usable column even with no groups reported.
  assert.equal(chooseColumn({ ...base, groupCount: 0, stored: 2 }), 2);
  assert.equal(chooseColumn({ ...base, groupCount: 0, stored: 3 }), COLUMN_BESIDE);
});

test("a stored column that is not a positive whole number is ignored", () => {
  for (const stored of [0, -1, -2, 1.5, Infinity, NaN, "1", true, [], null]) {
    assert.equal(chooseColumn({ ...base, groupCount: 3, stored }), COLUMN_BESIDE, `stored ${String(stored)}`);
  }
});

test("beside in the foreground reuses a valid stored column even when nothing is open", () => {
  // Only a window-start open (background) distrusts the stored column; a foreground open honors it.
  assert.equal(chooseColumn({ ...base, activeColumn: undefined, groupCount: 2, stored: 2 }), 2);
});

test("beside with nothing stored opens beside an editor, or in the active group when nothing is open", () => {
  assert.equal(chooseColumn(base), COLUMN_BESIDE);
  assert.equal(chooseColumn({ ...base, activeColumn: undefined }), COLUMN_ACTIVE);
});

test("beside at window start with nothing open and at most one group ignores the stored column", () => {
  // A stored column 2 would open a second group and leave an empty group 1 behind it.
  const start = { ...base, background: true, activeColumn: undefined, stored: 2 };
  assert.equal(chooseColumn({ ...start, groupCount: 1 }), COLUMN_ACTIVE);
  assert.equal(chooseColumn({ ...start, groupCount: 0 }), COLUMN_ACTIVE);
  // With two groups the second already exists, so the stored column is safe to reuse.
  assert.equal(chooseColumn({ ...start, groupCount: 2 }), 2);
});

test("beside at window start with nothing open and an unusable stored column opens in the active group", () => {
  assert.equal(chooseColumn({ ...base, background: true, activeColumn: undefined, groupCount: 3, stored: 99 }), COLUMN_ACTIVE);
});

test("sameGroup in the foreground follows the active editor and ignores the stored column", () => {
  assert.equal(chooseColumn({ ...base, setting: "sameGroup", activeColumn: 3, groupCount: 3, stored: 1 }), 3);
});

test("sameGroup in the foreground with nothing open falls back to column 1", () => {
  assert.equal(chooseColumn({ ...base, setting: "sameGroup", activeColumn: undefined, stored: 2, groupCount: 2 }), 1);
});

test("sameGroup at window start opens beside an open editor so no file is covered, else in the active group", () => {
  assert.equal(chooseColumn({ ...base, setting: "sameGroup", background: true }), COLUMN_BESIDE);
  assert.equal(chooseColumn({ ...base, setting: "sameGroup", background: true, activeColumn: undefined }), COLUMN_ACTIVE);
});
