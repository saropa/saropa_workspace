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
// file / url / command / shell pins and sequences to macros). sabitovvt can also
// keep its items in a custom JSON file the `favoritesPanel.configPath[ForWorkspace]`
// settings point at; those file items are imported with the same mapping.

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
// Shown as the source name for the sabitovvt settings-key import in toasts/logs.
const SABITOVVT_SOURCE_LABEL = "favoritesPanel.commands";

// The sabitovvt "Favorites Panel" custom-file settings keys: each holds a path to
// a JSON file carrying the same command-dispatch items as the settings keys above
// (a global file and a per-workspace file).
const SABITOVVT_CONFIG_PATH_KEYS = [
  "favoritesPanel.configPath",
  "favoritesPanel.configPathForWorkspace",
] as const;
// Shown as the source name for the custom-file sabitovvt import in toasts/logs.
const SABITOVVT_CONFIG_SOURCE_LABEL = "favoritesPanel.configPath";

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
//
// The same items can also live in a custom JSON file pointed at by the
// `favoritesPanel.configPath` / `favoritesPanel.configPathForWorkspace` settings.
// That file is either a top-level array of items (sabitovvt v1.4.0+) or the legacy
// object wrapper `{ "favoritesPanel.commands": [ ... ] }` (pre-1.3.0); both shapes
// are accepted and mapped identically to the settings-key items.

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

// A well-formed, importable sabitovvt item: a labeled entry that carries either a
// command (single dispatch) or a sequence (a macro). Shared by the count and the
// import so the "is there anything here" gate and the importer agree on what counts.
function isImportableSabitovvtItem(i: unknown): i is SabitovvtItem {
  return (
    !!i &&
    typeof i === "object" &&
    typeof (i as SabitovvtItem).label === "string" &&
    ((i as SabitovvtItem).command !== undefined ||
      Array.isArray((i as SabitovvtItem).sequence))
  );
}

// Read every sabitovvt item from a custom config file the configPath settings point
// at. The file is a top-level array (v1.4.0+) or the legacy
// `{ "favoritesPanel.commands": [...] }` object (pre-1.3.0); both are accepted. A
// missing file is the normal "setting points at a not-yet-created file" state and
// contributes nothing; a malformed file is reported (when a channel is given) and
// contributes nothing. An absolute path is read as-is; a relative one resolves
// against the first workspace folder (the global file is typically absolute).
async function readSabitovvtConfigFileItems(
  channel?: vscode.OutputChannel
): Promise<SabitovvtItem[]> {
  const config = vscode.workspace.getConfiguration();
  const firstFolder = vscode.workspace.workspaceFolders?.[0];
  const items: SabitovvtItem[] = [];
  for (const key of SABITOVVT_CONFIG_PATH_KEYS) {
    const raw = config.get<unknown>(key);
    if (typeof raw !== "string" || raw.trim().length === 0) {
      continue;
    }
    const value = raw.trim();
    let uri: vscode.Uri;
    if (path.isAbsolute(value)) {
      uri = vscode.Uri.file(value);
    } else if (firstFolder) {
      uri = vscode.Uri.joinPath(firstFolder.uri, value);
    } else {
      continue; // A relative path with no folder open cannot be resolved.
    }
    let bytes: Uint8Array;
    try {
      bytes = await vscode.workspace.fs.readFile(uri);
    } catch {
      continue; // Pointed-at file not present yet; import nothing from it.
    }
    try {
      const parsed: unknown = JSON.parse(Buffer.from(bytes).toString("utf8"));
      // Both file shapes: a bare array, or the legacy object keyed by the same
      // settings name. Anything else yields no items.
      if (Array.isArray(parsed)) {
        items.push(...(parsed as SabitovvtItem[]));
      } else if (parsed && typeof parsed === "object") {
        const wrapped = (parsed as Record<string, unknown>)[SABITOVVT_SOURCE_LABEL];
        if (Array.isArray(wrapped)) {
          items.push(...(wrapped as SabitovvtItem[]));
        }
      }
    } catch (err) {
      channel?.appendLine(
        l10n("import.log.malformed", {
          file: value,
          error: err instanceof Error ? err.message : String(err),
        })
      );
    }
  }
  return items;
}

