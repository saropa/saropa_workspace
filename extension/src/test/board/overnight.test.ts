import { test } from "node:test";
import assert from "node:assert/strict";
import { asOvernight, dayKey, dueDay, openWindowDay, parseClock, planSteps, showOffer } from "../../board/overnight";

const at = (y: number, mo: number, d: number, h: number, mi = 0): Date => new Date(y, mo - 1, d, h, mi);

test("clock parsing accepts HH:MM only", () => {
  assert.equal(parseClock("02:00"), 120);
  assert.equal(parseClock("2:05"), 125);
  assert.equal(parseClock("23:59"), 1439);
  for (const bad of ["24:00", "02:60", "2", "", "02:00pm", undefined, 5]) {
    assert.equal(parseClock(bad), undefined);
  }
});

test("off by default and for any value that is not exactly true", () => {
  assert.equal(asOvernight({}).enabled, false);
  assert.equal(asOvernight({ enabled: "true" }).enabled, false);
  assert.equal(asOvernight({ enabled: true }).enabled, true);
});

test("bad settings fall back to defaults and are bounded", () => {
  const c = asOvernight({ enabled: true, startTime: "nope", windowHours: 99, stepTimeoutMinutes: 0 });
  assert.equal(c.startMinutes, 120);
  assert.equal(c.windowMinutes, 360);
  assert.equal(c.stepTimeoutMs, 5 * 60000);
  assert.equal(asOvernight({ windowHours: "x", stepTimeoutMinutes: null }).windowMinutes, 180);
});

test("window is open from the start time for its length", () => {
  const c = asOvernight({ enabled: true, startTime: "02:00", windowHours: 3 });
  assert.equal(openWindowDay(at(2026, 10, 27, 1, 59), c), undefined);
  assert.equal(openWindowDay(at(2026, 10, 27, 2, 0), c), "2026-10-27");
  assert.equal(openWindowDay(at(2026, 10, 27, 4, 59), c), "2026-10-27");
  assert.equal(openWindowDay(at(2026, 10, 27, 5, 0), c), undefined);
});

test("a window across midnight belongs to the day it opened", () => {
  const c = asOvernight({ enabled: true, startTime: "23:00", windowHours: 3 });
  assert.equal(openWindowDay(at(2026, 10, 27, 23, 30), c), "2026-10-27");
  assert.equal(openWindowDay(at(2026, 10, 28, 1, 30), c), "2026-10-27");
  assert.equal(openWindowDay(at(2026, 10, 28, 2, 0), c), undefined);
  assert.equal(openWindowDay(at(2026, 11, 1, 0, 30), c), "2026-10-31");
});

test("a run is due once per window day, never when off", () => {
  const on = asOvernight({ enabled: true });
  const now = at(2026, 10, 27, 3);
  assert.equal(dueDay(now, on, undefined), "2026-10-27");
  assert.equal(dueDay(now, on, "2026-10-26"), "2026-10-27");
  assert.equal(dueDay(now, on, "2026-10-27"), undefined);
  assert.equal(dueDay(now, asOvernight({ enabled: false }), undefined), undefined);
  assert.equal(dueDay(at(2026, 10, 27, 12), on, undefined), undefined);
});

test("steps go one project at a time, lint before tests, skipping what is not named", () => {
  const steps = planSteps([
    { id: "a", canLint: true, canTests: true },
    { id: "b", canLint: false, canTests: false },
    { id: "c", canLint: false, canTests: true },
  ]);
  assert.deepEqual(steps, [
    { projectId: "a", kind: "lint" },
    { projectId: "a", kind: "tests" },
    { projectId: "c", kind: "tests" },
  ]);
});

test("the offer shows only while off and not dismissed", () => {
  assert.equal(showOffer({ enabled: false }, false), true);
  assert.equal(showOffer({ enabled: false }, true), false);
  assert.equal(showOffer({ enabled: true }, false), false);
});

test("day key is the local date", () => {
  assert.equal(dayKey(at(2026, 1, 5, 0, 1)), "2026-01-05");
});
