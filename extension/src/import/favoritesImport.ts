import * as path from "path";
import * as vscode from "vscode";
import { PinStore } from "../model/pinStore";
import { PinAction, MacroStep } from "../model/pin";
import { getOutputChannel } from "../exec/runner";
import { l10n } from "../i18n/l10n";

// Imports pins from other VS Code "favorites" extensions so users migrating to
// Saropa Workspace keep their existing favorites.
//
// In-workspace sources (added as PROJECT pins of the owning folder), each only
// imported when present:
//   - kdcro101 "Favorites" — `.favorites.json` (a JSON array). Entries look like
//     { "type": "File", "name": "...", "fsPath": "C:\\...\\file.py" }; folder /
//     group entries (type !== "File") are unsupported and skipped.
//   - oleg-shilo "Favorites Manager" — a text list at `.vscode/fav.local.list.txt`
//     or `.fav/local.list.txt`, one entry per line as `path` or `path|alias`. A
//     relative path resolves against the folder; an alias becomes the pin's display
//     label. `#` comment lines and blank-line dividers import as comment / separator
//     annotation pins, keeping the source's sectioning (see importOlegShilo).
//   - alefragnani "Bookmarks" — `.vscode/bookmarks.json` (written when the
//     bookmarks.saveBookmarksInProject setting is on). Line-level marks map to
//     line pins (one pin per bookmark), since the pin model has a line field.
//   - howardzuo "favorites" — the `favorites.resources` settings key (an array of
//     paths), read from the active configuration rather than a file on disk.
//   - sabitovvt "Favorites Panel" — the `favoritesPanel.commands` /
//     `favoritesPanel.commandsForWorkspace` settings keys. Its command-dispatch
//     items map to file / url / command / shell pins (and sequences to macros);
//     see importSabitovvtFavorites for the per-command mapping.
//
// Every recognized-but-unsupported or malformed entry (a folder/group entry, a
// blank or path-less line, a non-string settings value, an unparseable file, an
// item type with no pin equivalent) is reported in the shared output channel and
// skipped — a single bad entry never aborts the whole import.

// The on-disk file formats scanned across the open workspace folders.
type FileFavoritesFormat = "kdcro" | "olegShilo" | "bookmarks";

// Files we look for per folder, with the format each carries. Extend as more
// formats are added.
const KNOWN_FAVORITES_SOURCES: ReadonlyArray<{
  fileName: string;
  format: FileFavoritesFormat;
}> = [
  { fileName: ".favorites.json", format: "kdcro" },
  { fileName: ".vscode/fav.local.list.txt", format: "olegShilo" },
  { fileName: ".fav/local.list.txt", format: "olegShilo" },
  { fileName: ".vscode/bookmarks.json", format: "bookmarks" },
];

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

interface KdcroFavoriteEntry {
  type?: string;
  name?: string;
  fsPath?: string;
}

export interface DetectedFavorites {
  folder: vscode.WorkspaceFolder;
  fileUri: vscode.Uri;
  fileName: string;
  format: FileFavoritesFormat;
}

// What one source contributed: pins newly added, and entries recognized but not
// pinned (reported in the output channel). Duplicate entries the store already
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

