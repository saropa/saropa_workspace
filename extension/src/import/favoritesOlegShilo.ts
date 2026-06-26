import * as path from "path";
import * as vscode from "vscode";
import { PinStore } from "../model/pinStore";
import { l10n } from "../i18n/l10n";
import type { DetectedFavorites, ImportResult } from "./favoritesImport";

// The oleg-shilo "Favorites Manager" text-list importer. The line parser is pure
// (no store, no vscode) so its blank-line / comment collapse rules are unit-tested
// in isolation; the importer turns each parsed entry into a project pin and owns
// dedup (annotations are positional and intentionally not deduped).

// One parsed entry from an oleg-shilo favorites list, in source order:
//   - "file"      a path / alias line that becomes a file pin
//   - "comment"   a `#` line that becomes a comment annotation (text minus the `#`)
//   - "separator" a blank-line divider that becomes a separator annotation
//   - "skip"      a malformed path-less line the caller reports and skips
// Kept as a discriminated union so importOlegShilo dispatches on `kind` with no
// re-parsing, and the parser stays a pure transform (no store, no vscode) the unit
// tests exercise directly.
export type OlegShiloEntry =
  | { kind: "file"; pathPart: string; alias?: string }
  | { kind: "comment"; text: string }
  | { kind: "separator" }
  | { kind: "skip" };

// Parse an oleg-shilo "Favorites Manager" text list into ordered entries. One entry
// per line as `path` or `path|alias`; `#` lines are visible comments and blank lines
// are section dividers, both preserved positionally so the imported list keeps the
// source's sectioning.
//
// Blank lines collapse: a divider is held pending and only emitted once a real entry
// (comment or file) follows it, so a run of blanks, a leading blank before the first
// entry, and a trailing blank at end-of-file all produce no separator — file
// formatting (a stray double newline, a trailing newline) never leaks a divider.
// Pure (no store / no vscode) so the collapse rules are unit-tested in isolation; the
// caller turns each entry into a pin and owns dedup. A duplicate file line still
// counts as a real entry for divider placement (the pin already exists in the list,
// so a following blank is a genuine gap), so dedup is deliberately the caller's job.
export function parseOlegShiloLines(text: string): OlegShiloEntry[] {
  const entries: OlegShiloEntry[] = [];
  let emittedReal = false;
  let separatorPending = false;
  const flushSeparator = (): void => {
    if (separatorPending) {
      entries.push({ kind: "separator" });
      separatorPending = false;
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
      flushSeparator();
      entries.push({ kind: "comment", text: line.slice(1).trim() });
      emittedReal = true;
      continue;
    }
    // Split on the FIRST `|` only, so an alias may itself contain a pipe.
    const sep = line.indexOf("|");
    const pathPart = (sep === -1 ? line : line.slice(0, sep)).trim();
    const alias = sep === -1 ? undefined : line.slice(sep + 1).trim() || undefined;
    // A path-less malformed line (e.g. "|alias") is not a divider; the caller logs it.
    if (pathPart.length === 0) {
      entries.push({ kind: "skip" });
      continue;
    }
    flushSeparator();
    entries.push({ kind: "file", pathPart, alias });
    emittedReal = true;
  }
  return entries;
}

// oleg-shilo "Favorites Manager" text list: parse it (parseOlegShiloLines) and turn
// each entry into a project pin in source order. File pins resolve against the owning
// folder and dedupe by path (so re-import stays idempotent for real pins); comment /
// separator annotations are positional and intentionally NOT deduped, mirroring the
// pin-set import carve-out in commands/pinSetExport.ts, so they re-add per source
// entry. Annotations target detected.folder so they land in the same folder and order
// as the file pins they sit between (the no-anchor addAnnotationPin path otherwise
// defaults to the first folder).
export async function importOlegShilo(
  text: string,
  detected: DetectedFavorites,
  store: PinStore,
  channel: vscode.OutputChannel
): Promise<ImportResult> {
  let added = 0;
  let skipped = 0;
  for (const entry of parseOlegShiloLines(text)) {
    if (entry.kind === "skip") {
      channel.appendLine(l10n("import.log.skipBlankPath", { file: detected.fileName }));
      skipped++;
      continue;
    }
    if (entry.kind === "comment") {
      if (
        await store.addAnnotationPin("comment", "project", entry.text, undefined, detected.folder)
      ) {
        added++;
      }
      continue;
    }
    if (entry.kind === "separator") {
      if (
        await store.addAnnotationPin("separator", "project", undefined, undefined, detected.folder)
      ) {
        added++;
      }
      continue;
    }
    const uri = path.isAbsolute(entry.pathPart)
      ? vscode.Uri.file(entry.pathPart)
      : vscode.Uri.joinPath(detected.folder.uri, entry.pathPart);
    if (await store.addPin(uri, "project", entry.alias)) {
      added++;
    }
  }
  return { added, skipped };
}
