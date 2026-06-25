import * as vscode from "vscode";
import { Pin, PinSchedule } from "../model/pin";
import { PinStore } from "../model/pinStore";
import { parseHourMinute } from "../exec/schedule";
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
  id: "atTime" | "days" | "interval" | "enabled" | "save";
}

// Working shape: enabled is always present; the timing fields are optional.
interface WorkSchedule {
  atTime?: string;
  days?: number[];
  everyMs?: number;
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
    enabled: pin.schedule?.enabled ?? true,
    // Preserve the prior fire stamp so reopen de-dup survives an edit.
    lastRun: pin.schedule?.lastRun,
  };

  for (;;) {
    const choice = await showHub(work, title);
    if (!choice) {
      // Esc: discard, write nothing.
      return;
    }
    if (choice === "save") {
      break;
    }
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
      case "enabled":
        // Toggle directly from the hub for a snappy on/off.
        work.enabled = !work.enabled;
        break;
    }
  }

  await store.updatePinSchedule(pin, normalize(work));
  vscode.window.showInformationMessage(l10n("schedule.saved", { name }));
}

// A schedule with no timing fields would arm no timer; collapse it to undefined
// so the pin reads as "not scheduled" rather than carrying an inert object.
function normalize(work: WorkSchedule): PinSchedule | undefined {
  if (!work.atTime && work.everyMs === undefined) {
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

async function showHub(
  work: WorkSchedule,
  title: string
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

  const pick = await vscode.window.showQuickPick(items, {
    title,
    placeHolder: l10n("schedule.hubPlaceholder"),
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
