import * as vscode from "vscode";
import { ShortcutSchedule } from "../model/shortcut";
import { RecipeResult } from "./detectors";

// Helpers shared by the scheduled-ritual recipes, kept apart so the git rituals and the main
// detector can both use them without importing each other.

// A daily schedule at a fixed time, seeded disabled (see the safety note in scheduledRecipes.ts).
export function daily(atTime: string): ShortcutSchedule {
  return { atTime, enabled: false };
}

// A shell action that captures a command's output to a dated report file.
export function report(
  folder: vscode.WorkspaceFolder,
  command: string,
  reportFile: string,
  autoOpen: boolean
): RecipeResult["action"] {
  return {
    kind: "shell",
    shellCommand: command,
    cwd: folder.uri.fsPath,
    reportFile,
    autoOpen,
  };
}
