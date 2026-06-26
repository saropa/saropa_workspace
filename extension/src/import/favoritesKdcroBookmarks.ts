import * as path from "path";
import * as vscode from "vscode";
import { PinStore } from "../model/pinStore";
import { l10n } from "../i18n/l10n";
import type {
  DetectedFavorites,
  ImportResult,
  KdcroFavoriteEntry,
} from "./favoritesImport";

// The two JSON file-format importers: kdcro101 `.favorites.json` (a typed array of
// path entries) and alefragnani "Bookmarks" `.vscode/bookmarks.json` (line-level
// marks). Both parse defensively — a malformed file imports nothing and is logged —
// and add PROJECT pins to the store; the store owns folder-relative storage + dedup.

// kdcro101 `.favorites.json`: a JSON array of typed entries. Only File entries
// become pins; folder/group entries and path-less entries are reported as skips.
export async function importKdcro(
  text: string,
  fileName: string,
  store: PinStore,
  channel: vscode.OutputChannel
): Promise<ImportResult> {
  let entries: KdcroFavoriteEntry[];
  try {
    const parsed: unknown = JSON.parse(text);
    entries = Array.isArray(parsed) ? (parsed as KdcroFavoriteEntry[]) : [];
  } catch (err) {
    // A malformed file imports nothing rather than throwing; name it in the log.
    channel.appendLine(
      l10n("import.log.malformed", {
        file: fileName,
        error: err instanceof Error ? err.message : String(err),
      })
    );
    return { added: 0, skipped: 0 };
  }

  let added = 0;
  let skipped = 0;
  for (const entry of entries) {
    // Folder/group entries cannot map to a file pin; report and skip them.
    if (entry.type && entry.type !== "File") {
      channel.appendLine(
        l10n("import.log.skipFolder", { file: fileName, name: entry.name ?? "?" })
      );
      skipped++;
      continue;
    }
    if (!entry.fsPath) {
      channel.appendLine(l10n("import.log.skipNoPath", { file: fileName }));
      skipped++;
      continue;
    }
    // addPin stores project pins relative to the owning folder and skips dupes,
    // so re-running import is idempotent.
    if (await store.addPin(vscode.Uri.file(entry.fsPath), "project")) {
      added++;
    }
  }
  return { added, skipped };
}

// The shape of `.vscode/bookmarks.json` (alefragnani "Bookmarks"). Only the
// fields the line-pin mapping reads are declared; `column` is intentionally
// ignored (a line pin has no column, and a jump target does not need one).
interface BookmarkEntry {
  // 0-based line index, as stored by the extension (it serializes the raw
  // vscode.Position.line). The pin model's `line` is 1-based, so we add 1.
  line?: number;
  label?: string;
}
interface BookmarkFile {
  // Folder-relative (forward-slashed) for an in-project file, or absolute for a
  // file outside the folder. Older files prefix the relative path with a
  // "$ROOTPATH$/" token, which we strip.
  path?: string;
  bookmarks?: BookmarkEntry[];
}
interface BookmarksDocument {
  files?: BookmarkFile[];
}

// Legacy path token some Bookmarks versions prefix onto an in-project relative
// path; stripped before the remainder is resolved against the owning folder.
const BOOKMARKS_ROOTPATH_TOKEN = "$ROOTPATH$";

// Resolve one bookmarks.json file path to a URI against the owning folder. A path
// carrying the legacy "$ROOTPATH$" prefix, or a plain relative path, joins to the
// folder; an absolute path is used as-is.
function resolveBookmarkUri(
  rawPath: string,
  folder: vscode.WorkspaceFolder
): vscode.Uri {
  let p = rawPath.trim().replace(/\\/g, "/");
  if (p.startsWith(BOOKMARKS_ROOTPATH_TOKEN)) {
    // Drop the token and any single separator that follows it.
    p = p.slice(BOOKMARKS_ROOTPATH_TOKEN.length).replace(/^[/\\]/, "");
  }
  return path.isAbsolute(p)
    ? vscode.Uri.file(p)
    : vscode.Uri.joinPath(folder.uri, p);
}

// alefragnani "Bookmarks": a JSON document of files, each with line-level marks.
// Each mark becomes a LINE pin (the pin model has a `line` field), so opening the
// pin jumps back to that line. Re-import is idempotent: a line pin for the same
// resolved file + line is left untouched (addLinePin itself does NOT dedupe — it
// is built to allow several marks in one file — so the dedup lives here). The
// bookmark's label, when present, becomes the pin label; otherwise the pin falls
// back to the "basename:line" default. The column is dropped (no pin equivalent).
export async function importBookmarks(
  text: string,
  detected: DetectedFavorites,
  store: PinStore,
  channel: vscode.OutputChannel
): Promise<ImportResult> {
  let doc: BookmarksDocument;
  try {
    const parsed: unknown = JSON.parse(text);
    doc = parsed && typeof parsed === "object" ? (parsed as BookmarksDocument) : {};
  } catch (err) {
    channel.appendLine(
      l10n("import.log.malformed", {
        file: detected.fileName,
        error: err instanceof Error ? err.message : String(err),
      })
    );
    return { added: 0, skipped: 0 };
  }

  // Seed the dedup set from existing project line pins so re-running import never
  // duplicates a mark; new pins are added to it as we go to dedup within this run.
  const seen = new Set(
    store
      .getProjectPins()
      .filter((p) => p.line !== undefined)
      .map((p) => `${store.resolveUri(p)?.toString() ?? ""}#${p.line}`)
  );

  let added = 0;
  let skipped = 0;
  for (const file of doc.files ?? []) {
    if (!file.path || file.path.trim().length === 0) {
      channel.appendLine(l10n("import.log.skipNoPath", { file: detected.fileName }));
      skipped++;
      continue;
    }
    const uri = resolveBookmarkUri(file.path, detected.folder);
    // A bookmark file outside any workspace folder cannot be a project line pin.
    if (!vscode.workspace.getWorkspaceFolder(uri)) {
      channel.appendLine(
        l10n("import.log.skipOutsideFolder", {
          file: detected.fileName,
          path: file.path,
        })
      );
      skipped++;
      continue;
    }
    for (const mark of file.bookmarks ?? []) {
      if (typeof mark.line !== "number") {
        channel.appendLine(l10n("import.log.skipNoPath", { file: detected.fileName }));
        skipped++;
        continue;
      }
      // Stored line is 0-based; the pin model is 1-based.
      const pinLine = mark.line + 1;
      const key = `${uri.toString()}#${pinLine}`;
      if (seen.has(key)) {
        continue; // Already imported — idempotent, not a reportable skip.
      }
      const label =
        mark.label && mark.label.trim().length > 0
          ? mark.label.trim()
          : l10n("linePin.label", { name: path.basename(uri.fsPath), line: pinLine });
      if (await store.addLinePin(uri, "project", pinLine, label)) {
        seen.add(key);
        added++;
      }
    }
  }
  return { added, skipped };
}
