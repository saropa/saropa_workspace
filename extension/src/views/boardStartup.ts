import * as vscode from "vscode";
import { asStartupMode } from "../board/sidebar";
import { checkboxValue, isStartupOn, modeForCheckbox, modeToRemember } from "../board/startupToggle";

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

// Writes the setting for a checkbox value from the page. A value that is not a boolean is ignored.
export async function setStartup(context: vscode.ExtensionContext, value: unknown): Promise<void> {
  const checked = checkboxValue(value);
  if (checked === undefined) {
    return;
  }
  const keep = modeToRemember(currentMode());
  if (keep) {
    await context.workspaceState.update(REMEMBER_KEY, keep);
  }
  const mode = modeForCheckbox(checked, context.workspaceState.get(REMEMBER_KEY));
  const config = vscode.workspace.getConfiguration(SETTINGS);
  await config.update("openOnStartup", mode, vscode.ConfigurationTarget.Global);
  // A value set for this workspace would win over the user value; keep the box honest.
  if (config.inspect("openOnStartup")?.workspaceValue !== undefined) {
    await config.update("openOnStartup", mode, vscode.ConfigurationTarget.Workspace);
  }
}
