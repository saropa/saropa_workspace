import * as path from "path";
import * as vscode from "vscode";
import { PinStore } from "../model/pinStore";
import { PinAction, MacroStep } from "../model/pin";
import { getOutputChannel } from "../exec/runner";
import { l10n } from "../i18n/l10n";
import type { ImportResult } from "./favoritesImport";

// The settings-key favorites importers (no file on disk): howardzuo "favorites"
// (`favorites.resources`, an array of paths) and sabitovvt "Favorites Panel"
// (`favoritesPanel.commands[ForWorkspace]`, command-dispatch items mapping to
// file / url / command / shell pins and sequences to macros).

// The howardzuo "favorites" extension stores its files under this settings key.
const HOWARDZUO_SETTINGS_KEY = "favorites.resources";
// Shown as the source name for the settings-key import in toasts and the log.
const HOWARDZUO_SOURCE_LABEL = "favorites.resources";

// The sabitovvt "Favorites Panel" settings keys: a global list and a
// per-workspace list, both arrays of command-dispatch items.
const SABITOVVT_SETTINGS_KEYS = [
  "favoritesPanel.commands",
  "favoritesPanel.commandsForWorkspace",
] as const;
// Shown as the source name for the sabitovvt import in toasts and the log.
const SABITOVVT_SOURCE_LABEL = "favoritesPanel.commands";

// How many importable entries the howardzuo `favorites.resources` settings key
// holds right now (string paths only). Used by the command to decide whether
// there is anything to import when no favorites FILE is present.
export function detectSettingsFavoritesCount(): number {
  const resources = vscode.workspace
    .getConfiguration()
    .get<unknown>(HOWARDZUO_SETTINGS_KEY);
  if (!Array.isArray(resources)) {
    return 0;
  }
  return resources.filter((r) => typeof r === "string" && r.trim().length > 0)
    .length;
}

// howardzuo `favorites.resources`: an array of paths read from the active
// configuration. Non-string or blank entries are reported and skipped; an
// absolute path is used as-is, a relative one resolves against the first
// workspace folder (the configuration is workspace-wide, not per-folder).
export async function importSettingsFavorites(
  store: PinStore
): Promise<ImportResult> {
  const channel = getOutputChannel();
  const resources = vscode.workspace
    .getConfiguration()
    .get<unknown>(HOWARDZUO_SETTINGS_KEY);
  if (!Array.isArray(resources)) {
    return { added: 0, skipped: 0 };
  }
  const firstFolder = vscode.workspace.workspaceFolders?.[0];
  let added = 0;
  let skipped = 0;
  for (const resource of resources) {
    if (typeof resource !== "string" || resource.trim().length === 0) {
      channel.appendLine(l10n("import.log.skipSetting", { key: HOWARDZUO_SOURCE_LABEL }));
      skipped++;
      continue;
    }
    const value = resource.trim();
    let uri: vscode.Uri;
    if (path.isAbsolute(value)) {
      uri = vscode.Uri.file(value);
    } else if (firstFolder) {
      uri = vscode.Uri.joinPath(firstFolder.uri, value);
    } else {
      // A relative path with no folder open cannot be resolved; report and skip.
      channel.appendLine(
        l10n("import.log.skipUnresolved", { key: HOWARDZUO_SOURCE_LABEL, path: value })
      );
      skipped++;
      continue;
    }
    if (await store.addPin(uri, "project")) {
      added++;
    }
  }
  return { added, skipped };
}

// --- sabitovvt "Favorites Panel" -----------------------------------------
//
// This extension stores command-dispatch items (not plain paths) in two settings
// keys. Each item is `{ label, icon?, iconColor?, command, arguments[] }` or a
// `{ label, sequence: [...] }`. The `command` value selects the action:
//   - "openFile"   -> a FILE pin on arguments[0] (resolved against the folder).
//   - "run"        -> a SHELL pin running arguments[0] (a program/terminal line).
//   - "runCommand" with arguments[0] === "vscode.open" -> a URL pin on arguments[1].
//   - "runCommand" otherwise -> a COMMAND pin on arguments[0] (commandId) + rest.
//   - a "sequence" -> a MACRO pin, one step per command, when EVERY step maps.
//   - "insertNewCode" / unknown / an unmappable sequence -> reported and skipped
//     (the pin model has no insert-code action, so importing it would lose data).
// The item's `icon` (a codicon id) and `iconColor` (a ThemeColor id) line up with
// the pin model's icon/color, so they are carried over for action pins.

interface SabitovvtItem {
  label?: string;
  icon?: string;
  iconColor?: string;
  command?: string;
  arguments?: unknown[];
  sequence?: { command?: string; arguments?: unknown[] }[];
}

