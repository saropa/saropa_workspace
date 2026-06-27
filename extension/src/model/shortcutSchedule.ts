// Scheduling, triggers, system events, and metric badges for a shortcut. Split out of
// shortcut.ts (which re-exports these) to keep that file under the line cap.

// A live metric a file shortcut can display as an inline badge (#24). The metric
// engine watches the resolved file and recomputes on change:
//   - "size"     the file size (e.g. "245 KB"); the only kind a thresholdBytes applies to
//   - "lines"    the line count (engine caps the read and degrades to size for a huge file)
//   - "modified" the last-modified time, rendered relative ("5 min ago") at paint time
// Present only on a file shortcut the user opted into a metric for; absent on every
// other shortcut, so the engine arms a watcher for opted-in shortcuts only (no cost
// by default).
export interface ShortcutMetric {
  kind: "size" | "lines" | "modified";
  // Size ceiling in BYTES. When set (size kind only), the badge turns to a warning
  // tint once the file exceeds it and a one-time toast fires on the under->over
  // crossing — the "tell me when this file gets too big" alert. Undefined = badge only.
  thresholdBytes?: number;
}

// A system-level event a shortcut can react to or emit (WOW: recipe chaining +
// special events). "build" / "publish" are emitted by a shortcut the user marks as
// that kind of step (Shortcut.emits) when it completes; "gitCommit" / "gitPush" are
// detected directly from the repo's .git logs by a file watcher, so no shortcut
// needs to emit them.
export type SystemEventName = "build" | "publish" | "gitCommit" | "gitPush";

// The fixed set of system events, in display order. Single source for the UI
// pickers and the workflow graph's synthetic event nodes.
export const SYSTEM_EVENTS: readonly SystemEventName[] = [
  "build",
  "publish",
  "gitCommit",
  "gitPush",
];

// One cause that auto-runs a shortcut beyond its own schedule (recipe chaining). A
// "pin" trigger runs this shortcut after another shortcut completes (optionally only
// when that shortcut succeeded); an "event" trigger runs it after a system event
// fires; an "idle" trigger runs it once after `minutes` of no VS Code interaction
// (WOW #18 — the "coffee break" runner, for a heavy job you want fired while you are
// away from the keyboard). A shortcut may carry several, so "run X after Y" and "run
// Z after Y" are independent links. An idle run is always forced to the background
// channel (it must never steal the terminal while unattended) and re-arms only after
// the next burst of activity, so it fires at most once per idle period.
export type ShortcutTrigger =
  | { kind: "pin"; pinId: string; onlyOnSuccess?: boolean }
  | { kind: "event"; event: SystemEventName }
  | { kind: "idle"; minutes: number };

// Phase 1 scheduling is defined in the model so stored shortcuts are forward-
// compatible with the scheduler step; the scheduler itself is wired in a later step.
export interface ShortcutSchedule {
  // Daily fire time, local "HH:mm". Optional.
  atTime?: string;
  // Local weekdays (0 = Sunday .. 6 = Saturday) on which the daily `atTime` slot
  // may fire. Empty or absent = every day. Constrains only the daily time; a
  // repeating `everyMs` interval stays periodic regardless of weekday by design
  // (an "every 6 hours" job is not a weekday concept). So "weekdays at 9am" is
  // atTime "09:00" + days [1,2,3,4,5].
  days?: number[];
  // Repeating interval in milliseconds. Optional; combinable with atTime. The
  // editor surfaces this in minutes / hours / days units, but the stored value is
  // always milliseconds so the schedule math has one source of truth.
  everyMs?: number;
  // Optional 5-field cron expression: "minute hour day-of-month month day-of-week"
  // (standard Vixie syntax — `*`, lists `a,b`, ranges `a-b`, steps `*/n` / `a-b/n`,
  // 3-letter month/day names, DOW 0 or 7 = Sunday). Parsed and advanced by
  // `nextCron` in schedule.ts, and folded into the same `nextOccurrence` path as
  // `atTime` / `everyMs` (the earliest of all set slots wins) — there is no second
  // scheduler. A malformed expression disables the cron slot rather than firing at
  // an unintended time, matching how a bad atTime is treated. Combinable with the
  // other timing fields.
  cron?: string;
  // When true, fire this shortcut once shortly after the extension activates (a
  // workspace open), in addition to any time-based slots. The run is deferred past
  // activation so it never does file IO in the activation path, and de-duped on
  // `lastRun` within a short window so a window-reload storm does not re-run it.
  // Gated by `enabled` like every other slot. A schedule may carry runOnStartup
  // alone (no atTime / everyMs / cron) to mean "only on workspace open".
  runOnStartup?: boolean;
  enabled: boolean;
  // Epoch ms of the last fire, used to avoid duplicate same-minute fires when
  // VS Code reopens.
  lastRun?: number;
}
