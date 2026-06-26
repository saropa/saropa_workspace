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
  if (schedule.cron) {
    const cron = nextCron(schedule.cron, now, schedule.lastRun);
    if (cron !== undefined) {
      candidates.push(cron);
    }
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

// ---------------------------------------------------------------------------
// Cron support (5-field). Deliberately in-repo and dependency-free: a 5-field
// subset of Vixie cron does not justify a supply-chain commitment (roadmap note
// on the cron-parser dependency). Like the rest of this module it has NO VS Code
// dependency, so the parser and next-fire math are unit-testable in isolation.
// ---------------------------------------------------------------------------

// One parsed cron field: the set of values it permits, plus whether it was a bare
// `*`. The `all` flag is needed only for the day-of-month / day-of-week OR rule
// below, but is tracked for every field for a uniform shape.
interface CronField {
  all: boolean;
  values: ReadonlySet<number>;
}

// A parsed 5-field cron expression. Fields are stored as resolved value sets so
// matching is a single Set.has lookup.
export interface ParsedCron {
  minute: CronField; // 0-59
  hour: CronField; // 0-23
  dom: CronField; // 1-31 (day of month)
  month: CronField; // 1-12
  dow: CronField; // 0-6 (day of week, Sunday = 0; input 7 normalized to 0)
}

const MONTH_NAMES: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};
const DOW_NAMES: Record<string, number> = {
  sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
};

// Parse a 5-field cron expression. Returns undefined for any malformed field or a
// wrong field count, so a hand-typed typo disables the cron slot rather than
// firing at an unintended time. Whitespace between fields is collapsed.
export function parseCron(expr: string): ParsedCron | undefined {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) {
    return undefined;
  }
  const minute = parseCronField(parts[0], 0, 59);
  const hour = parseCronField(parts[1], 0, 23);
  const dom = parseCronField(parts[2], 1, 31);
  const month = parseCronField(parts[3], 1, 12, MONTH_NAMES);
  // Day-of-week accepts 0-7 on input (both 0 and 7 = Sunday); normalize 7 -> 0.
  const dow = parseCronField(parts[4], 0, 7, DOW_NAMES, (n) => (n === 7 ? 0 : n));
  if (!minute || !hour || !dom || !month || !dow) {
    return undefined;
  }
  return { minute, hour, dom, month, dow };
}

// Parse one cron field into its permitted value set. Supports `*`, comma lists,
// ranges `a-b`, and steps (`*/n`, `a-b/n`, `a/n` meaning a..max step n). `names`
// maps 3-letter names to numbers (months / weekdays); `normalize` folds an input
// value (e.g. dow 7) onto its canonical form. Returns undefined on any value out
// of [min, max] or unparseable token, so the whole expression is rejected.
function parseCronField(
  token: string,
  min: number,
  max: number,
  names?: Record<string, number>,
  normalize?: (n: number) => number
): CronField | undefined {
  if (token === "*") {
    return { all: true, values: fullRange(min, max) };
  }
  const values = new Set<number>();
  for (const part of token.split(",")) {
    const expanded = expandCronPart(part, min, max, names, normalize);
    if (!expanded) {
      return undefined;
    }
    for (const v of expanded) {
      values.add(v);
    }
  }
  if (values.size === 0) {
    return undefined;
  }
  return { all: false, values };
}

// Expand a single comma-separated cron part ("5", "1-5", "*/15", "9-17/2",
// "10/3", "mon", "jan-mar") into its concrete values, or undefined if malformed.
function expandCronPart(
  part: string,
  min: number,
  max: number,
  names?: Record<string, number>,
  normalize?: (n: number) => number
): number[] | undefined {
  // Split off an optional /step suffix first.
  const slash = part.split("/");
  if (slash.length > 2) {
    return undefined;
  }
  const base = slash[0];
  let step = 1;
  if (slash.length === 2) {
    step = Number(slash[1]);
    if (!Number.isInteger(step) || step <= 0) {
      return undefined;
    }
  }

  // Determine the [lo, hi] span the step walks over.
  let lo: number;
  let hi: number;
  if (base === "*") {
    lo = min;
    hi = max;
  } else if (base.includes("-")) {
    const ends = base.split("-");
    if (ends.length !== 2) {
      return undefined;
    }
    const a = resolveCronValue(ends[0], names);
    const b = resolveCronValue(ends[1], names);
    if (a === undefined || b === undefined || a > b) {
      return undefined;
    }
    lo = a;
    hi = b;
  } else {
    const single = resolveCronValue(base, names);
    if (single === undefined) {
      return undefined;
    }
    // "a/n" (a bare value with a step) means a..max step n; a bare value with no
    // step is just that one value.
    lo = single;
    hi = slash.length === 2 ? max : single;
  }

  if (lo < min || hi > max) {
    return undefined;
  }
  const out: number[] = [];
  for (let v = lo; v <= hi; v += step) {
    out.push(normalize ? normalize(v) : v);
  }
  return out;
}

