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
    const daily = nextDailyTime(
      schedule.atTime,
      now,
      schedule.lastRun,
      schedule.days
    );
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
  lastRun: number | undefined,
  days: number[] | undefined
): number | undefined {
  const parsed = parseHourMinute(atTime);
  if (!parsed) {
    return undefined;
  }

  // An empty or absent day list means "every day"; a non-empty list restricts the
  // daily slot to those local weekdays (0 = Sun .. 6 = Sat). Walk today..+7 and
  // return the first allowed slot that is still ahead — within 7 days the same
  // weekday recurs, so a non-empty list always resolves. With no list this reduces
  // exactly to the prior today/tomorrow behavior (offset 0 future, else this
  // minute, else offset 1 = tomorrow), so existing daily schedules are unchanged.
  const allowed = days && days.length > 0 ? days : undefined;
  for (let offset = 0; offset <= 7; offset++) {
    const slot = atLocalTimeWithOffset(now, parsed.hour, parsed.minute, offset);
    if (allowed && !allowed.includes(new Date(slot).getDay())) {
      continue;
    }
    if (now < slot) {
      return slot;
    }
    if (offset === 0) {
      // Inside today's target minute: fire it, unless we already fired within this
      // same minute (the reopen-dedup case — VS Code restarted seconds after a fire).
      const withinTargetMinute = now < slot + 60_000;
      const alreadyFiredThisMinute =
        lastRun !== undefined && lastRun >= slot && lastRun < slot + 60_000;
      if (withinTargetMinute && !alreadyFiredThisMinute) {
        return slot;
      }
    }
  }
  return undefined;
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

// The instant for a local wall-clock hour/minute `offset` calendar days from
// today. setDate advances in LOCAL time, so the wall-clock HH:mm is preserved
// across a daylight-saving transition rather than drifting by an hour (which a
// flat +N*86_400_000 ms would cause). offset 0 = today at that time.
function atLocalTimeWithOffset(
  now: number,
  hour: number,
  minute: number,
  offset: number
): number {
  const d = new Date(now);
  d.setHours(hour, minute, 0, 0);
  d.setDate(d.getDate() + offset);
  return d.getTime();
}
