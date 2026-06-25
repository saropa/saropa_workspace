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
    everyMs: work.everyMs,
    enabled: work.enabled,
    lastRun: work.lastRun,
  };
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
    const entered = await vscode.window.showInputBox({
      title,
      prompt: l10n("schedule.interval.customPrompt"),
      value:
        work.everyMs !== undefined
          ? String(Math.round(work.everyMs / 60_000))
          : "",
      validateInput: (input) => {
        const minutes = Number(input.trim());
        if (!Number.isInteger(minutes) || minutes <= 0) {
          return l10n("schedule.interval.invalid");
        }
        return undefined;
      },
    });
    if (entered === undefined) {
      return;
    }
    work.everyMs = Number(entered.trim()) * 60_000;
    return;
  }
  if (pick.minutes !== undefined) {
    work.everyMs = pick.minutes * 60_000;
  }
}

// Human-readable interval label from a millisecond span (e.g. "Every 15 minutes",
// "Every 6 hours"). Whole-hour spans render in hours; otherwise minutes.
function describeInterval(everyMs: number): string {
  const minutes = Math.round(everyMs / 60_000);
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return l10n("schedule.interval.everyHours", { count: hours });
  }
  return l10n("schedule.interval.everyMinutes", { count: minutes });
}