// Resolve a single cron token to a number: a decimal literal, or a 3-letter name
// (case-insensitive) when the field supports names. Undefined when neither.
function resolveCronValue(
  token: string,
  names?: Record<string, number>
): number | undefined {
  if (/^\d+$/.test(token)) {
    return Number(token);
  }
  if (names) {
    const named = names[token.toLowerCase()];
    if (named !== undefined) {
      return named;
    }
  }
  return undefined;
}

function fullRange(min: number, max: number): Set<number> {
  const set = new Set<number>();
  for (let v = min; v <= max; v++) {
    set.add(v);
  }
  return set;
}

// How far ahead the next-fire search will look before giving up. Four years
// covers Feb-29-only schedules (the classic cron horizon); an expression that
// matches no instant within it (e.g. "0 0 30 2 *", Feb 30) returns undefined and
// the pin simply never fires on cron, mirroring "malformed disables".
const CRON_SEARCH_LIMIT_MS = 4 * 366 * 24 * 60 * 60_000;

// Next cron fire at or after `now` (epoch ms), or undefined when the expression is
// malformed or matches nothing within the search horizon. `lastRun` provides the
// same reopen de-duplication as the daily slot: the current minute is a live
// candidate (so opening VS Code at 09:00:30 still catches a "0 9 * * *" slot), but
// if a fire was already recorded within that same minute it is skipped so a
// restart does not double-fire.
export function nextCron(
  expr: string,
  now: number,
  lastRun?: number
): number | undefined {
  const parsed = parseCron(expr);
  if (!parsed) {
    return undefined;
  }

  // Floor to the current minute: cron matches at minute granularity, and the
  // partially-elapsed current minute stays a live candidate (caught-up below the
  // way the daily slot catches a just-missed time on reopen).
  const cursor = new Date(now);
  cursor.setSeconds(0, 0);
  const limit = now + CRON_SEARCH_LIMIT_MS;

  // Field-aware advance: jump a whole month/day/hour forward when that coarser
  // field cannot match, instead of stepping minute-by-minute across years.
  while (cursor.getTime() <= limit) {
    if (!parsed.month.values.has(cursor.getMonth() + 1)) {
      cursor.setMonth(cursor.getMonth() + 1, 1);
      cursor.setHours(0, 0, 0, 0);
      continue;
    }
    if (!matchesCronDay(parsed, cursor)) {
      cursor.setDate(cursor.getDate() + 1);
      cursor.setHours(0, 0, 0, 0);
      continue;
    }
    if (!parsed.hour.values.has(cursor.getHours())) {
      cursor.setHours(cursor.getHours() + 1, 0, 0, 0);
      continue;
    }
    if (!parsed.minute.values.has(cursor.getMinutes())) {
      cursor.setMinutes(cursor.getMinutes() + 1, 0, 0);
      continue;
    }

    // All fields match this minute. Reopen de-dup: if a fire was already recorded
    // inside this minute, advance past it so a restart seconds later does not
    // re-fire the same slot.
    const minuteStart = cursor.getTime();
    if (lastRun !== undefined && lastRun >= minuteStart && lastRun < minuteStart + 60_000) {
      cursor.setMinutes(cursor.getMinutes() + 1, 0, 0);
      continue;
    }
    return minuteStart;
  }
  return undefined;
}

// The day-of-month / day-of-week match, with Vixie cron's OR rule: when BOTH
// fields are restricted (neither is `*`), the day matches if EITHER matches; when
// only one is restricted, only that one constrains; when both are `*`, every day
// matches.
function matchesCronDay(parsed: ParsedCron, d: Date): boolean {
  const domMatch = parsed.dom.values.has(d.getDate());
  const dowMatch = parsed.dow.values.has(d.getDay());
  if (!parsed.dom.all && !parsed.dow.all) {
    return domMatch || dowMatch;
  }
  if (!parsed.dom.all) {
    return domMatch;
  }
  if (!parsed.dow.all) {
    return dowMatch;
  }
  return true;
}
