import { PinSchedule } from "../model/pin";

// Pure next-occurrence math for a pin schedule. Deliberately has NO VS Code
// dependency so it is unit-testable in isolation without the extension host
// (roadmap 6.1: "testable without the VS Code host").
//
// A schedule may combine a daily time (atTime, local "HH:mm") and a repeating
// interval (everyMs). When both are set the next fire is the earlier of the two.
// `lastRun` (epoch ms of the previous fire) provides reopen de-duplication so a
// VS Code restart within the same target minute does not double-fire a daily
// slot, and so an interval picks up from its last fire rather than from launch.

// Next fire at or after `now` (epoch ms), or undefined when the schedule is
// disabled, malformed, or carries no timing fields.
export function nextOccurrence(
  schedule: PinSchedule,
  now: number
): number | undefined {
  if (!schedule.enabled) {
    return undefined;
  }

  const candidates: number[] = [];

  if (schedule.atTime) {
    const daily = nextDailyTime(schedule.atTime, now, schedule.lastRun);
    if (daily !== undefined) {
      candidates.push(daily);
    }
  }
  if (schedule.everyMs !== undefined && schedule.everyMs > 0) {
    candidates.push(nextInterval(schedule.everyMs, now, schedule.lastRun));
  }

  if (candidates.length === 0) {
    return undefined;
  }
  return Math.min(...candidates);
}

// Parse a local "HH:mm" (24-hour) string. Returns undefined for anything that is
// not a valid hour/minute, so a hand-edited typo disables the daily slot rather
// than firing at an unintended time.
export function parseHourMinute(
  atTime: string
): { hour: number; minute: number } | undefined {
  const match = /^(\d{1,2}):(\d{2})$/.exec(atTime.trim());
  if (!match) {
    return undefined;
  }
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return undefined;
  }
  return { hour, minute };
}

function nextDailyTime(
  atTime: string,
  now: number,
  lastRun: number | undefined
): number | undefined {
  const parsed = parseHourMinute(atTime);
  if (!parsed) {
    return undefined;
  }

  const today = atLocalTime(now, parsed.hour, parsed.minute);
  const tomorrow = addOneDayLocal(today);

  // Slot still ahead of us today.
  if (now < today) {
    return today;
  }

  // Inside today's target minute: fire it, unless we already fired within this
  // same minute (the reopen-dedup case — VS Code restarted seconds after a fire).
  const withinTargetMinute = now < today + 60_000;
  const alreadyFiredThisMinute =
    lastRun !== undefined && lastRun >= today && lastRun < today + 60_000;
  if (withinTargetMinute && !alreadyFiredThisMinute) {
    return today;
  }

  // Slot has passed for today (or was already fired): next daily fire is
  // tomorrow. Missed slots are not back-fired.
  return tomorrow;
}

function nextInterval(
  everyMs: number,
  now: number,
  lastRun: number | undefined
): number {
  // No prior fire: the first interval fire is one period from now.
  if (lastRun === undefined) {
    return now + everyMs;
  }
  let next = lastRun + everyMs;
  if (next <= now) {
    // One or more periods elapsed while VS Code was closed. Advance to the next
    // future boundary aligned to lastRun without back-firing each missed period.
    const periodsMissed = Math.ceil((now - lastRun) / everyMs);
    next = lastRun + periodsMissed * everyMs;
    if (next <= now) {
      next += everyMs;
    }
  }
  return next;
}

// Today's instant for a local wall-clock hour/minute.
function atLocalTime(now: number, hour: number, minute: number): number {
  const d = new Date(now);
  d.setHours(hour, minute, 0, 0);
  return d.getTime();
}

// Add one calendar day in LOCAL time (via setDate), so the wall-clock HH:mm is
// preserved across a daylight-saving transition rather than drifting by an hour
// (which a flat +86_400_000 ms would cause).
function addOneDayLocal(ts: number): number {
  const d = new Date(ts);
  d.setDate(d.getDate() + 1);
  return d.getTime();
}
