import * as vscode from "vscode";
import { Pin, PinSchedule } from "../model/pin";
import { PinStore } from "../model/pinStore";
import { parseHourMinute, parseCron } from "../exec/schedule";
import { showHubQuickPick } from "./hubQuickPick";
import { l10n } from "../i18n/l10n";

// Roadmap 2.2 — schedule editor UI.
//
// A hub-and-spoke QuickPick to set a pin's daily time (atTime), repeating
// interval (everyMs), and enabled flag without hand-editing JSON. Editing
// through this flow refreshes the store, which re-arms the scheduler's timers, so
// enabling/disabling a schedule takes effect without a reload (acceptance 2.2).
//
// Edits accumulate in a working copy; nothing is persisted until Save. Esc at the
// hub discards them.

interface HubItem extends vscode.QuickPickItem {
  id: "atTime" | "days" | "interval" | "cron" | "runOnStartup" | "enabled" | "save";
}

// Working shape: enabled is always present; the timing fields are optional.
interface WorkSchedule {
  atTime?: string;
  days?: number[];
  everyMs?: number;
  cron?: string;
  runOnStartup?: boolean;
  enabled: boolean;
  lastRun?: number;
}

export async function configureSchedule(store: PinStore, pin: Pin): Promise<void> {
  // Auto-pins are recomputed each refresh and never stored, so a schedule cannot
  // persist on them.
  if (pin.isAuto) {
    vscode.window.showWarningMessage(l10n("schedule.autoUnsupported"));
    return;
  }

  const name = pin.label ?? (pin.path.split("/").pop() ?? pin.path);
  const title = l10n("schedule.title", { name });

  const work: WorkSchedule = {
    atTime: pin.schedule?.atTime,
    days: pin.schedule?.days ? [...pin.schedule.days] : undefined,
    everyMs: pin.schedule?.everyMs,
    cron: pin.schedule?.cron,
    runOnStartup: pin.schedule?.runOnStartup,
    enabled: pin.schedule?.enabled ?? true,
    // Preserve the prior fire stamp so reopen de-dup survives an edit.
    lastRun: pin.schedule?.lastRun,
  };

  // Remember the row the user last acted on so each re-render of the hub restores
  // focus to it. Without this, editing a field or flipping a toggle bounced the
  // selection back to the top of the list every time ("the menu keeps reopening
  // from the start"), and a toggle row gave no sense its change took.
  let activeId: HubItem["id"] | undefined;
  // Once the user flips the Enabled toggle themselves, stop auto-enabling so a
  // deliberate "keep this schedule but switch it off" is respected.
  let enabledTouched = false;
  for (;;) {
    const choice = await showHub(work, title, activeId);
    if (!choice) {
      // Esc: discard, write nothing.
      return;
    }
    if (choice === "save") {
      break;
    }
    activeId = choice;
    switch (choice) {
      case "atTime":
        await editDailyTime(work, title);
        break;
      case "days":
        await editDays(work, title);
        break;
      case "interval":
        await editInterval(work, title);
        break;
      case "cron":
        await editCron(work, title);
        break;
      case "runOnStartup":
        // Toggle directly from the hub for a snappy on/off.
        work.runOnStartup = !work.runOnStartup;
        break;
      case "enabled":
        // Toggle directly from the hub for a snappy on/off.
        work.enabled = !work.enabled;
        enabledTouched = true;
        break;
    }
    autoEnable(work, enabledTouched);
  }

  // Catch the no-edit case too: opening a stored-but-disabled schedule and saving
  // straight away should still turn it on, since having a time set means "run it".
  autoEnable(work, enabledTouched);

  await store.updatePinSchedule(pin, normalize(work));
  vscode.window.showInformationMessage(l10n("schedule.saved", { name }));
}

// Whether the working schedule carries any timing source (a daily time, an
// interval, a cron, or run-on-startup). An enabled flag with no timing arms
// nothing, so "has timing" is the precondition for auto-enabling.
function hasTiming(work: WorkSchedule): boolean {
  return (
    !!work.atTime ||
    work.everyMs !== undefined ||
    !!work.cron ||
    !!work.runOnStartup
  );
}

