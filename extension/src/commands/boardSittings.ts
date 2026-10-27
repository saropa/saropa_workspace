import * as vscode from "vscode";
import { TimeBox, asTimeBox } from "../board/sittings";

// Release Board, Sittings: the settings and the remembered choice. The choice (what the
// owner has in hand, the time box) is kept per machine in extension storage.

const KEY = "releaseBoard.sittings.choice";

// The Sittings settings, already clamped.
export interface SittingsSettings {
  enabled: boolean;
  defaultHave: string[];
  defaultTimeBox: TimeBox;
  maxSteps: number;
  onlyOwnerDocuments: boolean;
}

// What the owner last chose on the board: what is in hand and the time box.
export interface SittingsChoice {
  have: string[];
  timeBox: TimeBox;
}

// Reads the Sittings settings; a bad value falls back to its default.
export function readSittingsSettings(): SittingsSettings {
  const c = vscode.workspace.getConfiguration("saropaWorkspace.releaseBoard.sittings");
  const have = c.get<unknown>("defaultHave", []);
  const max = Number(c.get<number>("maxSteps", 25));
  return {
    enabled: c.get<boolean>("enabled", true),
    defaultHave: Array.isArray(have) ? have.filter((x): x is string => typeof x === "string") : [],
    defaultTimeBox: asTimeBox(c.get<string>("defaultTimeBox", "any")),
    maxSteps: Number.isFinite(max) ? Math.min(100, Math.max(5, Math.round(max))) : 25,
    onlyOwnerDocuments: c.get<boolean>("onlyOwnerDocuments", true),
  };
}

// The last choice made on the board, or undefined when none was made on this machine.
export function readSittingsChoice(context: vscode.ExtensionContext): SittingsChoice | undefined {
  const v = context.globalState.get<{ have?: unknown; timeBox?: unknown }>(KEY);
  if (!v || !Array.isArray(v.have)) {
    return undefined;
  }
  return { have: v.have.filter((x): x is string => typeof x === "string"), timeBox: asTimeBox(v.timeBox) };
}

// Remembers the choice on this machine.
export async function saveSittingsChoice(context: vscode.ExtensionContext, choice: SittingsChoice): Promise<void> {
  await context.globalState.update(KEY, choice);
}
