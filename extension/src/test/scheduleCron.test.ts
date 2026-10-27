// Unit tests for the 5-field cron parser and forward next-fire search. Instants use
// the local-time constructor because cron fires on local wall-clock time.

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCron, nextCron, matchesCronDay } from "../exec/scheduleCron";

function at(y: number, mo: number, d: number, h: number, mi: number, s = 0): number {
  return new Date(y, mo - 1, d, h, mi, s, 0).getTime();
}

test("parseCron expands lists, ranges and steps into value sets", () => {
  const p = parseCron("0,30 9-11 */10 * *");
  assert.ok(p);
  assert.deepEqual([...p.minute.values], [0, 30]);
  assert.deepEqual([...p.hour.values], [9, 10, 11]);
  assert.deepEqual([...p.dom.values], [1, 11, 21, 31]);
  assert.equal(p.month.all, true);
  assert.equal(p.month.values.size, 12);
});

test("parseCron treats a bare value with a step as value..max", () => {
  const p = parseCron("10/20 * * * *");
  assert.deepEqual([...p!.minute.values], [10, 30, 50]);
});

test("parseCron accepts month and weekday names case-insensitively", () => {
  const p = parseCron("0 0 * JAN-MAR Mon,fri");
  assert.deepEqual([...p!.month.values], [1, 2, 3]);
  assert.deepEqual([...p!.dow.values], [1, 5]);
});

test("parseCron folds day-of-week 7 onto Sunday (0)", () => {
  const p = parseCron("0 0 * * 7");
  assert.deepEqual([...p!.dow.values], [0]);
});

test("parseCron collapses extra whitespace between fields", () => {
  assert.ok(parseCron("  5   4  *  *   *  "));
});

test("parseCron rejects out-of-range values", () => {
  assert.equal(parseCron("60 * * * *"), undefined);
  assert.equal(parseCron("* 24 * * *"), undefined);
  assert.equal(parseCron("* * 0 * *"), undefined);
  assert.equal(parseCron("* * 32 * *"), undefined);
  assert.equal(parseCron("* * * 13 *"), undefined);
  assert.equal(parseCron("* * * * 8"), undefined);
});

test("parseCron rejects malformed tokens", () => {
  assert.equal(parseCron("*/0 * * * *"), undefined);
  assert.equal(parseCron("*/x * * * *"), undefined);
  assert.equal(parseCron("5-1 * * * *"), undefined);
  assert.equal(parseCron("1-2-3 * * * *"), undefined);
  assert.equal(parseCron("1/2/3 * * * *"), undefined);
  assert.equal(parseCron("a * * * *"), undefined);
  assert.equal(parseCron("1,,2 * * * *"), undefined);
  assert.equal(parseCron("", ), undefined);
});

test("matchesCronDay uses the OR rule when both day fields are restricted", () => {
  // 15th of the month OR any Monday.
  const p = parseCron("0 0 15 * 1")!;
  assert.equal(matchesCronDay(p, new Date(2026, 5, 15)), true); // Mon Jun 15? either way dom hits
  assert.equal(matchesCronDay(p, new Date(2026, 5, 22)), true); // Monday only
  assert.equal(matchesCronDay(p, new Date(2026, 5, 23)), false); // Tuesday, not the 15th
});

test("matchesCronDay constrains by the only restricted field", () => {
  assert.equal(matchesCronDay(parseCron("0 0 10 * *")!, new Date(2026, 5, 10)), true);
  assert.equal(matchesCronDay(parseCron("0 0 10 * *")!, new Date(2026, 5, 11)), false);
  assert.equal(matchesCronDay(parseCron("0 0 * * 0")!, new Date(2026, 5, 28)), true); // Sunday
  assert.equal(matchesCronDay(parseCron("0 0 * * 0")!, new Date(2026, 5, 29)), false);
  assert.equal(matchesCronDay(parseCron("0 0 * * *")!, new Date(2026, 5, 29)), true);
});

test("nextCron returns the current minute when it matches (reopen catch-up)", () => {
  assert.equal(nextCron("0 9 * * *", at(2026, 6, 25, 9, 0, 30)), at(2026, 6, 25, 9, 0));
});

test("nextCron skips the current minute when lastRun already fired in it", () => {
  const now = at(2026, 6, 25, 9, 0, 30);
  const last = at(2026, 6, 25, 9, 0, 5);
  assert.equal(nextCron("0 9 * * *", now, last), at(2026, 6, 26, 9, 0));
});

test("nextCron rolls to the next day when today's slot has passed", () => {
  assert.equal(nextCron("30 8 * * *", at(2026, 6, 25, 9, 0)), at(2026, 6, 26, 8, 30));
});

test("nextCron honors a weekday window", () => {
  // Thu Jun 25 2026 17:00 -> next weekday 09:00 is Fri Jun 26.
  assert.equal(nextCron("0 9 * * 1-5", at(2026, 6, 25, 17, 0)), at(2026, 6, 26, 9, 0));
  // Fri evening -> Monday Jun 29.
  assert.equal(nextCron("0 9 * * 1-5", at(2026, 6, 26, 17, 0)), at(2026, 6, 29, 9, 0));
});

test("nextCron steps minutes within the hour", () => {
  assert.equal(nextCron("*/15 * * * *", at(2026, 6, 25, 10, 16)), at(2026, 6, 25, 10, 30));
});

test("nextCron finds a Feb 29 slot across years", () => {
  assert.equal(nextCron("0 0 29 2 *", at(2026, 3, 1, 0, 0)), at(2028, 2, 29, 0, 0));
});

test("nextCron returns undefined for an impossible date or malformed input", () => {
  assert.equal(nextCron("0 0 30 2 *", at(2026, 1, 1, 0, 0)), undefined);
  assert.equal(nextCron("nonsense", at(2026, 1, 1, 0, 0)), undefined);
});