// Auto-enable a schedule the moment it has timing: a user who sets a daily time
// or an interval means "run this," so they should not also have to flip Enabled.
// Suppressed once the user has used the Enabled toggle themselves, so a deliberate
// disable stands. Visible immediately because the hub re-renders after each edit.
function autoEnable(work: WorkSchedule, enabledTouched: boolean): void {
  if (!enabledTouched && !work.enabled && hasTiming(work)) {
    work.enabled = true;
  }
}

// A schedule with no timing source would arm no timer and react to nothing;
// collapse it to undefined so the pin reads as "not scheduled" rather than
// carrying an inert object. runOnStartup is itself a timing source (fires on
// workspace open), so a startup-only schedule is kept.
function normalize(work: WorkSchedule): PinSchedule | undefined {
  if (!work.atTime && work.everyMs === undefined && !work.cron && !work.runOnStartup) {
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
    // Store the flag only when on, so a pin that was never a startup pin carries
    // no inert false.
    runOnStartup: work.runOnStartup ? true : undefined,
    enabled: work.enabled,
    lastRun: work.lastRun,
  };
}

// Local weekday short names, Sunday-first to match Date.getDay()'s 0..6 indexing.
const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Compact day-set summary for the hub row: "Every day" when unset/all, "Weekdays"
// for Mon-Fri, "Weekends" for Sat+Sun, else the short names in week order.
function describeDays(days: number[] | undefined): string {
  if (!days || days.length === 0 || days.length === 7) {
    return l10n("schedule.days.everyDay");
  }
  const set = new Set(days);
  const isWeekdays = [1, 2, 3, 4, 5].every((d) => set.has(d)) && set.size === 5;
  if (isWeekdays) {
    return l10n("schedule.days.weekdays");
  }
  const isWeekends = set.has(0) && set.has(6) && set.size === 2;
  if (isWeekends) {
    return l10n("schedule.days.weekends");
  }
  return [...days]
    .sort((a, b) => a - b)
    .map((d) => WEEKDAY_LABELS[d])
    .join(", ");
}

// Render the hub as a persistent QuickPick. `activeId`, when given, restores focus
// to that row so editing a field or flipping a toggle does not reset the selection
// to the top of the list on every re-render. ignoreFocusOut keeps the menu up when
// focus shifts (e.g. to a notification), so a stray click no longer discards edits.
async function showHub(
  work: WorkSchedule,
  title: string,
  activeId?: HubItem["id"]
): Promise<HubItem["id"] | undefined> {
  const items: HubItem[] = [
    {
      id: "atTime",
      label: l10n("schedule.field.atTime"),
      description: work.atTime ?? l10n("schedule.value.none"),
    },
    {
      id: "days",
      label: l10n("schedule.field.days"),
      // Days qualify the daily time; show a hint to set a time first when none is set.
      description: work.atTime
        ? describeDays(work.days)
        : l10n("schedule.days.needsTime"),
    },
    {
      id: "interval",
      label: l10n("schedule.field.interval"),
      description:
        work.everyMs !== undefined
          ? describeInterval(work.everyMs)
          : l10n("schedule.value.none"),
    },
    {
      id: "cron",
      label: l10n("schedule.field.cron"),
      description: work.cron ?? l10n("schedule.value.none"),
    },
    {
      id: "runOnStartup",
      label: l10n("schedule.field.runOnStartup"),
      description: work.runOnStartup
        ? l10n("schedule.value.on")
        : l10n("schedule.value.off"),
    },
    {
      id: "enabled",
      label: l10n("schedule.field.enabled"),
      description: work.enabled
        ? l10n("schedule.value.on")
        : l10n("schedule.value.off"),
    },
    {
      id: "save",
      label: l10n("schedule.save"),
      description: l10n("schedule.saveHint"),
    },
  ];

  const active = activeId ? items.find((i) => i.id === activeId) : undefined;
  const pick = await showHubQuickPick(items, {
    title,
    placeholder: l10n("schedule.hubPlaceholder"),
    active,
  });
  return pick?.id;
}

