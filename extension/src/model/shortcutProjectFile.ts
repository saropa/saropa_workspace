// Project config file IO for the shortcut store: where the file lives, creating it
// (with migration from legacy config directories), tolerant reading with staged
// version defaults, and writing. Free functions over a workspace folder so the
// store base class stays small. Split out of shortcutStoreBase.ts.

import * as vscode from "vscode";
import {
  ShortcutSet,
  ProjectShortcutsFile,
  PROJECT_SHORTCUTS_VERSION,
  PROJECT_FILE_RELATIVE,
  LEGACY_PROJECT_FILE_RELATIVE,
  KNOWN_CONFIG_DIRS,
  configDirName,
  configuredProjectFileRelative,
  DEFAULT_SET_NAME,
  emptyProjectShortcutsFile,
} from "./shortcut";

import { getOutputChannel } from "../exec/runner";

export function projectFileUriOn(folder: vscode.WorkspaceFolder): vscode.Uri {
  return vscode.Uri.joinPath(folder.uri, configuredProjectFileRelative());
}

// Create the project config file for a folder that has none yet. Checks every
// known previous config directory (KNOWN_CONFIG_DIRS) as a migration source,
// skipping the current configDir. If a legacy file is found, its content is
// copied to the configured location with pin paths rewritten, and the source
// is deleted (delete failure is isolated — the migrated copy is safe). When no
// legacy file exists, a fresh empty config is created. A write failure
// (read-only folder, virtual filesystem) is swallowed and logged.
export async function ensureProjectFileOn(folder: vscode.WorkspaceFolder): Promise<void> {
  const uri = projectFileUriOn(folder);
  try {
    await vscode.workspace.fs.stat(uri);
    return; // already present — do not overwrite
  } catch {
    // Configured path absent — check legacy locations before creating.
  }

  const currentDir = configDirName();
  const currentRelative = configuredProjectFileRelative();

  // Try each known legacy location (newest convention first).
  for (const dir of KNOWN_CONFIG_DIRS) {
    if (dir === currentDir) {
      continue;
    }
    const legacyRelative = `${dir}/saropa-workspace.json`;
    const legacyUri = vscode.Uri.joinPath(folder.uri, legacyRelative);
    let legacyBytes: Uint8Array | undefined;
    try {
      legacyBytes = await vscode.workspace.fs.readFile(legacyUri);
    } catch {
      continue;
    }

    // Migrate: rewrite any pins whose path targeted a known legacy config
    // location so the seed shortcut stays accurate. A corrupt legacy file
    // must not crash activation (BUG-001) — treat it like "no legacy file
    // here" and keep checking the remaining known locations.
    let parsed: ProjectShortcutsFile;
    try {
      parsed = JSON.parse(Buffer.from(legacyBytes).toString("utf8"));
    } catch (err) {
      getOutputChannel().appendLine(
        `[config] ${legacyRelative} is not valid JSON, skipping migration for ${
          folder.name
        }: ${err instanceof Error ? err.message : String(err)}`
      );
      continue;
    }
    if (Array.isArray(parsed.pins)) {
      for (const pin of parsed.pins) {
        if (
          pin.path === LEGACY_PROJECT_FILE_RELATIVE ||
          pin.path === PROJECT_FILE_RELATIVE
        ) {
          pin.path = currentRelative;
        }
      }
    }
    await writeProjectFileOn(folder, parsed);
    try {
      await vscode.workspace.fs.delete(legacyUri);
    } catch {
      // Delete failed (locked file, permissions) — the migrated copy is safe;
      // next activation will see the configured path and skip migration.
    }
    getOutputChannel().appendLine(
      `[config] migrated ${legacyRelative} → ${currentRelative} for ${folder.name}`
    );
    return;
  }

  try {
    await writeProjectFileOn(folder, emptyProjectShortcutsFile());
  } catch (err) {
    getOutputChannel().appendLine(
      `[config] could not create ${currentRelative} for ${folder.name}: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }
}

export async function readProjectFileOn(
  folder: vscode.WorkspaceFolder
): Promise<ProjectShortcutsFile> {
  try {
    const bytes = await readProjectFileBytes(folder);
    if (!bytes) {
      return emptyProjectShortcutsFile();
    }
    const parsed = JSON.parse(Buffer.from(bytes).toString("utf8"));
    // Defensive defaults + staged migration. v1->v2: a v1 file has no `groups`;
    // it reads as an empty group list and its shortcuts (which lack groupId) render
    // at the top level. v2->v3: a v2 file has no `activeSet`/`sets`; its existing
    // top-level shortcuts/groups BECOME the default set's contents (activeSet
    // defaults to DEFAULT_SET_NAME, sets defaults to []), so nothing is moved or
    // dropped — a single-set workspace stays identical to the pre-sets layout. No
    // shortcut field is ever lost. `sets` entries are sanitized so a hand-edited
    // file with a malformed set never crashes the reader.
    return {
      version: PROJECT_SHORTCUTS_VERSION,
      pins: Array.isArray(parsed.pins) ? parsed.pins : [],
      groups: Array.isArray(parsed.groups) ? parsed.groups : [],
      // A non-empty string wins; anything else (missing/blank/non-string from a
      // v2 file or a bad hand-edit) falls back to the default set name.
      activeSet:
        typeof parsed.activeSet === "string" &&
        parsed.activeSet.trim().length > 0
          ? parsed.activeSet
          : DEFAULT_SET_NAME,
      // Only well-formed, named sets survive the read; each set's shortcuts/groups
      // default to [] when absent so a partial hand-edit can't throw later.
      sets: Array.isArray(parsed.sets)
        ? parsed.sets
            .filter(
              (s: unknown): s is ShortcutSet =>
                !!s &&
                typeof (s as ShortcutSet).name === "string" &&
                (s as ShortcutSet).name.trim().length > 0
            )
            .map((s: ShortcutSet) => ({
              name: s.name,
              pins: Array.isArray(s.pins) ? s.pins : [],
              groups: Array.isArray(s.groups) ? s.groups : [],
            }))
        : [],
      removedAutoPins: Array.isArray(parsed.removedAutoPins)
        ? parsed.removedAutoPins
        : [],
      removedRecipes: Array.isArray(parsed.removedRecipes)
        ? parsed.removedRecipes
        : [],
      // A v1/v2 file (or one written before auto-shortcut grouping) has no
      // autoGroups; it reads as an empty map and every auto-shortcut stays at top
      // level until the user drags one into a folder.
      autoGroups:
        parsed.autoGroups && typeof parsed.autoGroups === "object"
          ? (parsed.autoGroups as Record<string, string>)
          : {},
    };
  } catch {
    return emptyProjectShortcutsFile();
  }
}

// Try the configured dir first, then each known legacy location as a fallback.
async function readProjectFileBytes(
  folder: vscode.WorkspaceFolder
): Promise<Uint8Array | undefined> {
  try {
    return await vscode.workspace.fs.readFile(projectFileUriOn(folder));
  } catch {
    // Configured path absent — try legacy locations.
  }
  const currentDir = configDirName();
  for (const dir of KNOWN_CONFIG_DIRS) {
    if (dir === currentDir) {
      continue;
    }
    try {
      return await vscode.workspace.fs.readFile(
        vscode.Uri.joinPath(folder.uri, `${dir}/saropa-workspace.json`)
      );
    } catch {
      continue;
    }
  }
  return undefined;
}

export async function writeProjectFileOn(
  folder: vscode.WorkspaceFolder,
  file: ProjectShortcutsFile
): Promise<void> {
  const uri = projectFileUriOn(folder);
  await vscode.workspace.fs.createDirectory(
    vscode.Uri.joinPath(folder.uri, configDirName())
  );
  const json = JSON.stringify(file, null, 2) + "\n";
  await vscode.workspace.fs.writeFile(uri, Buffer.from(json, "utf8"));
}
