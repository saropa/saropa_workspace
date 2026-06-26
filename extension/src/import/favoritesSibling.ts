import * as vscode from "vscode";
import { ShortcutStore } from "../model/shortcutStore";
import type { KdcroFavoriteEntry } from "./favoritesImport";

// --- sibling-project scan ------------------------------------------------
//
// Bring favorites in from OTHER projects on disk: the immediate sibling folders
// one directory level up from each open workspace folder. Unlike the in-workspace
// import (which writes folder-relative PROJECT shortcuts), a sibling's favorite is an
// absolute path outside the current workspace folder, so it can only be a GLOBAL
// shortcut. The scan is explicit (a command), never automatic on activation, to keep
// cross-project disk reads a deliberate user action.

// We recognize two on-disk formats in a sibling project: the kdcro101
// `.favorites.json` (absolute fsPath entries) and our own project shortcuts file
// (paths relative to the sibling folder).
type SiblingFormat = "kdcro" | "saropa";

const SIBLING_SOURCES: ReadonlyArray<{ relPath: string; format: SiblingFormat }> = [
  { relPath: ".favorites.json", format: "kdcro" },
  { relPath: ".vscode/saropa-workspace.json", format: "saropa" },
];

export interface SiblingFavorites {
  siblingDir: vscode.Uri;
  siblingName: string;
  fileUri: vscode.Uri;
  // Display name of the source file, e.g. ".favorites.json".
  fileLabel: string;
  format: SiblingFormat;
}

// Our own project shortcuts file shape, as far as the sibling scan needs it: each
// shortcut carries a folder-relative path. (auto-shortcuts are never stored in pins[].)
interface SaropaShortcutsFile {
  pins?: { path?: string }[];
}

// Scan the immediate sibling folders of every open workspace folder for known
// favorites files. Skips the workspace folders themselves (their favorites are
// project shortcuts, not cross-project imports) and de-duplicates shared parents.
export async function detectSiblingFavorites(): Promise<SiblingFavorites[]> {
  const openFolderPaths = new Set(
    (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath)
  );
  const scannedParents = new Set<string>();
  const found: SiblingFavorites[] = [];
  const seenFiles = new Set<string>();

  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    const parent = vscode.Uri.joinPath(folder.uri, "..");
    // A folder at a filesystem root has no distinct parent; nothing to scan.
    if (parent.fsPath === folder.uri.fsPath || scannedParents.has(parent.fsPath)) {
      continue;
    }
    scannedParents.add(parent.fsPath);

    let entries: [string, vscode.FileType][];
    try {
      entries = await vscode.workspace.fs.readDirectory(parent);
    } catch {
      // Parent unreadable (permissions, virtual FS); skip rather than fail.
      continue;
    }

    for (const [name, fileType] of entries) {
      if ((fileType & vscode.FileType.Directory) === 0) {
        continue;
      }
      const siblingDir = vscode.Uri.joinPath(parent, name);
      // A sibling that is itself open owns its favorites as project shortcuts.
      if (openFolderPaths.has(siblingDir.fsPath)) {
        continue;
      }
      for (const source of SIBLING_SOURCES) {
        const fileUri = vscode.Uri.joinPath(siblingDir, source.relPath);
        if (seenFiles.has(fileUri.fsPath)) {
          continue;
        }
        try {
          await vscode.workspace.fs.stat(fileUri);
        } catch {
          continue; // Not present in this sibling.
        }
        seenFiles.add(fileUri.fsPath);
        found.push({
          siblingDir,
          siblingName: name,
          fileUri,
          fileLabel: source.relPath,
          format: source.format,
        });
      }
    }
  }
  return found;
}

// Resolve a detected sibling favorites file to the absolute file URIs it points
// at. kdcro entries already carry absolute fsPaths; our own format stores paths
// relative to the sibling folder, so they are joined back to it.
async function resolveSiblingUris(
  sibling: SiblingFavorites
): Promise<vscode.Uri[]> {
  let bytes: Uint8Array;
  try {
    bytes = await vscode.workspace.fs.readFile(sibling.fileUri);
  } catch {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(bytes).toString("utf8"));
  } catch {
    return []; // Malformed file imports nothing rather than throwing.
  }

  if (sibling.format === "kdcro") {
    const entries: KdcroFavoriteEntry[] = Array.isArray(parsed) ? parsed : [];
    return entries
      .filter((e) => (!e.type || e.type === "File") && !!e.fsPath)
      .map((e) => vscode.Uri.file(e.fsPath as string));
  }

  // saropa format: paths are relative to the sibling folder.
  const file = parsed as SaropaShortcutsFile;
  const shortcuts = Array.isArray(file.pins) ? file.pins : [];
  return shortcuts
    .filter((p) => !!p.path)
    .map((p) => vscode.Uri.joinPath(sibling.siblingDir, p.path as string));
}

// Import one detected sibling favorites file as GLOBAL shortcuts. Returns the number
// of newly added shortcuts (the store skips duplicates by absolute path, so re-running
// the scan is idempotent).
export async function importSiblingFavorites(
  sibling: SiblingFavorites,
  store: ShortcutStore
): Promise<number> {
  const uris = await resolveSiblingUris(sibling);
  let added = 0;
  for (const uri of uris) {
    if (await store.addShortcut(uri, "global")) {
      added++;
    }
  }
  return added;
}
