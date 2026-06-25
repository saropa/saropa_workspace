import * as vscode from "vscode";
import { PinStore } from "../model/pinStore";

// Imports pins from other VS Code "favorites" extensions so users migrating to
// Saropa Workspace keep their existing favorites.
//
// Phase 1 supports the most common on-disk format: the kdcro101 "Favorites"
// extension's `.favorites.json` at the workspace root. Its entries look like:
//   { "type": "File", "name": "...", "fsPath": "C:\\...\\file.py", "id": "..." }
// Folder entries (type !== "File") are skipped in Phase 1 since pins are files.

// Filenames we look for, in priority order. Extend as more formats are added.
const KNOWN_FAVORITES_FILES = [".favorites.json"];

interface KdcroFavoriteEntry {
  type?: string;
  name?: string;
  fsPath?: string;
}

export interface DetectedFavorites {
  folder: vscode.WorkspaceFolder;
  fileUri: vscode.Uri;
  fileName: string;
}

// Return every known favorites file present across the open workspace folders.
export async function detectFavoritesFiles(): Promise<DetectedFavorites[]> {
  const found: DetectedFavorites[] = [];
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    for (const fileName of KNOWN_FAVORITES_FILES) {
      const fileUri = vscode.Uri.joinPath(folder.uri, fileName);
      try {
        await vscode.workspace.fs.stat(fileUri);
        found.push({ folder, fileUri, fileName });
      } catch {
        // Not present in this folder; keep scanning.
      }
    }
  }
  return found;
}

// Parse one detected favorites file and add its file entries as project pins.
// Returns the number of newly added pins (duplicates are skipped by the store).
export async function importFavoritesFile(
  detected: DetectedFavorites,
  store: PinStore
): Promise<number> {
  let bytes: Uint8Array;
  try {
    bytes = await vscode.workspace.fs.readFile(detected.fileUri);
  } catch {
    return 0;
  }

  let entries: KdcroFavoriteEntry[];
  try {
    const parsed = JSON.parse(Buffer.from(bytes).toString("utf8"));
    entries = Array.isArray(parsed) ? parsed : [];
  } catch {
    // A malformed favorites file is not fatal; import nothing rather than throw.
    return 0;
  }

  let added = 0;
  for (const entry of entries) {
    // Only file entries become pins in Phase 1; skip folders/groups.
    if (entry.type && entry.type !== "File") {
      continue;
    }
    if (!entry.fsPath) {
      continue;
    }
    const uri = vscode.Uri.file(entry.fsPath);
    // addPin stores project pins relative to the owning folder and skips dupes,
    // so re-running import is idempotent.
    if (await store.addPin(uri, "project")) {
      added++;
    }
  }
  return added;
}

// Import every detected favorites file across all folders. Returns the total
// number of pins added.
export async function importAllDetected(store: PinStore): Promise<number> {
  const detected = await detectFavoritesFiles();
  let total = 0;
  for (const d of detected) {
    total += await importFavoritesFile(d, store);
  }
  return total;
}
