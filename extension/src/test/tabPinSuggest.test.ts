// Unit tests for the long-pinned-tab suggester's pure reconcile core
// (reconcileTabPins). The threshold / snapshot / dismiss logic is the bug-prone
// part, so it is extracted from the VS Code-host-dependent class and tested here
// with plain data — no editor, no timers, no globalState. The suggester class
// itself (tab enumeration, toasts, persistence) needs the extension host and is
// out of scope for node --test until that harness exists.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  reconcileTabPins,
  TabPinState,
} from "../views/tabPinSuggestions";

const HOUR = 60 * 60 * 1000;
const THRESHOLD = 2 * HOUR;
const NONE = (): boolean => false; // no file is already a Saropa pin

function emptyState(): TabPinState {
  return { firstPinnedAt: {}, dismissed: [] };
}

test("a first sighting is stamped with now and offers nothing yet", () => {
  const r = reconcileTabPins(emptyState(), new Set(["a.ts"]), NONE, 1000, THRESHOLD);
  assert.equal(r.changed, true);
  assert.equal(r.state.firstPinnedAt["a.ts"], 1000);
  assert.deepEqual(r.toOffer, []);
});

test("a tab still under the threshold is not offered", () => {
  const state: TabPinState = { firstPinnedAt: { "a.ts": 0 }, dismissed: [] };
  // Only one hour elapsed against a two-hour threshold.
  const r = reconcileTabPins(state, new Set(["a.ts"]), NONE, HOUR, THRESHOLD);
  assert.equal(r.changed, false);
  assert.deepEqual(r.toOffer, []);
});

test("a tab pinned past the threshold is offered", () => {
  const state: TabPinState = { firstPinnedAt: { "a.ts": 0 }, dismissed: [] };
  const r = reconcileTabPins(state, new Set(["a.ts"]), NONE, THRESHOLD, THRESHOLD);
  assert.deepEqual(r.toOffer, ["a.ts"]);
});

test("a dismissed file is never stamped and never offered", () => {
  const state: TabPinState = { firstPinnedAt: {}, dismissed: ["a.ts"] };
  const r = reconcileTabPins(state, new Set(["a.ts"]), NONE, THRESHOLD * 2, THRESHOLD);
  assert.equal(r.state.firstPinnedAt["a.ts"], undefined);
  assert.deepEqual(r.toOffer, []);
  assert.equal(r.changed, false);
});

test("a file already a Saropa pin has its stamp cleared and is not offered", () => {
  const state: TabPinState = { firstPinnedAt: { "a.ts": 0 }, dismissed: [] };
  const r = reconcileTabPins(
    state,
    new Set(["a.ts"]),
    (p) => p === "a.ts", // already pinned in Saropa
    THRESHOLD,
    THRESHOLD
  );
  assert.equal(r.state.firstPinnedAt["a.ts"], undefined);
  assert.equal(r.changed, true);
  assert.deepEqual(r.toOffer, []);
});

test("unpinning a tab drops its stamp so a later re-pin starts fresh", () => {
  const state: TabPinState = { firstPinnedAt: { "a.ts": 0 }, dismissed: [] };
  // The tab is no longer in the pinned set (unpinned or closed).
  const r = reconcileTabPins(state, new Set(), NONE, THRESHOLD, THRESHOLD);
  assert.equal(r.state.firstPinnedAt["a.ts"], undefined);
  assert.equal(r.changed, true);
  assert.deepEqual(r.toOffer, []);
});

test("the input state object is not mutated", () => {
  const state: TabPinState = { firstPinnedAt: { "a.ts": 0 }, dismissed: [] };
  reconcileTabPins(state, new Set(), NONE, THRESHOLD, THRESHOLD);
  // The original stamp survives on the input; only the returned state drops it.
  assert.equal(state.firstPinnedAt["a.ts"], 0);
});

test("a pre-existing pin snapshotted now waits the full threshold (no immediate offer)", () => {
  // Activation snapshot: empty state, tab already pinned, current time large.
  const first = reconcileTabPins(emptyState(), new Set(["a.ts"]), NONE, 10 * HOUR, THRESHOLD);
  assert.equal(first.state.firstPinnedAt["a.ts"], 10 * HOUR);
  assert.deepEqual(first.toOffer, []);
  // One hour later — still under threshold from the snapshot, not the real age.
  const later = reconcileTabPins(first.state, new Set(["a.ts"]), NONE, 11 * HOUR, THRESHOLD);
  assert.deepEqual(later.toOffer, []);
  // Past the snapshot + threshold — now eligible.
  const due = reconcileTabPins(first.state, new Set(["a.ts"]), NONE, 12 * HOUR, THRESHOLD);
  assert.deepEqual(due.toOffer, ["a.ts"]);
});
