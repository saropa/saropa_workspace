import { StartupMode, asStartupMode } from "./sidebar";

// The "Open this board at start-up" checkbox of the board's top bar, as plain logic. The
// checkbox is on for every mode but "never". Pure: the host reads and writes the setting.

// The mode the box is checked back to when nothing better is remembered.
export const DEFAULT_STARTUP_MODE: Exclude<StartupMode, "never"> = "whenProjectsFound";

// True when the board opens by itself at start under this mode.
export function isStartupOn(mode: StartupMode): boolean {
  return mode !== "never";
}

// The mode worth remembering for checking the box again: a stored value that is a real
// opening mode, else the default.
export function rememberedMode(stored: unknown): Exclude<StartupMode, "never"> {
  return stored === "always" ? "always" : DEFAULT_STARTUP_MODE;
}

// The mode to write when the box is set to `checked`. Unchecking writes "never"; checking
// writes the remembered mode.
export function modeForCheckbox(checked: boolean, remembered: unknown): StartupMode {
  return checked ? rememberedMode(remembered) : "never";
}

// The opening mode to remember after a change, or undefined when the new mode is "never"
// (the earlier one is kept). Takes the raw setting value.
export function modeToRemember(raw: unknown): Exclude<StartupMode, "never"> | undefined {
  const mode = asStartupMode(raw);
  return mode === "never" ? undefined : mode;
}

// The checkbox value from a page message: only a real boolean counts.
export function checkboxValue(v: unknown): boolean | undefined {
  return typeof v === "boolean" ? v : undefined;
}

// What to write for a checkbox change. `remembered` is the stored last opening mode, `globalValue`
// the user-scope value of the setting, `current` the effective value. Checking with nothing
// remembered prefers a user-scope value that is not "never", so an "always" is never lowered.
export interface StartupPlan {
  // The opening mode to store before the write, or undefined to store nothing.
  remember: Exclude<StartupMode, "never"> | undefined;
  mode: StartupMode;
}

export function planStartupWrite(checked: boolean, current: unknown, remembered: unknown, globalValue: unknown): StartupPlan {
  const remember = modeToRemember(current);
  if (!checked) {
    return { remember, mode: "never" };
  }
  const kept = remember ?? (remembered === "always" || remembered === "whenProjectsFound" ? remembered : undefined);
  const fromUser = globalValue === "always" || globalValue === "whenProjectsFound" ? globalValue : undefined;
  return { remember, mode: kept ?? fromUser ?? DEFAULT_STARTUP_MODE };
}
