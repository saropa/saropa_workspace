import * as vscode from "vscode";
import { asStartupMode } from "../board/sidebar";
import { checkboxValue, isStartupOn, modeToRemember, planStartupWrite } from "../board/startupToggle";

// The "Open this board at start-up" checkbox: reads and writes openOnStartup. The page sends
// a boolean only; the mode written is worked out here.

const SETTINGS = "saropaWorkspace.releaseBoard";
const REMEMBER_KEY = "saropaWorkspace.releaseBoard.lastStartupMode";

function currentMode(): string {
  return vscode.workspace.getConfiguration(SETTINGS).get<string>("openOnStartup", "whenProjectsFound");
}

// True when the setting is anything but "never". Also remembers the mode while it is not "never",
// so a later check restores it even when the setting was changed in Settings.
export function startupOn(context: vscode.ExtensionContext): boolean {
  const raw = currentMode();
  const keep = modeToRemember(raw);
  if (keep && context.workspaceState.get(REMEMBER_KEY) !== keep) {
    void context.workspaceState.update(REMEMBER_KEY, keep);
  }
  return isStartupOn(asStartupMode(raw));
}

// Writes the setting for a checkbox value from the page. Returns false, writing nothing, when the
// value is not a boolean.
export async function setStartup(context: vscode.ExtensionContext, value: unknown): Promise<boolean> {
  const checked = checkboxValue(value);
  if (checked === undefined) {
    return false;
  }
  const config = vscode.workspace.getConfiguration(SETTINGS);
  const inspected = config.inspect("openOnStartup");
  const plan = planStartupWrite(checked, currentMode(), context.workspaceState.get(REMEMBER_KEY), inspected?.globalValue);
  if (plan.remember) {
    await context.workspaceState.update(REMEMBER_KEY, plan.remember);
  }
  await config.update("openOnStartup", plan.mode, vscode.ConfigurationTarget.Global);
  // A value set for this workspace would win over the user value; keep the box honest.
  if (inspected?.workspaceValue !== undefined) {
    await config.update("openOnStartup", plan.mode, vscode.ConfigurationTarget.Workspace);
  }
  return true;
}
