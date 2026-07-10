import { parseHourMinute, atLocalTimeWithOffset } from "./schedule";
import { parseCron, matchesCronDay, CRON_SEARCH_LIMIT_MS } from "./scheduleCron";

// Most-recent daily slot at or before `now` honoring the weekday list. Walks
// today..-8 days (a full week plus margin so a single-weekday list always
// resolves) and returns the first allowed slot that is not in the future.
export function prevDailyTime(
  atTime: string,
  now: number,
  days: number[] | undefined
): number | undefined {
  const parsed = parseHourMinute(atTime);
  if (!parsed) {
    return undefined;
  }
  const allowed = days && days.length > 0 ? days : undefined;
  for (let offset = 0; offset >= -8; offset--) {
    const slot = atLocalTimeWithOffset(now, parsed.hour, parsed.minute, offset);
    if (allowed && !allowed.includes(new Date(slot).getDay())) {
      continue;
    }
    if (slot <= now) {
      return slot;
    }
  }
  return undefined;
}

// Most-recent interval boundary at or before `now`, aligned to `lastRun`. Without a
// prior fire an interval has no anchor, so nothing is "missed" (it fires forward
// from its first arming); returns undefined. When fewer than one full period has
// elapsed there is likewise no missed boundary.
export function prevInterval(
  everyMs: number,
  now: number,
  lastRun: number | undefined
): number | undefined {
  if (lastRun === undefined || now - lastRun < everyMs) {
    return undefined;
  }
  const periods = Math.floor((now - lastRun) / everyMs);
  return lastRun + periods * everyMs;
}

// Most-recent cron match at or before `now`, or undefined when the expression is
// malformed or matches nothing within the search horizon looking back. The current
// (partially-elapsed) minute stays a live candidate — flooring seconds to 0 makes
// `now`'s minute match if the expression permits it — mirroring nextCron's forward
// treatment. Field-aware backward jumps keep the walk bounded (never minute-by-
// minute across empty months).
export function prevCron(expr: string, now: number): number | undefined {
  const parsed = parseCron(expr);
  if (!parsed) {
    return undefined;
  }
  const cursor = new Date(now);
  cursor.setSeconds(0, 0);
  const limit = now - CRON_SEARCH_LIMIT_MS;

  while (cursor.getTime() >= limit) {
    // Wrong month: jump back to the last minute of the previous month.
    if (!parsed.month.values.has(cursor.getMonth() + 1)) {
      cursor.setDate(1);
      cursor.setHours(0, 0, 0, 0);
      cursor.setMinutes(cursor.getMinutes() - 1);
      continue;
    }
    // Wrong day: jump back to 23:59 of the previous day.
    if (!matchesCronDay(parsed, cursor)) {
      cursor.setHours(0, 0, 0, 0);
      cursor.setMinutes(cursor.getMinutes() - 1);
      continue;
    }
    // Wrong hour: jump back to :59 of the previous hour.
    if (!parsed.hour.values.has(cursor.getHours())) {
      cursor.setMinutes(0, 0, 0);
      cursor.setMinutes(cursor.getMinutes() - 1);
      continue;
    }
    // Wrong minute: step back one minute.
    if (!parsed.minute.values.has(cursor.getMinutes())) {
      cursor.setMinutes(cursor.getMinutes() - 1, 0, 0);
      continue;
    }
    return cursor.getTime();
  }
  return undefined;
}
