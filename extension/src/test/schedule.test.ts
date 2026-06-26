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
import { parseCron, nextCron, nextOccurrence } from "../exec/schedule";

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