// Parse one detected favorites file and add its entries as project pins,
// dispatching on the file's format. Unsupported/malformed entries are logged to
// the channel and skipped. Returns the per-file added/skipped tally.
export async function importFavoritesFile(
  detected: DetectedFavorites,
  store: PinStore
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

// kdcro101 `.favorites.json`: a JSON array of typed entries. Only File entries
// become pins; folder/group entries and path-less entries are reported as skips.
async function importKdcro(
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

// oleg-shilo "Favorites Manager" text list: one entry per line as `path` or
// `path|alias`. A relative path resolves against the owning folder; the alias
// becomes the pin's label. The format also uses `#` lines as visible comments and
// blank lines as section dividers, which we import as annotation pins (a comment's
// text is the line minus its leading `#`; a blank line becomes a separator),
// preserving their source position so the imported list keeps the file's sectioning.
//
// Annotations are positional and intentionally NOT deduplicated (mirroring the
// pin-set import carve-out in pinSetExport.ts), so re-running the import re-adds them
// — file pins still dedupe by path, keeping the real-pin import idempotent. Blank
// lines collapse: a run of blanks, a leading blank before the first entry, and a
// trailing blank at end-of-file produce no separator, so file formatting (a stray
// double newline, a trailing newline) never leaks a divider into the list.
async function importOlegShilo(
  text: string,
  detected: DetectedFavorites,
  store: PinStore,
  channel: vscode.OutputChannel
): Promise<ImportResult> {
  let added = 0;
  let skipped = 0;
  // A blank line is held pending and only materialized into a separator once a
  // real entry (comment or file pin) follows it; this collapses blank runs and
  // drops leading/trailing blanks. emittedReal gates the leading case.
  let emittedReal = false;
  let separatorPending = false;
  const flushSeparator = async (): Promise<void> => {
    if (!separatorPending) {
      return;
    }
    separatorPending = false;
    if (await store.addAnnotationPin("separator", "project", undefined, undefined, detected.folder)) {
      added++;
    }
  };

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    // Blank line: a section divider, deferred until a real entry follows it.
    if (line.length === 0) {
      if (emittedReal) {
        separatorPending = true;
      }
      continue;
    }
    // `#` comment: a non-runnable label whose text is the line minus the marker.
    if (line.startsWith("#")) {
      await flushSeparator();
      const commentText = line.slice(1).trim();
      if (await store.addAnnotationPin("comment", "project", commentText, undefined, detected.folder)) {
        added++;
        emittedReal = true;
      }
      continue;
    }
    // Split on the FIRST `|` only, so an alias may itself contain a pipe.
    const sep = line.indexOf("|");
    const pathPart = (sep === -1 ? line : line.slice(0, sep)).trim();
    const alias = sep === -1 ? undefined : line.slice(sep + 1).trim() || undefined;
    if (pathPart.length === 0) {
      channel.appendLine(
        l10n("import.log.skipBlankPath", { file: detected.fileName })
      );
      skipped++;
      continue;
    }
    // A real file entry flushes any pending divider above it, then is added; the
    // divider materializes only here so it never trails past the last entry.
    await flushSeparator();
    const uri = path.isAbsolute(pathPart)
      ? vscode.Uri.file(pathPart)
      : vscode.Uri.joinPath(detected.folder.uri, pathPart);
    if (await store.addPin(uri, "project", alias)) {
      added++;
    }
    // A duplicate file pin (re-import) still counts as a real entry for divider
    // placement: the pin exists in the list, so a following blank is a real gap.
    emittedReal = true;
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
async function importBookmarks(
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

// Import every detected favorites source — each known file across all folders,
// plus the howardzuo and sabitovvt settings keys — as project pins. Returns the
// combined added/skipped tally and writes a one-line summary to the channel when
// anything was skipped, so the user can open the output to see what and why.
export async function importAllDetected(store: PinStore): Promise<ImportResult> {
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

// --- sibling-project scan ------------------------------------------------
//
// Bring favorites in from OTHER projects on disk: the immediate sibling folders
// one directory level up from each open workspace folder. Unlike the in-workspace
// import above (which writes folder-relative PROJECT pins), a sibling's favorite
// is an absolute path outside the current workspace folder, so it can only be a
// GLOBAL pin. The scan is explicit (a command), never automatic on activation, to
// keep cross-project disk reads a deliberate user action.

// We recognize two on-disk formats in a sibling project: the kdcro101
// `.favorites.json` (absolute fsPath entries) and our own project pins file
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

// Our own project pins file shape, as far as the sibling scan needs it: each pin
// carries a folder-relative path. (auto-pins are never stored in pins[].)
interface SaropaPinsFile {
  pins?: { path?: string }[];
}

// Scan the immediate sibling folders of every open workspace folder for known
// favorites files. Skips the workspace folders themselves (their favorites are
// project pins, not cross-project imports) and de-duplicates shared parents.
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
      // A sibling that is itself open owns its favorites as project pins.
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
  const file = parsed as SaropaPinsFile;
  const pins = Array.isArray(file.pins) ? file.pins : [];
  return pins
    .filter((p) => !!p.path)
    .map((p) => vscode.Uri.joinPath(sibling.siblingDir, p.path as string));
}

// Import one detected sibling favorites file as GLOBAL pins. Returns the number
// of newly added pins (the store skips duplicates by absolute path, so re-running
// the scan is idempotent).
export async function importSiblingFavorites(
  sibling: SiblingFavorites,
  store: PinStore
): Promise<number> {
  const uris = await resolveSiblingUris(sibling);
  let added = 0;
  for (const uri of uris) {
    if (await store.addPin(uri, "global")) {
      added++;
    }
  }
  return added;
}
