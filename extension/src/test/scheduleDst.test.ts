// DST-boundary tests for the schedule math. The daily-slot builder uses local
// setHours/setDate (atLocalTimeWithOffset) specifically so a wall-clock HH:mm is
// preserved across a daylight-saving transition rather than drifting an hour — a
// flat +N*86_400_000ms would drift, because a spring-forward day is 23h and a
// fall-back day is 25h. These run in a fixed DST-observing timezone so the
// assertions are deterministic regardless of the host's own timezone.
//
// node --test isolates each test file in its own process (verified), so setting TZ
// here cannot affect the other suites. It is set before any Date is constructed.
process.env.TZ = "America/New_York";

import { test } from "node:test";
import assert from "node:assert/strict";
import { nextOccurrence, nextCron } from "../exec/schedule";

// Local-time instant (TZ is America/New_York for this file). Month is 1-based.
function at(y: number, mo: number, d: number, h: number, mi: number): number {
  return new Date(y, mo - 1, d, h, mi, 0, 0).getTime();
}

const daily9 = { enabled: true as const, atTime: "09:00" };

test("spring forward: a daily 09:00 slot stays at 09:00 wall-clock", () => {
  // US 2026 spring-forward is Sun Mar 8 (02:00 -> 03:00; the day is 23h long). From
  // Sat Mar 7 09:30, the next 09:00 slot is Sun Mar 8 09:00 — NOT 10:00, which a
  // flat +24h would give by overshooting the 23-hour day.
  const next = nextOccurrence(daily9, at(2026, 3, 7, 9, 30));
  assert.notEqual(next, undefined);
  const fire = new Date(next as number);
  assert.equal(fire.getMonth(), 2); // March (0-based)
  assert.equal(fire.getDate(), 8);
  assert.equal(fire.getHours(), 9);
});

test("fall back: a daily 09:00 slot stays at 09:00 wall-clock", () => {
  // US 2026 fall-back is Sun Nov 1 (02:00 -> 01:00; the day is 25h long). From Sat
  // Oct 31 09:30, the next 09:00 slot is Sun Nov 1 09:00 — NOT 08:00, which a flat
  // +24h would give by undershooting the 25-hour day.
  const next = nextOccurrence(daily9, at(2026, 10, 31, 9, 30));
  assert.notEqual(next, undefined);
  const fire = new Date(next as number);
  assert.equal(fire.getMonth(), 10); // November
  assert.equal(fire.getDate(), 1);
  assert.equal(fire.getHours(), 9);
});

test("the spring-forward fire is exactly 23 hours after the prior 09:00", () => {
  // The wall-clock is preserved precisely because the calendar day lost an hour:
  // Sat Mar 7 09:00 EST -> Sun Mar 8 09:00 EDT is 23 real hours, not 24.
  const next = nextOccurrence(daily9, at(2026, 3, 7, 9, 30)) as number;
  assert.equal(next - at(2026, 3, 7, 9, 0), 23 * 60 * 60_000);
});

test("cron daily 09:00 also preserves wall-clock across spring forward", () => {
  const next = nextCron("0 9 * * *", at(2026, 3, 7, 9, 30));
  assert.notEqual(next, undefined);
  const fire = new Date(next as number);
  assert.equal(fire.getDate(), 8);
  assert.equal(fire.getHours(), 9);
});
