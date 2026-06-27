// The cron builder for the Quick schedule editor: the preset menu (every weekday / daily /
// weekly / monthly / work-hours / hourly / advanced) and the shared HH:mm prompt. Every
// path emits a cron string already validated by parseCron, so a built schedule can never be
// malformed. Split out of configureSchedule.ts to keep that file under the line cap; the
// dependency is one-way (configureSchedule imports editCron, never the reverse).
import * as vscode from "vscode";
import { parseHourMinute, parseCron } from "../exec/schedule";
import { WorkSchedule } from "./scheduleModel";
import { l10n } from "../i18n/l10n";

// Local weekday short names, Sunday-first to match Date.getDay()'s 0..6 indexing. Shared
// with configureSchedule's day-set summary and day picker, so it is exported from here.
export const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Friendly cron builder. The user composes a common schedule from presets (some
// of which prompt for a time or weekday); the cron string is emitted under the
// hood, so raw cron is only ever typed via the explicit "advanced" path. Every
// path stores a cron string already validated by parseCron, so a built schedule
// can never be malformed (acceptance: the builder produces valid schedules).
export async function editCron(work: WorkSchedule, title: string): Promise<void> {
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