async function editDailyTime(work: WorkSchedule, title: string): Promise<void> {
  const value = await vscode.window.showInputBox({
    title,
    prompt: l10n("schedule.atTime.prompt"),
    placeHolder: l10n("schedule.atTime.placeholder"),
    value: work.atTime ?? "",
    validateInput: (input) => {
      const trimmed = input.trim();
      if (trimmed === "") {
        return undefined; // empty clears the daily time
      }
      return parseHourMinute(trimmed) ? undefined : l10n("schedule.atTime.invalid");
    },
  });
  if (value === undefined) {
    return;
  }
  work.atTime = value.trim() === "" ? undefined : value.trim();
}

// Multi-select the weekdays the daily time fires on. Sunday-first to match
// Date.getDay(). Two shortcut rows (Weekdays, Weekends) pre-pick common sets; an
// empty selection means "every day". Only meaningful with a daily time set, so this
// no-ops with a hint when atTime is empty.
async function editDays(work: WorkSchedule, title: string): Promise<void> {
  if (!work.atTime) {
    vscode.window.showInformationMessage(l10n("schedule.days.needsTime"));
    return;
  }
  interface DayItem extends vscode.QuickPickItem {
    day?: number;
    shortcut?: "weekdays" | "weekends";
  }
  const current = new Set(work.days ?? []);
  const dayItems: DayItem[] = WEEKDAY_LABELS.map((label, day) => ({
    label,
    day,
    picked: current.has(day),
  }));
  const items: DayItem[] = [
    { label: l10n("schedule.days.shortcut.weekdays"), shortcut: "weekdays" },
    { label: l10n("schedule.days.shortcut.weekends"), shortcut: "weekends" },
    {
      label: l10n("schedule.days.individualSeparator"),
      kind: vscode.QuickPickItemKind.Separator,
    },
    ...dayItems,
  ];

  const picks = await vscode.window.showQuickPick(items, {
    canPickMany: true,
    title,
    placeHolder: l10n("schedule.days.placeholder"),
  });
  if (picks === undefined) {
    return;
  }
  // A shortcut row, if chosen, overrides the individual day ticks — picking
  // "Weekdays" means Mon-Fri regardless of which day boxes were also ticked.
  if (picks.some((p) => p.shortcut === "weekdays")) {
    work.days = [1, 2, 3, 4, 5];
    return;
  }
  if (picks.some((p) => p.shortcut === "weekends")) {
    work.days = [0, 6];
    return;
  }
  const chosen = picks
    .map((p) => p.day)
    .filter((d): d is number => d !== undefined);
  // Empty or all-seven both mean "every day"; store undefined for that.
  work.days = chosen.length > 0 && chosen.length < 7 ? chosen : undefined;
}

async function editInterval(work: WorkSchedule, title: string): Promise<void> {
  interface IntervalItem extends vscode.QuickPickItem {
    // undefined value + clear flag distinguishes "no interval" from a custom prompt.
    minutes?: number;
    action: "set" | "clear" | "custom";
  }
  const presets: Array<{ minutes: number }> = [
    { minutes: 5 },
    { minutes: 15 },
    { minutes: 30 },
    { minutes: 60 },
    { minutes: 60 * 6 },
    { minutes: 60 * 12 },
    { minutes: 60 * 24 },
  ];
  const items: IntervalItem[] = [
    { label: l10n("schedule.interval.clear"), action: "clear" },
    ...presets.map((p) => ({
      label: describeInterval(p.minutes * 60_000),
      minutes: p.minutes,
      action: "set" as const,
    })),
    { label: l10n("schedule.interval.custom"), action: "custom" },
  ];

  const pick = await vscode.window.showQuickPick(items, {
    title,
    placeHolder: l10n("schedule.interval.placeholder"),
  });
  if (!pick) {
    return;
  }
  if (pick.action === "clear") {
    work.everyMs = undefined;
    return;
  }
  if (pick.action === "custom") {
    await editCustomInterval(work, title);
    return;
  }
  if (pick.minutes !== undefined) {
    work.everyMs = pick.minutes * 60_000;
  }
}

