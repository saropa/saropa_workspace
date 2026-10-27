// Unit tests for the "most recent slot at or before now" helpers that detect a
// missed schedule fire on reopen.

import { test } from "node:test";
import assert from "node:assert/strict";
import { prevDailyTime, prevInterval, prevCron } from "../exec/scheduleMissed";

function at(y: number, mo: number, d: number, h: number, mi: number, s = 0): number {
  return new Date(y, mo - 1, d, h, mi, s, 0).getTime();
}

// Thu Jun 25 2026.
test("prevDailyTime returns today's slot once it has passed", () => {
  assert.equal(prevDailyTime("09:00", at(2026, 6, 25, 10, 0), undefined), at(2026, 6, 25, 9, 0));
});

test("prevDailyTime falls back to yesterday before today's slot", () => {
  assert.equal(prevDailyTime("09:00", at(2026, 6, 25, 8, 0), undefined), at(2026, 6, 24, 9, 0));
});

test("prevDailyTime treats an empty weekday list as every day", () => {
  assert.equal(prevDailyTime("09:00", at(2026, 6, 25, 10, 0), []), at(2026, 6, 25, 9, 0));
});

test("prevDailyTime skips disallowed weekdays", () => {
  // Only Mondays (1): from Thu Jun 25 the last Monday slot is Jun 22.
  assert.equal(prevDailyTime("09:00", at(2026, 6, 25, 10, 0), [1]), at(2026, 6, 22, 9, 0));
});

test("prevDailyTime returns undefined for an unparseable time", () => {
  assert.equal(prevDailyTime("nope", at(2026, 6, 25, 10, 0), undefined), undefined);
});

test("prevInterval has no anchor without a previous run", () => {
  assert.equal(prevInterval(60_000, 1_000_000, undefined), undefined);
});

test("prevInterval is undefined when less than one period elapsed", () => {
  assert.equal(prevInterval(60_000, 1_050_000, 1_000_000), undefined);
});

test("prevInterval returns the latest boundary aligned to lastRun", () => {
  assert.equal(prevInterval(60_000, 1_000_000 + 3 * 60_000 + 5_000, 1_000_000), 1_000_000 + 3 * 60_000);
  assert.equal(prevInterval(60_000, 1_000_000 + 60_000, 1_000_000), 1_000_000 + 60_000);
});

test("prevCron returns the current minute when it matches", () => {
  assert.equal(prevCron("0 9 * * *", at(2026, 6, 25, 9, 0, 30)), at(2026, 6, 25, 9, 0));
});

test("prevCron walks back to the previous day", () => {
  assert.equal(prevCron("30 8 * * *", at(2026, 6, 25, 8, 0)), at(2026, 6, 24, 8, 30));
});

test("prevCron walks back over a weekend for a weekday schedule", () => {
  // Mon Jun 29 2026 07:00, weekday 09:00 slot -> Fri Jun 26.
  assert.equal(prevCron("0 9 * * 1-5", at(2026, 6, 29, 7, 0)), at(2026, 6, 26, 9, 0));
});

test("prevCron walks back across months", () => {
  assert.equal(prevCron("0 12 1 3 *", at(2026, 6, 25, 0, 0)), at(2026, 3, 1, 12, 0));
});

test("prevCron returns undefined for malformed or impossible expressions", () => {
  assert.equal(prevCron("bad", at(2026, 6, 25, 0, 0)), undefined);
  assert.equal(prevCron("0 0 30 2 *", at(2026, 6, 25, 0, 0)), undefined);
});
