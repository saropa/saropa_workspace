// Item mapping for the settings-based favorites import: the item shape, the type
// guard and the conversion of a favorites command or sequence to a shortcut action.
// Pure. Split out of favoritesSettings.ts.

import * as path from "path";
import * as vscode from "vscode";

import { ShortcutAction, MacroStep } from "../model/shortcut";

/** One entry of the sabitovvt favorites list: a label with a single command or a sequence of commands. */
export interface SabitovvtItem {
  label?: string;
  icon?: string;
  iconColor?: string;
  command?: string;
  arguments?: unknown[];
  sequence?: { command?: string; arguments?: unknown[] }[];
}

// A non-empty string at args[i], or undefined. Used to validate the dispatch
// arguments before building a shortcut from them.
export function argString(args: unknown[] | undefined, i: number): string | undefined {
  const v = args?.[i];
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined;
}

// Map one (command, arguments) pair to a single macro step, or null when the
// command has no step equivalent. Shared by the top-level sequence mapping.
export function mapSabitovvtStep(
  command: string | undefined,
  args: unknown[] | undefined
): MacroStep | null {
  if (command === "openFile") {
    const p = argString(args, 0);
    return p ? { kind: "open", path: p } : null;
  }
  if (command === "run") {
    const cmd = argString(args, 0);
    return cmd ? { kind: "shell", shellCommand: cmd } : null;
  }
  if (command === "runCommand") {
    const first = argString(args, 0);
    if (first === "vscode.open") {
      const url = argString(args, 1);
      return url ? { kind: "url", url } : null;
    }
    return first ? { kind: "command", commandId: first, commandArgs: args?.slice(1) } : null;
  }
  return null; // insertNewCode and unknown commands have no step equivalent.
}

// Map one top-level sabitovvt item to either a file URI (handled via addShortcut, so
// the relative path and dedup stay the store's job) or a non-file ShortcutAction.
// Returns "skip" for anything with no lossless shortcut equivalent.
export function mapSabitovvtItem(
  item: SabitovvtItem,
  folder: vscode.WorkspaceFolder | undefined
): { file: vscode.Uri } | { action: ShortcutAction } | "skip" {
  if (item.command === "openFile") {
    const p = argString(item.arguments, 0);
    if (!p || !folder) {
      return "skip";
    }
    return {
      file: path.isAbsolute(p)
        ? vscode.Uri.file(p)
        : vscode.Uri.joinPath(folder.uri, p),
    };
  }
  // A sequence becomes a macro only when every step maps; a single unmappable
  // step (e.g. insertNewCode) means importing it would silently drop a step.
  if (Array.isArray(item.sequence)) {
    const steps: MacroStep[] = [];
    for (const s of item.sequence) {
      const step = mapSabitovvtStep(s.command, s.arguments);
      if (!step) {
        return "skip";
      }
      steps.push(step);
    }
    return steps.length > 0 ? { action: { kind: "macro", steps } } : "skip";
  }
  // Non-file single commands reuse the step mapping, then wrap as an action.
  const step = mapSabitovvtStep(item.command, item.arguments);
  if (!step || step.kind === "open") {
    return "skip"; // a bare "open" step has no standalone non-file action.
  }
  if (step.kind === "shell") {
    return { action: { kind: "shell", shellCommand: step.shellCommand, useIntegratedTerminal: true } };
  }
  if (step.kind === "url") {
    return { action: { kind: "url", url: step.url } };
  }
  return { action: { kind: "command", commandId: step.commandId, commandArgs: step.commandArgs } };
}

// A stable signature for an action shortcut (label + action), used to make the
// sabitovvt import idempotent: importShortcut always adds, so the dedup lives here.
export function actionSignature(label: string | undefined, action: ShortcutAction): string {
  return JSON.stringify({ label: label ?? "", action });
}

// A well-formed, importable sabitovvt item: a labeled entry that carries either a
// command (single dispatch) or a sequence (a macro). Shared by the count and the
// import so the "is there anything here" gate and the importer agree on what counts.
export function isImportableSabitovvtItem(i: unknown): i is SabitovvtItem {
  return (
    !!i &&
    typeof i === "object" &&
    typeof (i as SabitovvtItem).label === "string" &&
    ((i as SabitovvtItem).command !== undefined ||
      Array.isArray((i as SabitovvtItem).sequence))
  );
}