// A non-empty string at args[i], or undefined. Used to validate the dispatch
// arguments before building a pin from them.
function argString(args: unknown[] | undefined, i: number): string | undefined {
  const v = args?.[i];
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined;
}

// Map one (command, arguments) pair to a single macro step, or null when the
// command has no step equivalent. Shared by the top-level sequence mapping.
function mapSabitovvtStep(
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

// Map one top-level sabitovvt item to either a file URI (handled via addPin, so
// the relative path and dedup stay the store's job) or a non-file PinAction.
// Returns "skip" for anything with no lossless pin equivalent.
function mapSabitovvtItem(
  item: SabitovvtItem,
  folder: vscode.WorkspaceFolder | undefined
): { file: vscode.Uri } | { action: PinAction } | "skip" {
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

// A stable signature for an action pin (label + action), used to make the
// sabitovvt import idempotent: importPin always adds, so the dedup lives here.
function actionSignature(label: string | undefined, action: PinAction): string {
  return JSON.stringify({ label: label ?? "", action });
}

// How many importable sabitovvt items the two settings keys hold right now. Used
// by the command to decide whether there is anything to import.
export function detectSabitovvtFavoritesCount(): number {
  const config = vscode.workspace.getConfiguration();
  let count = 0;
  for (const key of SABITOVVT_SETTINGS_KEYS) {
    const items = config.get<unknown>(key);
    if (!Array.isArray(items)) {
      continue;
    }
    count += items.filter(
      (i): i is SabitovvtItem =>
        !!i &&
        typeof i === "object" &&
        typeof (i as SabitovvtItem).label === "string" &&
        ((i as SabitovvtItem).command !== undefined ||
          Array.isArray((i as SabitovvtItem).sequence))
    ).length;
  }
  return count;
}

// sabitovvt "Favorites Panel": import the command-dispatch items from both
// settings keys as project pins. File items go through addPin (folder-relative,
// deduped); non-file items go through importPin with an action, deduped here by
// signature so a re-run adds nothing new. Unmappable items are logged and skipped.
export async function importSabitovvtFavorites(
  store: PinStore
): Promise<ImportResult> {
  const channel = getOutputChannel();
  const config = vscode.workspace.getConfiguration();
  const folder = vscode.workspace.workspaceFolders?.[0];
  // Seed action-pin dedup from existing project pins; add to it as we import so a
  // duplicate listed in both settings keys is also collapsed.
  const seenActions = new Set(
    store
      .getProjectPins()
      .filter((p) => p.action)
      .map((p) => actionSignature(p.label, p.action as PinAction))
  );

  let added = 0;
  let skipped = 0;
  for (const key of SABITOVVT_SETTINGS_KEYS) {
    const items = config.get<unknown>(key);
    if (!Array.isArray(items)) {
      continue;
    }
    for (const raw of items as SabitovvtItem[]) {
      const label = typeof raw.label === "string" ? raw.label.trim() : "";
      if (label.length === 0) {
        channel.appendLine(l10n("import.log.skipSetting", { key: SABITOVVT_SOURCE_LABEL }));
        skipped++;
        continue;
      }
      const mapped = mapSabitovvtItem(raw, folder);
      if (mapped === "skip") {
        channel.appendLine(
          l10n("import.log.skipUnsupported", { file: SABITOVVT_SOURCE_LABEL, name: label })
        );
        skipped++;
        continue;
      }
      if ("file" in mapped) {
        // A file outside the workspace folder cannot be a project pin.
        if (!vscode.workspace.getWorkspaceFolder(mapped.file)) {
          channel.appendLine(
            l10n("import.log.skipOutsideFolder", {
              file: SABITOVVT_SOURCE_LABEL,
              path: mapped.file.fsPath,
            })
          );
          skipped++;
          continue;
        }
        if (await store.addPin(mapped.file, "project", label)) {
          added++;
        }
        continue;
      }
      // Action pin: dedup by signature, then import carrying icon/color when set.
      const sig = actionSignature(label, mapped.action);
      if (seenActions.has(sig)) {
        continue; // Already present — idempotent, not a reportable skip.
      }
      const icon = typeof raw.icon === "string" && raw.icon.trim() ? raw.icon.trim() : undefined;
      const color =
        typeof raw.iconColor === "string" && raw.iconColor.trim()
          ? raw.iconColor.trim()
          : undefined;
      // `v` is ignored by importPin (it reads only the pin fields); set to 1.
      if (await store.importPin({ v: 1, label, action: mapped.action, icon, color }, "project")) {
        seenActions.add(sig);
        added++;
      }
    }
  }
  return { added, skipped };
}