// How many importable sabitovvt items exist right now across the two settings keys
// AND any custom config file the configPath settings point at. Async because the
// custom-file count requires reading those files. Used by the command to decide
// whether there is anything to import.
export async function detectSabitovvtFavoritesCount(): Promise<number> {
  const config = vscode.workspace.getConfiguration();
  const items: SabitovvtItem[] = [];
  for (const key of SABITOVVT_SETTINGS_KEYS) {
    const arr = config.get<unknown>(key);
    if (Array.isArray(arr)) {
      items.push(...(arr as SabitovvtItem[]));
    }
  }
  items.push(...(await readSabitovvtConfigFileItems()));
  return items.filter(isImportableSabitovvtItem).length;
}

// Import one list of sabitovvt items (from a settings key or a custom config file)
// as project pins. File items go through addPin (folder-relative, deduped); non-file
// items go through importPin with an action, deduped via the shared `seenActions`
// signature set so a duplicate listed in more than one source is collapsed.
// Unmappable/malformed items are logged against `sourceLabel` and skipped. The
// caller owns `seenActions` so dedup spans every source in one import run.
async function importSabitovvtItemList(
  items: readonly SabitovvtItem[],
  sourceLabel: string,
  folder: vscode.WorkspaceFolder | undefined,
  store: PinStore,
  channel: vscode.OutputChannel,
  seenActions: Set<string>
): Promise<ImportResult> {
  let added = 0;
  let skipped = 0;
  for (const raw of items) {
    const label = typeof raw.label === "string" ? raw.label.trim() : "";
    if (label.length === 0) {
      channel.appendLine(l10n("import.log.skipSetting", { key: sourceLabel }));
      skipped++;
      continue;
    }
    const mapped = mapSabitovvtItem(raw, folder);
    if (mapped === "skip") {
      channel.appendLine(
        l10n("import.log.skipUnsupported", { file: sourceLabel, name: label })
      );
      skipped++;
      continue;
    }
    if ("file" in mapped) {
      // A file outside the workspace folder cannot be a project pin.
      if (!vscode.workspace.getWorkspaceFolder(mapped.file)) {
        channel.appendLine(
          l10n("import.log.skipOutsideFolder", {
            file: sourceLabel,
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
  return { added, skipped };
}

// sabitovvt "Favorites Panel": import the command-dispatch items from both settings
// keys AND any custom config file the configPath settings point at, as project pins.
// All sources share one `seenActions` set so an action listed in more than one of
// them imports once. Unmappable items are logged and skipped.
export async function importSabitovvtFavorites(
  store: PinStore
): Promise<ImportResult> {
  const channel = getOutputChannel();
  const config = vscode.workspace.getConfiguration();
  const folder = vscode.workspace.workspaceFolders?.[0];
  // Seed action-pin dedup from existing project pins; add to it as we import so a
  // duplicate listed across sources is also collapsed.
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
    const result = await importSabitovvtItemList(
      items as SabitovvtItem[],
      SABITOVVT_SOURCE_LABEL,
      folder,
      store,
      channel,
      seenActions
    );
    added += result.added;
    skipped += result.skipped;
  }

  // Custom-file variant: items kept in the JSON file the configPath settings name.
  const fileItems = await readSabitovvtConfigFileItems(channel);
  if (fileItems.length > 0) {
    const result = await importSabitovvtItemList(
      fileItems,
      SABITOVVT_CONFIG_SOURCE_LABEL,
      folder,
      store,
      channel,
      seenActions
    );
    added += result.added;
    skipped += result.skipped;
  }

  return { added, skipped };
}
