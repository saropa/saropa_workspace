// Unit tests for the shared schedule-edit model (scheduleModel.ts) — the UI-agnostic
// normalize / auto-enable / has-timing logic that BOTH the QuickPick wizard and the
// webview form route through, so the two surfaces can never diverge. These functions
// carry no VS Code dependency (they import only the PinSchedule type), so they run
// under Node's built-in runner without the extension host.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  WorkSchedule,
  workFromSchedule,
  hasTiming,
  applyAutoEnable,
  normalizeWork,
} from "../commands/scheduleModel";

// A blank-but-enabled working copy, the shape the editors start a new schedule from.
function blank(): WorkSchedule {
  return { enabled: true };
}

test("hasTiming is true for any timing source and false for none", () => {
  assert.equal(hasTiming({ enabled: true }), false);
  assert.equal(hasTiming({ enabled: false }), false);
  assert.equal(hasTiming({ enabled: true, atTime: "05:00" }), true);
  assert.equal(hasTiming({ enabled: true, everyMs: 60_000 }), true);
  assert.equal(hasTiming({ enabled: true, cron: "0 9 * * *" }), true);
  assert.equal(hasTiming({ enabled: true, runOnStartup: true }), true);
});

test("workFromSchedule defaults a missing schedule to blank-but-enabled", () => {
  const work = workFromSchedule(undefined);
  assert.equal(work.enabled, true);
  assert.equal(work.atTime, undefined);
  assert.equal(work.everyMs, undefined);
  assert.equal(work.days, undefined);
});

test("workFromSchedule copies the day array so edits do not mutate the stored pin", () => {
  const stored = {
    atTime: "05:00",
    days: [1, 2, 3],
    enabled: true,
  };
  const work = workFromSchedule(stored);
  assert.deepEqual(work.days, [1, 2, 3]);
  work.days?.push(4);
  // The source array must be untouched — a shared reference would corrupt the pin.
  assert.deepEqual(stored.days, [1, 2, 3]);
});

test("applyAutoEnable turns on a disabled schedule that has timing", () => {
  const work: WorkSchedule = { enabled: false, atTime: "05:00" };
  applyAutoEnable(work, false);
  assert.equal(work.enabled, true);
});

test("applyAutoEnable is suppressed once the user has touched the Enabled toggle", () => {
  const work: WorkSchedule = { enabled: false, atTime: "05:00" };
  applyAutoEnable(work, true);
  // A deliberate disable stands — setting a time must not re-enable behind the user.
  assert.equal(work.enabled, false);
});

test("applyAutoEnable does nothing without timing or when already enabled", () => {
  const empty: WorkSchedule = { enabled: false };
  applyAutoEnable(empty, false);
  assert.equal(empty.enabled, false);

  const already: WorkSchedule = { enabled: true, atTime: "05:00" };
  applyAutoEnable(already, false);
  assert.equal(already.enabled, true);
});

test("normalizeWork collapses a timing-less schedule to undefined", () => {
  assert.equal(normalizeWork(blank()), undefined);
  // An enabled flag alone arms nothing, so it must not produce a stored object.
  assert.equal(normalizeWork({ enabled: false }), undefined);
});

test("normalizeWork keeps a startup-only schedule (run-on-open is a timing source)", () => {
  const schedule = normalizeWork({ enabled: true, runOnStartup: true });
  assert.ok(schedule);
  assert.equal(schedule?.runOnStartup, true);
});

test("normalizeWork drops days when there is no daily time", () => {
  const schedule = normalizeWork({ enabled: true, everyMs: 60_000, days: [1, 2, 3] });
  assert.ok(schedule);
  assert.equal(schedule?.days, undefined);
});

test("normalizeWork drops an empty or all-seven day set (both mean every day)", () => {
  const allSeven = normalizeWork({
    enabled: true,
    atTime: "05:00",
    days: [0, 1, 2, 3, 4, 5, 6],
  });
  assert.equal(allSeven?.days, undefined);

  const none = normalizeWork({ enabled: true, atTime: "05:00", days: [] });
  assert.equal(none?.days, undefined);
});

test("normalizeWork keeps a partial day set, sorted ascending", () => {
  const schedule = normalizeWork({
    enabled: true,
    atTime: "05:00",
    days: [5, 1, 3],
  });
  assert.deepEqual(schedule?.days, [1, 3, 5]);
});

test("normalizeWork stores runOnStartup only when on, and preserves lastRun", () => {
  const off = normalizeWork({ enabled: true, atTime: "05:00", runOnStartup: false });
  assert.equal(off?.runOnStartup, undefined);

  const withStamp = normalizeWork({
    enabled: true,
    atTime: "05:00",
    lastRun: 1_700_000_000_000,
  });
  assert.equal(withStamp?.lastRun, 1_700_000_000_000);
});
