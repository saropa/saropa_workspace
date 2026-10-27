import * as path from "path";
import * as vscode from "vscode";
import { ShortcutStore } from "../model/shortcutStore";
import { ShortcutAction } from "../model/shortcut";
import { getOutputChannel } from "../exec/runner";
import { l10n } from "../i18n/l10n";
import type { ImportResult } from "./favoritesImport";
import type { SharedShortcut } from "./shareLink";
import {
  SabitovvtItem,
  mapSabitovvtItem,
  actionSignature,
  isImportableSabitovvtItem,
} from "./favoritesItemMap";

// The settings-key favorites importers (no file on disk): howardzuo "favorites"
// (`favorites.resources`, an array of paths) and sabitovvt "Favorites Panel"
// (`favoritesPanel.commands[ForWorkspace]`, command-dispatch items mapping to
// file / url / command / shell shortcuts and sequences to macros). sabitovvt can also
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
  store: ShortcutStore
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
    // autoGroup:false: an import reconstructs an existing list, so a file is not
    // re-sorted into a built-in default group (that would scramble the imported layout).
    if (await store.addShortcut(uri, "project", undefined, undefined, { autoGroup: false })) {
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
//   - "openFile"   -> a FILE shortcut on arguments[0] (resolved against the folder).
//   - "run"        -> a SHELL shortcut running arguments[0] (a program/terminal line).
//   - "runCommand" with arguments[0] === "vscode.open" -> a URL shortcut on arguments[1].
//   - "runCommand" otherwise -> a COMMAND shortcut on arguments[0] (commandId) + rest.
//   - a "sequence" -> a MACRO shortcut, one step per command, when EVERY step maps.
//   - "insertNewCode" / unknown / an unmappable sequence -> reported and skipped
//     (the shortcut model has no insert-code action, so importing it would lose data).
// The item's `icon` (a codicon id) and `iconColor` (a ThemeColor id) line up with
// the shortcut model's icon/color, so they are carried over for action shortcuts.
//
// The same items can also live in a custom JSON file pointed at by the
// `favoritesPanel.configPath` / `favoritesPanel.configPathForWorkspace` settings.
// That file is either a top-level array of items (sabitovvt v1.4.0+) or the legacy
// object wrapper `{ "favoritesPanel.commands": [ ... ] }` (pre-1.3.0); both shapes
// are accepted and mapped identically to the settings-key items.

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

/** Imports a file favorite as a project shortcut; one outside the workspace is skipped and logged. */
async function importMappedFile(
  file: vscode.Uri,
  label: string,
  sourceLabel: string,
  store: ShortcutStore,
  channel: vscode.OutputChannel
): Promise<"added" | "skipped" | "none"> {
  // A file outside the workspace folder cannot be a project shortcut.
  if (!vscode.workspace.getWorkspaceFolder(file)) {
    channel.appendLine(
      l10n("import.log.skipOutsideFolder", { file: sourceLabel, path: file.fsPath })
    );
    return "skipped";
  }
  // autoGroup:false: keep the imported layout; no re-sort into a default group.
  const ok = await store.addShortcut(file, "project", label, undefined, {
    autoGroup: false,
  });
  return ok ? "added" : "none";
}

/** Builds the share payload for an action favorite, carrying icon and color when set. */
function shortcutForAction(
  raw: SabitovvtItem,
  label: string,
  action: ShortcutAction
): SharedShortcut {
  const icon = typeof raw.icon === "string" && raw.icon.trim() ? raw.icon.trim() : undefined;
  const color =
    typeof raw.iconColor === "string" && raw.iconColor.trim()
      ? raw.iconColor.trim()
      : undefined;
  // `v` is ignored by importShortcut (it reads only the shortcut fields); set to 1.
  return { v: 1, label, action, icon, color };
}

// Import one list of sabitovvt items (from a settings key or a custom config file)
// as project shortcuts. File items go through addShortcut (folder-relative, deduped);
// non-file items go through importShortcut with an action, deduped via the shared
// `seenActions` signature set so a duplicate listed in more than one source is
// collapsed. Unmappable/malformed items are logged against `sourceLabel` and skipped.
// The caller owns `seenActions` so dedup spans every source in one import run.
async function importSabitovvtItemList(
  items: readonly SabitovvtItem[],
  sourceLabel: string,
  folder: vscode.WorkspaceFolder | undefined,
  store: ShortcutStore,
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
      const outcome = await importMappedFile(mapped.file, label, sourceLabel, store, channel);
      if (outcome === "added") {
        added++;
      } else if (outcome === "skipped") {
        skipped++;
      }
      continue;
    }
    // Action shortcut: dedup by signature, then import carrying icon/color when set.
    const sig = actionSignature(label, mapped.action);
    if (seenActions.has(sig)) {
      continue; // Already present — idempotent, not a reportable skip.
    }
    if (await store.importShortcut(shortcutForAction(raw, label, mapped.action), "project")) {
      seenActions.add(sig);
      added++;
    }
  }
  return { added, skipped };
}

// sabitovvt "Favorites Panel": import the command-dispatch items from both settings
// keys AND any custom config file the configPath settings point at, as project
// shortcuts. All sources share one `seenActions` set so an action listed in more than
// one of them imports once. Unmappable items are logged and skipped.
export async function importSabitovvtFavorites(
  store: ShortcutStore
): Promise<ImportResult> {
  const channel = getOutputChannel();
  const config = vscode.workspace.getConfiguration();
  const folder = vscode.workspace.workspaceFolders?.[0];
  // Seed action-shortcut dedup from existing project shortcuts; add to it as we import
  // so a duplicate listed across sources is also collapsed.
  const seenActions = new Set(
    store
      .getProjectShortcuts()
      .filter((p) => p.action)
      .map((p) => actionSignature(p.label, p.action as ShortcutAction))
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
