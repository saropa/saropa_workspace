// Unit tests for the pure scheduling math (parseCron / nextCron / nextOccurrence).
// These functions carry NO VS Code dependency by design, so they run under Node's
// built-in test runner without the extension host — the test entry is esbuild-
// bundled to out/test and executed with `node --test` (see the test:unit script).
//
// All instants are built with the local-time constructor so the expectations track
// the same wall-clock semantics the scheduler uses (cron and atTime fire on local
// time, not UTC).

import { test } from "node:test";
import assert from "node:assert/strict";
import { nextOccurrence, mostRecentDue, isMissed } from "../exec/schedule";
import { parseCron, nextCron } from "../exec/scheduleCron";

// Local-time instant for a given Y/M/D H:M (month is 1-based here for readability).
function at(y: number, mo: number, d: number, h: number, mi: number): number {
  return new Date(y, mo - 1, d, h, mi, 0, 0).getTime();
}

// Jun 25 2026 is a Thursday (dow 4) — the anchor most cases build from.
const THU_AUG = at(2026, 6, 25, 8, 0);

test("parseCron accepts a valid 5-field expression", () => {
  assert.ok(parseCron("0 9 * * 1-5"));
});

test("parseCron rejects the wrong field count", () => {
  assert.equal(parseCron("0 9 * *"), undefined);
  assert.equal(parseCron("0 9 * * 1 2"), undefined);
});

test("parseCron rejects out-of-range values", () => {
  assert.equal(parseCron("60 9 * * *"), undefined); // minute 60
  assert.equal(parseCron("0 24 * * *"), undefined); // hour 24
  assert.equal(parseCron("0 0 0 * *"), undefined); // day-of-month 0
  assert.equal(parseCron("0 0 32 * *"), undefined); // day-of-month 32
  assert.equal(parseCron("0 0 1 13 *"), undefined); // month 13
});

test("parseCron rejects a reversed range and pure garbage", () => {
  assert.equal(parseCron("0 0 * * 5-1"), undefined);
  assert.equal(parseCron("a b c d e"), undefined);
});

test("parseCron accepts month/day names, steps, and DOW 7 = Sunday", () => {
  assert.ok(parseCron("0 9 * jan-mar mon-fri"));
  assert.ok(parseCron("*/15 9-17 * * 1-5"));
  assert.ok(parseCron("0 0 * * 7"));
});

test("nextCron: daily 09:00 before the slot fires today", () => {
  assert.equal(nextCron("0 9 * * *", THU_AUG), at(2026, 6, 25, 9, 0));
});

test("nextCron: daily 09:00 after the slot rolls to tomorrow", () => {
  assert.equal(nextCron("0 9 * * *", at(2026, 6, 25, 9, 30)), at(2026, 6, 26, 9, 0));
});

test("nextCron: opening inside the target minute still catches the slot", () => {
  // 09:00:30 — the minute is partly elapsed but has not fired, so it is live.
  assert.equal(nextCron("0 9 * * *", at(2026, 6, 25, 9, 0) + 30_000), at(2026, 6, 25, 9, 0));
});

test("nextCron: a fire already recorded this minute is not repeated", () => {
  const minute = at(2026, 6, 25, 9, 0);
  // lastRun within the same minute -> advance to tomorrow rather than re-fire.
  assert.equal(nextCron("0 9 * * *", minute + 30_000, minute + 5_000), at(2026, 6, 26, 9, 0));
});

test("nextCron: weekday constraint skips the weekend", () => {
  // From Friday Jun 26 10:00, Mon-Fri 09:00 -> Monday Jun 29 09:00.
  assert.equal(nextCron("0 9 * * 1-5", at(2026, 6, 26, 10, 0)), at(2026, 6, 29, 9, 0));
});

test("nextCron: step within work hours", () => {
  assert.equal(nextCron("*/15 9-17 * * 1-5", at(2026, 6, 25, 9, 7)), at(2026, 6, 25, 9, 15));
  // After 17:00 Thursday -> next work day 09:00.
  assert.equal(nextCron("*/15 9-17 * * 1-5", at(2026, 6, 25, 18, 0)), at(2026, 6, 26, 9, 0));
});

test("nextCron: 1st of the month", () => {
  assert.equal(nextCron("0 9 1 * *", at(2026, 6, 25, 9, 0)), at(2026, 7, 1, 9, 0));
});

test("nextCron: day-of-month OR day-of-week (Vixie rule)", () => {
  // "0 0 1 * 1" = the 1st OR any Monday. From Thu Jun 25, next Monday (Jun 29)
  // beats the next 1st (Jul 1).
  assert.equal(nextCron("0 0 1 * 1", at(2026, 6, 25, 1, 0)), at(2026, 6, 29, 0, 0));
});

test("nextCron: hourly on the hour", () => {
  assert.equal(nextCron("0 * * * *", at(2026, 6, 25, 9, 30)), at(2026, 6, 25, 10, 0));
});

test("nextCron: an impossible date returns undefined", () => {
  // Feb 30 never occurs -> no fire within the search horizon.
  assert.equal(nextCron("0 0 30 2 *", at(2026, 1, 1, 0, 0)), undefined);
});

