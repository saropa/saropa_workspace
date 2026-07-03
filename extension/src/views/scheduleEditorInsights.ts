// The "Around your schedule" computation for the Schedule editor webview: it places the
// shortcut being edited against every other enabled, daily-scheduled shortcut and reports
// a same-minute conflict warning plus the largest free gap in the day. Split out of
// scheduleEditorPanel.ts so the panel file stays the host/protocol side and this stays the
// pure scheduling math (no webview, no `this`, fully unit-testable).
//
// Cron and interval shortcuts have no single clock time, so they are not plotted here;
// this view is about the daily-time landscape, which is what "conflicts and gaps" most
// concerns.
import { ShortcutStore } from "../model/shortcutStore";
import { parseHourMinute } from "../exec/schedule";
import { l10n } from "../i18n/l10n";
import { shortcutName } from "./scheduleEditorShell";

const MINUTES_PER_DAY = 24 * 60;
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
// Cap on how many clashing shortcut names to spell out before collapsing to "+N more",
// so a busy time slot does not produce an unreadable wall of names.
const MAX_NAMED = 3;

// The wire shape the client posts back: WorkSchedule minus the host-managed lastRun.
// Lives here because the insights math is its primary consumer; the panel imports it for
// the message protocol.
export interface WireWork {
  atTime?: string;
  days?: number[];
  everyMs?: number;
  cron?: string;
  runOnStartup?: boolean;
  catchUp?: boolean;
  enabled: boolean;
}

// One other scheduled shortcut placed on the 24-hour strip: its name and its daily time
// as minutes-of-day. Sent to the client as {n, m} (terse keys keep the payload small).
interface Neighbor {
  name: string;
  minutes: number;
  days: number[];
}

// What the "Around your schedule" card renders: this shortcut's daily time (minutes, or
// null when it has none), the other daily-scheduled shortcuts as ticks, a same-minute
// conflict warning, a free-gap note, and the gap's bounds for the visual band. The two
// prose lines are localized host-side so the client carries no display strings.
export interface Insights {
  mine: number | null;
  neighbors: Array<{ n: string; m: number }>;
  conflict: string;
  note: string;
  gapFrom: number | null;
  gapTo: number | null;
}

export function buildInsights(
  store: ShortcutStore,
  shortcutId: string,
  work: WireWork
): Insights {
  const mineParsed = work.atTime ? parseHourMinute(work.atTime) : undefined;
  const mine = mineParsed ? mineParsed.hour * 60 + mineParsed.minute : null;
  const mineDays = work.days && work.days.length > 0 ? work.days : ALL_DAYS;

  const neighbors: Neighbor[] = [];
  for (const shortcut of [
    ...store.getProjectShortcuts(),
    ...store.getGlobalShortcuts(),
  ]) {
    const schedule = shortcut.schedule;
    if (shortcut.id === shortcutId || !schedule?.enabled || !schedule.atTime) {
      continue;
    }
    const parsed = parseHourMinute(schedule.atTime);
    if (!parsed) {
      continue;
    }
    neighbors.push({
      name: shortcutName(shortcut),
      minutes: parsed.hour * 60 + parsed.minute,
      days: schedule.days && schedule.days.length > 0 ? schedule.days : ALL_DAYS,
    });
  }

  return {
    mine,
    neighbors: neighbors.map((nb) => ({ n: nb.name, m: nb.minutes })),
    conflict: conflictText(mine, mineDays, neighbors),
    ...gapInfo(mine, neighbors),
  };
}

// Names of other shortcuts firing in the SAME minute on an overlapping weekday, as a
// localized warning — or '' when nothing clashes.
function conflictText(
  mine: number | null,
  mineDays: number[],
  neighbors: Neighbor[]
): string {
  if (mine === null) {
    return "";
  }
  const clashing = neighbors
    .filter((nb) => nb.minutes === mine && daysOverlap(nb.days, mineDays))
    .map((nb) => nb.name);
  if (clashing.length === 0) {
    return "";
  }
  return l10n("scheduleEditor.insight.conflict", {
    time: formatMinutes(mine),
    names: formatNames(clashing),
  });
}

// The largest stretch of the day with no daily run, as a localized note plus the gap's
// bounds for the visual band. Needs at least two distinct times to be meaningful; with
// only this shortcut (no daily neighbors) it reports "nothing else", and with no daily
// time at all it prompts to add one.
function gapInfo(
  mine: number | null,
  neighbors: Neighbor[]
): { note: string; gapFrom: number | null; gapTo: number | null } {
  if (mine === null && neighbors.length === 0) {
    return { note: l10n("scheduleEditor.insight.empty"), gapFrom: null, gapTo: null };
  }
  if (mine !== null && neighbors.length === 0) {
    return { note: l10n("scheduleEditor.insight.alone"), gapFrom: null, gapTo: null };
  }
  const times = neighbors.map((nb) => nb.minutes);
  if (mine !== null) {
    times.push(mine);
  }
  const unique = [...new Set(times)].sort((a, b) => a - b);
  if (unique.length < 2) {
    return { note: "", gapFrom: null, gapTo: null };
  }
  // Walk consecutive times on a 24h ring; the largest span between two adjacent runs is
  // the free gap. The last-to-first wrap crosses midnight (+1440).
  let bestSpan = -1;
  let from = 0;
  let to = 0;
  for (let i = 0; i < unique.length; i++) {
    const start = unique[i] ?? 0;
    const end = i + 1 < unique.length ? unique[i + 1] ?? 0 : (unique[0] ?? 0) + MINUTES_PER_DAY;
    const span = end - start;
    if (span > bestSpan) {
      bestSpan = span;
      from = start;
      to = end % MINUTES_PER_DAY;
    }
  }
  return {
    note: l10n("scheduleEditor.insight.gap", {
      from: formatMinutes(from),
      to: formatMinutes(to),
      span: formatSpan(bestSpan),
    }),
    gapFrom: from,
    gapTo: to,
  };
}

// Whether two weekday sets share any day (an empty set already means "every day" by the
// time it reaches here, so both are concrete 0..6 lists).
function daysOverlap(a: number[], b: number[]): boolean {
  const set = new Set(a);
  return b.some((d) => set.has(d));
}

// Join clashing shortcut names for the conflict warning, collapsing a long list to the
// first few plus a localized "+N more" so a busy slot stays readable.
function formatNames(names: string[]): string {
  if (names.length <= MAX_NAMED) {
    return names.join(", ");
  }
  return l10n("scheduleEditor.insight.andMore", {
    names: names.slice(0, MAX_NAMED).join(", "),
    count: names.length - MAX_NAMED,
  });
}

// Minutes-of-day to a zero-padded local "HH:mm".
function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// A minute span as a compact "Xh Ym" / "Xh" / "Ym" duration shorthand (numeric, not
// prose — the surrounding sentence is the localized part).
function formatSpan(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) {
    return `${m}m`;
  }
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}
