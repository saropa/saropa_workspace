// Covers the adaptive layout: the size band of a document count (with its downward hysteresis), the MAX clamp and
// hold, the per-band layout table, and which top-level groups open on first view (with remembered user choices).

import { test } from "node:test";
import assert from "node:assert/strict";
import { bandFor, layoutFor, maxFor, openGroups } from "../../../board/org/layout";

test("bandFor: counts map to bands at the 8, 50, 200 and 1000 boundaries", () => {
  assert.equal(bandFor(0), 0);
  assert.equal(bandFor(7), 0);
  // A band starts exactly on its boundary.
  assert.equal(bandFor(8), 1);
  assert.equal(bandFor(49), 1);
  assert.equal(bandFor(50), 2);
  assert.equal(bandFor(199), 2);
  assert.equal(bandFor(200), 3);
  assert.equal(bandFor(999), 3);
  assert.equal(bandFor(1000), 4);
});

test("bandFor: a band drops only once the count is more than 10 percent below its boundary", () => {
  // 45 is exactly 90 percent of 50, so the previous band is kept.
  assert.equal(bandFor(45, 2), 2);
  // 44 is below the 90 percent line, so it falls to the raw band.
  assert.equal(bandFor(44, 2), 1);
});

test("bandFor: a rise is immediate whatever the previous band was", () => {
  assert.equal(bandFor(50, 1), 2);
  // No previous band means no hysteresis at all.
  assert.equal(bandFor(45, undefined), 1);
});

test("maxFor: the raw value is twice the square root, clamped to 8..40", () => {
  assert.equal(maxFor(0), 8);
  // 2 * sqrt(16) = 8, the floor.
  assert.equal(maxFor(16), 8);
  assert.equal(maxFor(36), 12);
  assert.equal(maxFor(100), 20);
  assert.equal(maxFor(400), 40);
  // Far above the ceiling stays at 40.
  assert.equal(maxFor(10000), 40);
});

test("maxFor: the previous value is kept while the new one is within 10 percent (at least 1) of it", () => {
  // Raw for 110 is 21, one away from 20 and inside the 2-wide window.
  assert.equal(maxFor(110, 20), 20);
  // Raw for 144 is 24, four away: outside the window, so the new value wins.
  assert.equal(maxFor(144, 20), 24);
  // At the small end the window is never narrower than 1: raw 9 against previous 8.
  assert.equal(maxFor(21, 8), 8);
});

test("layoutFor: a handful of documents has no headers, shows everything and folds nothing", () => {
  const l = layoutFor(5);
  assert.equal(l.band, 0);
  // Group headers are not worth showing for so few documents.
  assert.equal(l.headers, false);
  assert.equal(l.min, 2);
  assert.equal(l.max, 8);
  assert.equal(l.levels, 1);
  assert.equal(l.rowLimit, null);
  assert.equal(l.open.all, true);
  assert.equal(l.finished, "all");
  assert.deepEqual(l.suggestions, { minConfidence: "low", page: null });
  // Nothing folds, so there is nothing to explain.
  assert.equal(l.foldWhy, undefined);
});

test("layoutFor: each band sets its row limit, finished-row mode and fold explanation", () => {
  const b1 = layoutFor(10);
  assert.equal(b1.band, 1);
  assert.equal(b1.headers, true);
  assert.equal(b1.rowLimit, 8);
  assert.equal(b1.open.allWhenAtMost, 3);
  assert.deepEqual(b1.foldWhy, { key: "releaseBoard.org.why.folded", params: { count: 10 } });

  const b2 = layoutFor(100);
  assert.equal(b2.min, 3);
  assert.equal(b2.rowLimit, 5);
  assert.equal(b2.finished, "last2");
  assert.equal(b2.open.maxWithBlockers, 3);
  assert.equal(b2.levels, 1);

  const b3 = layoutFor(300);
  assert.equal(b3.min, 4);
  // A second group level starts at 200 documents.
  assert.equal(b3.levels, 2);
  assert.equal(b3.finished, "count");
  assert.equal(b3.rowLimit, 5);

  const b4 = layoutFor(2000);
  assert.equal(b4.min, 5);
  assert.equal(b4.rowLimit, 3);
  assert.equal(b4.suggestions.minConfidence, "high");
  assert.equal(b4.max, 40);
});

test("layoutFor: the previous band and max keep the layout steady near a boundary", () => {
  // 45 documents would be band 1; the previous band 2 holds it, so the band-2 table applies.
  const l = layoutFor(45, 2, 13);
  assert.equal(l.band, 2);
  assert.equal(l.rowLimit, 5);
  // Raw max for 45 is 13 (2 * 6.7); the previous 13 is kept.
  assert.equal(l.max, 13);
});

const g = (id: string, blockers: number): { id: string; blockers: number } => ({ id, blockers });

test("openGroups: a small board opens every group", () => {
  const open = openGroups(layoutFor(5), [g("a", 0), g("b", 0)]);
  assert.deepEqual([...open].sort(), ["a", "b"]);
});

test("openGroups: no groups gives an empty set", () => {
  assert.equal(openGroups(layoutFor(100), []).size, 0);
});

test("openGroups: at or under the allWhenAtMost count every group opens, even without blockers", () => {
  // Band 1 opens all when there are 3 groups or fewer.
  const open = openGroups(layoutFor(10), [g("a", 0), g("b", 0), g("c", 0)]);
  assert.equal(open.size, 3);
});

test("openGroups: above that only groups with blockers open, with no cap in band 1", () => {
  const open = openGroups(layoutFor(10), [g("a", 0), g("b", 2), g("c", 1), g("d", 0), g("e", 4)]);
  assert.deepEqual([...open].sort(), ["b", "c", "e"]);
});

test("openGroups: band 2 caps the open groups at three, most blockers first", () => {
  const open = openGroups(layoutFor(100), [g("a", 1), g("b", 5), g("c", 4), g("d", 3), g("e", 2)]);
  assert.deepEqual([...open].sort(), ["b", "c", "d"]);
});

test("openGroups: equal blocker counts are cut by id so the choice never depends on input order", () => {
  const groups = [g("z", 2), g("y", 2), g("x", 2), g("w", 2)];
  const forward = openGroups(layoutFor(100), groups);
  const backward = openGroups(layoutFor(100), [...groups].reverse());
  assert.deepEqual([...forward].sort(), ["w", "x", "y"]);
  assert.deepEqual([...backward].sort(), ["w", "x", "y"]);
});

test("openGroups: a remembered choice beats the automatic one in both directions", () => {
  const groups = [g("a", 0), g("b", 3), g("c", 0), g("d", 0), g("e", 0)];
  // b would open by blockers (the user closed it); c would stay closed (the user opened it).
  const remembered = new Map<string, boolean>([["b", false], ["c", true], ["gone", true]]);
  const open = openGroups(layoutFor(10), groups, remembered);
  assert.deepEqual([...open].sort(), ["c"]);
  // An id that names no current group is ignored rather than opened.
  assert.equal(open.has("gone"), false);
});