test("nextCron: a malformed expression returns undefined", () => {
  assert.equal(nextCron("nope", THU_AUG), undefined);
});

test("nextOccurrence picks the earliest of cron and interval", () => {
  // cron 09:00, interval +30m from 08:00 = 08:30 -> interval wins.
  assert.equal(
    nextOccurrence({ enabled: true, cron: "0 9 * * *", everyMs: 30 * 60_000 }, THU_AUG),
    THU_AUG + 30 * 60_000
  );
  // From 08:50 the interval lands 09:20, so cron 09:00 wins.
  assert.equal(
    nextOccurrence(
      { enabled: true, cron: "0 9 * * *", everyMs: 30 * 60_000 },
      at(2026, 6, 25, 8, 50)
    ),
    at(2026, 6, 25, 9, 0)
  );
});

test("nextOccurrence returns undefined for a disabled schedule", () => {
  assert.equal(nextOccurrence({ enabled: false, cron: "0 9 * * *" }, THU_AUG), undefined);
});

test("nextOccurrence returns undefined when no timing field is set", () => {
  // A startup-only schedule has no time-based slot — it fires via runStartupShortcuts,
  // not nextOccurrence.
  assert.equal(nextOccurrence({ enabled: true, runOnStartup: true }, THU_AUG), undefined);
});

// --- mostRecentDue / isMissed (backward search for missed runs) --------------

test("mostRecentDue: daily slot earlier today is the most recent due", () => {
  // At 08:00 Thu, a 07:00 daily slot elapsed at 07:00 today.
  assert.equal(
    mostRecentDue({ enabled: true, atTime: "07:00" }, THU_AUG),
    at(2026, 6, 25, 7, 0)
  );
});

test("mostRecentDue: daily slot still ahead today rolls to yesterday", () => {
  // At 08:00 Thu, a 09:00 daily slot has not happened today; the most recent past
  // slot is yesterday 09:00.
  assert.equal(
    mostRecentDue({ enabled: true, atTime: "09:00" }, THU_AUG),
    at(2026, 6, 24, 9, 0)
  );
});

test("mostRecentDue: weekday list resolves to the last allowed day", () => {
  // Mon-Fri 09:00 from Sunday Jun 28 10:00 -> the most recent slot is Friday Jun 26.
  assert.equal(
    mostRecentDue({ enabled: true, atTime: "09:00", days: [1, 2, 3, 4, 5] }, at(2026, 6, 28, 10, 0)),
    at(2026, 6, 26, 9, 0)
  );
});

test("mostRecentDue: interval boundary aligns to lastRun", () => {
  // lastRun 06:00, every 30m, now 08:10 -> last boundary at 08:00 (4 periods).
  const lastRun = at(2026, 6, 25, 6, 0);
  assert.equal(
    mostRecentDue({ enabled: true, everyMs: 30 * 60_000, lastRun }, at(2026, 6, 25, 8, 10)),
    at(2026, 6, 25, 8, 0)
  );
});

test("mostRecentDue: interval with no prior fire has no missed boundary", () => {
  // An unfired interval has no anchor, so nothing is due in the past.
  assert.equal(mostRecentDue({ enabled: true, everyMs: 30 * 60_000 }, THU_AUG), undefined);
});

test("mostRecentDue: cron matches the current minute as a live candidate", () => {
  // 09:00:30 with a 09:00 cron -> the just-elapsed 09:00 minute is the most recent.
  assert.equal(
    mostRecentDue({ enabled: true, cron: "0 9 * * *" }, at(2026, 6, 25, 9, 0) + 30_000),
    at(2026, 6, 25, 9, 0)
  );
});

test("mostRecentDue: disabled schedule and no-timing schedule return undefined", () => {
  assert.equal(mostRecentDue({ enabled: false, atTime: "07:00" }, THU_AUG), undefined);
  assert.equal(mostRecentDue({ enabled: true, runOnStartup: true }, THU_AUG), undefined);
});

test("isMissed: a past slot after a stale lastRun is missed", () => {
  // 07:00 daily, lastRun was yesterday -> today's 07:00 slot was missed.
  const schedule = { enabled: true, atTime: "07:00", lastRun: at(2026, 6, 24, 7, 0) };
  assert.equal(isMissed(schedule, THU_AUG), true);
});

test("isMissed: a fire recorded after the last slot is not missed", () => {
  // 07:00 daily, lastRun 07:00 today -> the most recent slot already fired.
  const schedule = { enabled: true, atTime: "07:00", lastRun: at(2026, 6, 25, 7, 0) };
  assert.equal(isMissed(schedule, THU_AUG), false);
});

test("isMissed: same-minute reopen dedup is not counted as missed", () => {
  // Fired at 09:00:05; reopened at 09:00:30. The 09:00 slot is not later than lastRun.
  const minute = at(2026, 6, 25, 9, 0);
  const schedule = { enabled: true, cron: "0 9 * * *", lastRun: minute + 5_000 };
  assert.equal(isMissed(schedule, minute + 30_000), false);
});

test("isMissed: a never-fired past-due schedule reads as missed", () => {
  // No lastRun, 07:00 slot already elapsed today -> catch-up candidate.
  assert.equal(isMissed({ enabled: true, atTime: "07:00" }, THU_AUG), true);
});
