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