// Custom interval: pick a unit (minutes / hours / days), then a count. A unit-aware
// flow lets "every 3 days" be entered as 3 + days instead of 4320 minutes, while the
// stored value stays a single everyMs so the schedule math has one source of truth.
async function editCustomInterval(
  work: WorkSchedule,
  title: string
): Promise<void> {
  interface UnitItem extends vscode.QuickPickItem {
    unitMs: number;
  }
  const units: UnitItem[] = [
    { label: l10n("schedule.unit.minutes"), unitMs: 60_000 },
    { label: l10n("schedule.unit.hours"), unitMs: 60 * 60_000 },
    { label: l10n("schedule.unit.days"), unitMs: 24 * 60 * 60_000 },
  ];
  const unit = await vscode.window.showQuickPick(units, {
    title,
    placeHolder: l10n("schedule.unit.placeholder"),
  });
  if (!unit) {
    return;
  }
  const entered = await vscode.window.showInputBox({
    title,
    prompt: l10n("schedule.interval.customPrompt"),
    validateInput: (input) => {
      const count = Number(input.trim());
      if (!Number.isInteger(count) || count <= 0) {
        return l10n("schedule.interval.invalid");
      }
      return undefined;
    },
  });
  if (entered === undefined) {
    return;
  }
  work.everyMs = Number(entered.trim()) * unit.unitMs;
}

// Friendly cron builder. The user composes a common schedule from presets (some
// of which prompt for a time or weekday); the cron string is emitted under the
// hood, so raw cron is only ever typed via the explicit "advanced" path. Every
// path stores a cron string already validated by parseCron, so a built schedule
// can never be malformed (acceptance: the builder produces valid schedules).
async function editCron(work: WorkSchedule, title: string): Promise<void> {
  interface CronItem extends vscode.QuickPickItem {
    action:
      | "clear"
      | "weekdayAt" // every weekday (Mon-Fri) at a chosen time
      | "dailyAt" // every day at a chosen time
      | "weeklyAt" // a chosen weekday each week at a chosen time
      | "monthlyAt" // the 1st of each month at a chosen time
      | "workHours" // every N minutes during Mon-Fri 09:00-17:00
      | "hourly" // top of every hour
      | "advanced"; // type a raw cron expression
  }
  const items: CronItem[] = [
    { label: l10n("schedule.cron.clear"), action: "clear" },
    { label: l10n("schedule.cron.preset.weekdayAt"), action: "weekdayAt" },
    { label: l10n("schedule.cron.preset.dailyAt"), action: "dailyAt" },
    { label: l10n("schedule.cron.preset.weeklyAt"), action: "weeklyAt" },
    { label: l10n("schedule.cron.preset.monthlyAt"), action: "monthlyAt" },
    { label: l10n("schedule.cron.preset.workHours"), action: "workHours" },
    { label: l10n("schedule.cron.preset.hourly"), action: "hourly" },
    {
      label: l10n("schedule.cron.advanced"),
      detail: work.cron,
      action: "advanced",
    },
  ];

  const pick = await vscode.window.showQuickPick(items, {
    title,
    placeHolder: l10n("schedule.cron.placeholder"),
  });
  if (!pick) {
    return;
  }
  switch (pick.action) {
    case "clear":
      work.cron = undefined;
      return;
    case "hourly":
      work.cron = "0 * * * *";
      return;
    case "advanced":
      await editCronAdvanced(work, title);
      return;
    case "workHours":
      await editCronWorkHours(work, title);
      return;
    case "weekdayAt":
      await composeCronAtTime(work, title, (h, m) => `${m} ${h} * * 1-5`);
      return;
    case "dailyAt":
      await composeCronAtTime(work, title, (h, m) => `${m} ${h} * * *`);
      return;
    case "monthlyAt":
      await composeCronAtTime(work, title, (h, m) => `${m} ${h} 1 * *`);
      return;
    case "weeklyAt":
      await editCronWeekly(work, title);
      return;
  }
}

// Prompt for a daily time and store the cron the `build` callback derives from its
// hour/minute. Shared by the "every weekday", "every day", and "1st of the month"
// presets — they differ only in the cron's day fields.
async function composeCronAtTime(
  work: WorkSchedule,
  title: string,
  build: (hour: number, minute: number) => string
): Promise<void> {
  const time = await promptCronTime(work, title);
  if (!time) {
    return;
  }
  work.cron = build(time.hour, time.minute);
}

