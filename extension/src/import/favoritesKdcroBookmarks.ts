import * as path from "path";
import * as vscode from "vscode";
import { ShortcutStore } from "../model/shortcutStore";
import { l10n } from "../i18n/l10n";
import type {
  DetectedFavorites,
  ImportResult,
  KdcroFavoriteEntry,
} from "./favoritesImport";

// The two JSON file-format importers: kdcro101 `.favorites.json` (a typed array of
// path entries) and alefragnani "Bookmarks" `.vscode/bookmarks.json` (line-level
// marks). Both parse defensively — a malformed file imports nothing and is logged —
// and add PROJECT shortcuts to the store; the store owns folder-relative storage + dedup.

// kdcro101 `.favorites.json`: a flat JSON array of typed entries. File entries
// become shortcuts; a "Group" entry becomes a shortcut group, and any File whose
// parent_id points at that group is imported into it (created on first use, reused by
// name so re-import stays idempotent). "Directory" entries are folder favorites with
// no folder-shortcut equivalent and are reported as skips, as are path-less entries.
export async function importKdcro(
  text: string,
  fileName: string,
  store: ShortcutStore,
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

  // First pass: index every Group container by id so the file pass can resolve a
  // File's parent_id to a group name. Only "Group" entries are shortcut-group
  // containers; a Directory is a folder favorite, not a container of shortcuts.
  const groupNameById = new Map<string, string>();
  for (const entry of entries) {
    if (entry.type === "Group" && entry.id) {
      groupNameById.set(entry.id, (entry.label ?? entry.name ?? "?").trim() || "?");
    }
  }

  let added = 0;
  let skipped = 0;
  for (const entry of entries) {
    // A Group is consumed via its members below, never added in its own right.
    if (entry.type === "Group") {
      continue;
    }
    // A Directory (folder favorite) and any other non-File type have no file-shortcut
    // equivalent; report and skip them.
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
    // Route into the parent group's shortcut group when the parent is a Group; a file
    // parented to a Directory (or with no parent) imports at the top level.
    const groupName = entry.parent_id
      ? groupNameById.get(entry.parent_id)
      : undefined;
    // addShortcut stores project shortcuts relative to the owning folder and skips
    // dupes, so re-running import is idempotent — the group is reused by name as well.
    // autoGroup:false preserves the imported layout: an unparented favorite stays at the
    // top level rather than being re-sorted into a built-in default group.
    if (
      await store.addShortcut(
        vscode.Uri.file(entry.fsPath),
        "project",
        undefined,
        groupName,
        { autoGroup: false }
      )
    ) {
      added++;
    }
  }
  return { added, skipped };
}

// The shape of `.vscode/bookmarks.json` (alefragnani "Bookmarks"). Only the
// fields the line-shortcut mapping reads are declared; `column` is intentionally
// ignored (a line shortcut has no column, and a jump target does not need one).
interface BookmarkEntry {
  // 0-based line index, as stored by the extension (it serializes the raw
  // vscode.Position.line). The shortcut model's `line` is 1-based, so we add 1.
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
// Each mark becomes a LINE shortcut (the shortcut model has a `line` field), so opening
// the shortcut jumps back to that line. Re-import is idempotent: a line shortcut for the
// same resolved file + line is left untouched (addLineShortcut itself does NOT dedupe —
// it is built to allow several marks in one file — so the dedup lives here). The
// bookmark's label, when present, becomes the shortcut label; otherwise the shortcut
// falls back to the "basename:line" default. The column is dropped (no shortcut
// equivalent).
export async function importBookmarks(
  text: string,
  detected: DetectedFavorites,
  store: ShortcutStore,
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

  // Seed the dedup set from existing project line shortcuts so re-running import never
  // duplicates a mark; new shortcuts are added to it as we go to dedup within this run.
  const seen = new Set(
    store
      .getProjectShortcuts()
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
    // A bookmark file outside any workspace folder cannot be a project line shortcut.
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
      // Stored line is 0-based; the shortcut model is 1-based.
      const shortcutLine = mark.line + 1;
      const key = `${uri.toString()}#${shortcutLine}`;
      if (seen.has(key)) {
        continue; // Already imported — idempotent, not a reportable skip.
      }
      const label =
        mark.label && mark.label.trim().length > 0
          ? mark.label.trim()
          : l10n("linePin.label", { name: path.basename(uri.fsPath), line: shortcutLine });
      if (await store.addLineShortcut(uri, "project", shortcutLine, label)) {
        seen.add(key);
        added++;
      }
    }
  }
  return { added, skipped };
}
