import * as vscode from "vscode";
import { ShortcutStore } from "../model/shortcutStore";
import { getOutputChannel } from "../exec/runner";
import { l10n } from "../i18n/l10n";
import { importKdcro, importBookmarks } from "./favoritesKdcroBookmarks";
import { importOlegShilo } from "./favoritesOlegShilo";
import { importSettingsFavorites, importSabitovvtFavorites } from "./favoritesSettings";

// Imports shortcuts from other VS Code "favorites" extensions so users migrating to
// Saropa Workspace keep their existing favorites. This file holds the shared types,
// the file-format detection, the per-file dispatcher, and the import-everything
// orchestrator; the format-specific importers live in sibling modules:
//   - favoritesKdcroBookmarks  kdcro101 `.favorites.json`, alefragnani Bookmarks
//   - favoritesOlegShilo       oleg-shilo "Favorites Manager" text lists
//   - favoritesSettings        howardzuo + sabitovvt settings-key sources
//   - favoritesSibling         cross-project scan of sibling folders
//
// Every recognized-but-unsupported or malformed entry is reported in the shared
// output channel and skipped — a single bad entry never aborts the whole import.

// Re-exported so existing importers (pinCommands, the unit test) keep importing
// every favorites symbol from this one module.
export {
  parseOlegShiloLines,
  OlegShiloEntry,
} from "./favoritesOlegShilo";
export {
  detectSettingsFavoritesCount,
  importSettingsFavorites,
  detectSabitovvtFavoritesCount,
  importSabitovvtFavorites,
} from "./favoritesSettings";
export {
  detectSiblingFavorites,
  importSiblingFavorites,
  SiblingFavorites,
} from "./favoritesSibling";

// The on-disk file formats scanned across the open workspace folders.
type FileFavoritesFormat = "kdcro" | "olegShilo" | "bookmarks";

// Files we look for per folder, with the format each carries. Extend as more
// formats are added. Exported so the activation watchers arm on the same set of
// filenames the detector scans — a single source of truth keeps the "newly
// appeared file" prompt in lockstep with what import actually recognizes.
export const KNOWN_FAVORITES_SOURCES: ReadonlyArray<{
  fileName: string;
  format: FileFavoritesFormat;
}> = [
  { fileName: ".favorites.json", format: "kdcro" },
  { fileName: ".vscode/fav.local.list.txt", format: "olegShilo" },
  { fileName: ".fav/local.list.txt", format: "olegShilo" },
  { fileName: ".vscode/bookmarks.json", format: "bookmarks" },
];

// One kdcro101 `.favorites.json` entry, as far as the importers read it. Declared
// here (the orchestrator) because both the in-workspace kdcro importer and the
// sibling scan consume the same shape. kdcro stores a FLAT list: a "Group" entry
// is a container carrying its own `id`, and a child references it through
// `parent_id` (verified against the upstream StoredResource type — there is no
// nested `children` array). `type` is "File", "Group", or "Directory".
export interface KdcroFavoriteEntry {
  type?: string;
  name?: string;
  // The user-facing group/file name some versions store separately from `name`;
  // preferred over `name` when present so a renamed group keeps its label.
  label?: string;
  fsPath?: string;
  // Stable id of this entry; only meaningful on Group entries (a File references
  // its group via parent_id).
  id?: string;
  // Id of the containing Group/Directory, or absent for a top-level entry.
  parent_id?: string;
}

// One favorites file found on disk during a workspace scan (detectFavoritesFiles),
// naming which folder it belongs to and which format to parse it as, so
// importFavoritesFile can dispatch without re-detecting the format itself.
export interface DetectedFavorites {
  folder: vscode.WorkspaceFolder;
  fileUri: vscode.Uri;
  fileName: string;
  format: FileFavoritesFormat;
}

// What one source contributed: shortcuts newly added, and entries recognized but not
// added (reported in the output channel). Duplicate entries the store already
// holds are NOT counted as skipped — re-running import is idempotent by design,
// so a dedup is expected, not a problem worth reporting.
export interface ImportResult {
  added: number;
  skipped: number;
}

// Return every known favorites FILE present across the open workspace folders.
// The settings-key source (howardzuo) is detected separately via
// detectSettingsFavoritesCount, since it has no file on disk.
export async function detectFavoritesFiles(): Promise<DetectedFavorites[]> {
  const found: DetectedFavorites[] = [];
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    for (const source of KNOWN_FAVORITES_SOURCES) {
      const fileUri = vscode.Uri.joinPath(folder.uri, source.fileName);
      try {
        await vscode.workspace.fs.stat(fileUri);
        found.push({
          folder,
          fileUri,
          fileName: source.fileName,
          format: source.format,
        });
      } catch {
        // Not present in this folder; keep scanning.
      }
    }
  }
  return found;
}

// Parse one detected favorites file and add its entries as project shortcuts,
// dispatching on the file's format. Unsupported/malformed entries are logged to
// the channel and skipped. Returns the per-file added/skipped tally.
export async function importFavoritesFile(
  detected: DetectedFavorites,
  store: ShortcutStore
): Promise<ImportResult> {
  const channel = getOutputChannel();
  let bytes: Uint8Array;
  try {
    bytes = await vscode.workspace.fs.readFile(detected.fileUri);
  } catch {
    return { added: 0, skipped: 0 };
  }
  const text = Buffer.from(bytes).toString("utf8");

  if (detected.format === "kdcro") {
    return importKdcro(text, detected.fileName, store, channel);
  }
  if (detected.format === "bookmarks") {
    return importBookmarks(text, detected, store, channel);
  }
  return importOlegShilo(text, detected, store, channel);
}

// Import every detected favorites source — each known file across all folders,
// plus the howardzuo and sabitovvt settings keys — as project shortcuts. Returns the
// combined added/skipped tally and writes a one-line summary to the channel when
// anything was skipped, so the user can open the output to see what and why.
export async function importAllDetected(store: ShortcutStore): Promise<ImportResult> {
  const channel = getOutputChannel();
  let added = 0;
  let skipped = 0;
  for (const detected of await detectFavoritesFiles()) {
    const result = await importFavoritesFile(detected, store);
    added += result.added;
    skipped += result.skipped;
  }
  for (const settings of [
    await importSettingsFavorites(store),
    await importSabitovvtFavorites(store),
  ]) {
    added += settings.added;
    skipped += settings.skipped;
  }
  if (skipped > 0) {
    channel.appendLine(l10n("import.log.summary", { added, skipped }));
  }
  return { added, skipped };
}