// "On a weekday each week at a time": pick the weekday, then the time.
async function editCronWeekly(work: WorkSchedule, title: string): Promise<void> {
  interface DayItem extends vscode.QuickPickItem {
    day: number;
  }
  const dayItems: DayItem[] = WEEKDAY_LABELS.map((label, day) => ({ label, day }));
  const dayPick = await vscode.window.showQuickPick(dayItems, {
    title,
    placeHolder: l10n("schedule.cron.weekdayPlaceholder"),
  });
  if (!dayPick) {
    return;
  }
  const time = await promptCronTime(work, title);
  if (!time) {
    return;
  }
  work.cron = `${time.minute} ${time.hour} * * ${dayPick.day}`;
}

// "Every N minutes during work hours" (Mon-Fri 09:00-17:00): pick the cadence.
async function editCronWorkHours(work: WorkSchedule, title: string): Promise<void> {
  interface StepItem extends vscode.QuickPickItem {
    minutes: number;
  }
  const steps: StepItem[] = [15, 20, 30, 60].map((minutes) => ({
    label: l10n("schedule.interval.everyMinutes", { count: minutes }),
    minutes,
  }));
  const pick = await vscode.window.showQuickPick(steps, {
    title,
    placeHolder: l10n("schedule.cron.workHoursPlaceholder"),
  });
  if (!pick) {
    return;
  }
  // Hourly cadence is "0" minutes within 9-17; sub-hourly is "*/N".
  const minuteField = pick.minutes >= 60 ? "0" : `*/${pick.minutes}`;
  work.cron = `${minuteField} 9-17 * * 1-5`;
}

// The "advanced" path: type a raw 5-field cron expression, validated live by
// parseCron so an invalid expression cannot be saved. Empty clears the cron.
async function editCronAdvanced(work: WorkSchedule, title: string): Promise<void> {
  const value = await vscode.window.showInputBox({
    title,
    prompt: l10n("schedule.cron.advancedPrompt"),
    placeHolder: l10n("schedule.cron.advancedPlaceholder"),
    value: work.cron ?? "",
    validateInput: (input) => {
      const trimmed = input.trim();
      if (trimmed === "") {
        return undefined; // empty clears the cron
      }
      return parseCron(trimmed) ? undefined : l10n("schedule.cron.invalid");
    },
  });
  if (value === undefined) {
    return;
  }
  work.cron = value.trim() === "" ? undefined : value.trim();
}

// Shared HH:mm prompt for the cron builder presets. Returns the parsed hour/minute,
// or undefined when the user cancels. Defaults to the schedule's existing daily
// time if one is set, so building a cron near an existing time is one keystroke.
async function promptCronTime(
  work: WorkSchedule,
  title: string
): Promise<{ hour: number; minute: number } | undefined> {
  const value = await vscode.window.showInputBox({
    title,
    prompt: l10n("schedule.cron.timePrompt"),
    placeHolder: l10n("schedule.atTime.placeholder"),
    value: work.atTime ?? "",
    validateInput: (input) =>
      parseHourMinute(input.trim()) ? undefined : l10n("schedule.atTime.invalid"),
  });
  if (value === undefined) {
    return undefined;
  }
  return parseHourMinute(value.trim());
}

// Human-readable interval label from a millisecond span (e.g. "Every 15 minutes",
// "Every 6 hours", "Every 2 days"). Whole-day spans render in days, whole-hour spans
// in hours, otherwise minutes — the coarsest exact unit.
function describeInterval(everyMs: number): string {
  const minutes = Math.round(everyMs / 60_000);
  if (minutes % (60 * 24) === 0) {
    return l10n("schedule.interval.everyDays", { count: minutes / (60 * 24) });
  }
  if (minutes % 60 === 0) {
    return l10n("schedule.interval.everyHours", { count: minutes / 60 });
  }
  return l10n("schedule.interval.everyMinutes", { count: minutes });
}
