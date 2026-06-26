import * as vscode from "vscode";
import { Pin } from "../model/pin";
import { PinStore } from "../model/pinStore";
import { readCurrentBranch } from "../exec/gitBranch";
import { l10n } from "../i18n/l10n";

// Time-bomb / ephemeral pins (WOW #9) — the user-facing setup for Pin.expires.
// Three entry points: a wall-clock "Pin until..." preset picker, "Pin until branch
// changes" (bombs on the current git branch), and "Clear expiry" (defuse). All three
// gate out auto-pins, which are recomputed each refresh and so cannot carry stored
// state.

// The display name used in the confirmation toasts.
function pinName(pin: Pin): string {
  return pin.label ?? (pin.path.split("/").pop() ?? pin.path);
}

// Format an expiry instant for a toast: the local date + time the pin will vanish.
function formatInstant(at: number): string {
  return new Date(at).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// End of the given Date's local day (23:59), the natural "until end of" boundary so
// a pin set "until end of day / Friday" survives through that whole day.
function endOfDay(date: Date): number {
  const end = new Date(date);
  end.setHours(23, 59, 0, 0);
  return end.getTime();
}

interface PresetItem extends vscode.QuickPickItem {
  // The computed expiry instant, or "custom" to prompt for a date/time.
  at?: number;
  custom?: boolean;
}

// Build the preset list at the moment the picker opens, so each instant is relative
// to "now" (an "in 1 hour" preset must not be a stale value computed at load time).
function buildPresets(): PresetItem[] {
  const now = new Date();
  const hour = 60 * 60_000;

  // Days until the upcoming Friday (5 = Friday in Date.getDay()'s Sun..Sat). 0 keeps
  // "Friday" meaning today when it is already Friday — end of today is still useful.
  const daysToFriday = (5 - now.getDay() + 7) % 7;
  const friday = new Date(now);
  friday.setDate(now.getDate() + daysToFriday);

  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);

  const presets: PresetItem[] = [
    { label: l10n("expiry.preset.hour"), at: now.getTime() + hour },
    { label: l10n("expiry.preset.endOfDay"), at: endOfDay(now) },
    { label: l10n("expiry.preset.tomorrow"), at: endOfDay(tomorrow) },
    { label: l10n("expiry.preset.friday"), at: endOfDay(friday) },
    { label: l10n("expiry.preset.custom"), custom: true },
  ];
  // Annotate each concrete preset with the exact instant it resolves to, so the row
  // shows "in 1 hour … Jun 25, 3:40 PM" rather than a bare label.
  for (const preset of presets) {
    if (preset.at !== undefined) {
      preset.description = formatInstant(preset.at);
    }
  }
  return presets;
}

// Parse a hand-entered "YYYY-MM-DD HH:mm" (time optional, defaults to end of day) as
// a LOCAL instant. Returns undefined for anything that does not parse to a real
// calendar date, so the input box can reject it inline. Built field-by-field rather
// than via Date.parse so the value is unambiguously local (Date.parse treats a bare
// date as UTC, which would shift the boundary by the timezone offset).
function parseCustom(input: string): number | undefined {
  const match = input
    .trim()
    .match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?$/);
  if (!match) {
    return undefined;
  }
  const [, y, mo, d, h, mi] = match;
  const year = Number(y);
  const month = Number(mo) - 1;
  const day = Number(d);
  const date =
    h !== undefined
      ? new Date(year, month, day, Number(h), Number(mi), 0, 0)
      : new Date(year, month, day, 23, 59, 0, 0);
  // Reject overflowed components (e.g. month 13, day 32 roll over silently).
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month ||
    date.getDate() !== day
  ) {
    return undefined;
  }
  return date.getTime();
}

async function promptCustom(): Promise<number | undefined> {
  const entered = await vscode.window.showInputBox({
    title: l10n("expiry.custom.title"),
    prompt: l10n("expiry.custom.prompt"),
    placeHolder: l10n("expiry.custom.placeholder"),
    validateInput: (value) =>
      value.trim() === "" || parseCustom(value) !== undefined
        ? undefined
        : l10n("expiry.custom.invalid"),
  });
  if (entered === undefined || entered.trim() === "") {
    return undefined;
  }
  return parseCustom(entered);
}

// "Pin until..." — set a wall-clock expiry from a preset (or a custom date/time).
// Preserves any existing branch condition: the two are independent, so setting a
// time must not silently drop an onBranchAway already on the pin.
export async function pinUntil(store: PinStore, pin: Pin): Promise<void> {
  if (pin.isAuto) {
    vscode.window.showWarningMessage(l10n("expiry.autoUnsupported"));
    return;
  }
  const name = pinName(pin);
  const pick = await vscode.window.showQuickPick(buildPresets(), {
    title: l10n("expiry.pick.title", { name }),
    placeHolder: l10n("expiry.pick.placeholder"),
  });
  if (!pick) {
    return;
  }
  const at = pick.custom ? await promptCustom() : pick.at;
  if (at === undefined) {
    return;
  }
  await store.setPinExpiry(pin, { ...pin.expires, at });
  vscode.window.showInformationMessage(
    l10n("expiry.set", { name, when: formatInstant(at) })
  );
}

// "Pin until branch changes" — bomb the pin on the current git branch of its owning
// folder (or the first workspace folder for a global pin). Preserves any existing
// wall-clock condition. Warns instead of guessing when no repo / branch is readable,
// so the pin is never given a condition that can never be evaluated.
export async function pinUntilBranchChange(
  store: PinStore,
  pin: Pin
): Promise<void> {
  if (pin.isAuto) {
    vscode.window.showWarningMessage(l10n("expiry.autoUnsupported"));
    return;
  }
  const name = pinName(pin);
  const folder = store.folderOf(pin) ?? vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    vscode.window.showWarningMessage(l10n("expiry.noRepo", { name }));
    return;
  }
  const branch = await readCurrentBranch(folder);
  if (!branch) {
    vscode.window.showWarningMessage(l10n("expiry.noBranch", { name }));
    return;
  }
  await store.setPinExpiry(pin, { ...pin.expires, onBranchAway: branch });
  vscode.window.showInformationMessage(
    l10n("expiry.branchSet", { name, branch })
  );
}

// "Clear expiry" — defuse the bomb. A no-op-with-feedback when nothing was set, so
// the action (which is shown on every stored pin) reads clearly either way.
export async function clearPinExpiry(store: PinStore, pin: Pin): Promise<void> {
  const name = pinName(pin);
  if (!pin.expires) {
    vscode.window.showInformationMessage(l10n("expiry.noneSet", { name }));
    return;
  }
  await store.setPinExpiry(pin, undefined);
  vscode.window.showInformationMessage(l10n("expiry.cleared", { name }));
}
