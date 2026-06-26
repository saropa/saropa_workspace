import { ShortcutSchedule } from "../model/shortcut";

// Shared, UI-agnostic schedule-edit model used by BOTH the QuickPick wizard
// (configureSchedule.ts) and the webview form (views/scheduleEditorPanel.ts), so
// the two surfaces normalize and auto-enable a schedule identically — one source
// of truth for "what does this set of fields mean as a stored schedule".

// Working shape while editing: enabled is always present; the timing fields are
// optional. lastRun is carried through untouched so reopen de-dup survives an edit.
export interface WorkSchedule {
  atTime?: string;
  days?: number[];
  everyMs?: number;
  cron?: string;
  runOnStartup?: boolean;
  enabled: boolean;
  lastRun?: number;
}

// Seed a working copy from a shortcut's stored schedule (or a blank, enabled default
// when the shortcut has none). Arrays are copied so edits never mutate the stored shortcut.
export function workFromSchedule(schedule: ShortcutSchedule | undefined): WorkSchedule {
  return {
    atTime: schedule?.atTime,
    days: schedule?.days ? [...schedule.days] : undefined,
    everyMs: schedule?.everyMs,
    cron: schedule?.cron,
    runOnStartup: schedule?.runOnStartup,
    enabled: schedule?.enabled ?? true,
    lastRun: schedule?.lastRun,
  };
}

// Whether the working schedule carries any timing source (a daily time, an
// interval, a cron, or run-on-startup). An enabled flag with no timing arms
// nothing, so "has timing" is the precondition for both keeping the schedule and
// auto-enabling it.
export function hasTiming(work: WorkSchedule): boolean {
  return (
    !!work.atTime ||
    work.everyMs !== undefined ||
    !!work.cron ||
    !!work.runOnStartup
  );
}

// Auto-enable a schedule the moment it has timing: a user who sets a daily time or
// an interval means "run this," so they should not also have to flip Enabled (which
// was easy to miss and left the schedule stored but inert). Suppressed once the
// user has used the Enabled toggle themselves, so a deliberate disable stands.
export function applyAutoEnable(
  work: WorkSchedule,
  enabledTouched: boolean
): void {
  if (!enabledTouched && !work.enabled && hasTiming(work)) {
    work.enabled = true;
  }
}

// Collapse a working copy to a stored ShortcutSchedule, or undefined when it carries no
// timing source (so the shortcut reads as "not scheduled" rather than holding an inert
// object). runOnStartup is itself a timing source (fires on workspace open), so a
// startup-only schedule is kept.
export function normalizeWork(work: WorkSchedule): ShortcutSchedule | undefined {
  if (!hasTiming(work)) {
    return undefined;
  }
  return {
    atTime: work.atTime,
    // Days only qualify a daily time; drop them when there is no atTime, and drop an
    // empty/all-7 selection (both mean "every day") so the stored shape is minimal.
    days:
      work.atTime && work.days && work.days.length > 0 && work.days.length < 7
        ? [...work.days].sort((a, b) => a - b)
        : undefined,
    everyMs: work.everyMs,
    cron: work.cron,
    // Store the flag only when on, so a shortcut that was never a startup shortcut carries
    // no inert false.
    runOnStartup: work.runOnStartup ? true : undefined,
    enabled: work.enabled,
    lastRun: work.lastRun,
  };
}
