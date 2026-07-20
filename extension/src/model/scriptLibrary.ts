import * as fs from "fs";
import * as path from "path";
import { l10n } from "../i18n/l10n";

// A tool requirement declared in the manifest's `requires` array.
export interface ScriptRequirement {
  readonly type: "command";
  readonly name: string;
  readonly reason: string;
  readonly optional?: boolean;
}

// Run config from the manifest. Maps 1:1 to the ShortcutExecConfig fields the
// run pipeline reads, so a library script can be routed through the same runner
// as a user shortcut.
export interface ScriptConfig {
  readonly command?: string;
  readonly args?: string[];
  readonly cwd?: string;
  readonly runLocation?: "terminal" | "background" | "external";
}

// One entry from library.json, resolved to display-ready form.
export interface LibraryScript {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly icon: string;
  readonly tags: readonly string[];
  readonly entry: string;
  readonly requires: readonly ScriptRequirement[];
  readonly config: ScriptConfig;
  // Absolute path to the canonical source script this entry was copied from.
  // A dev-time sync check compares the bundled copy against this path to
  // detect upstream drift. Absent for scripts authored directly in the library.
  readonly syncFrom?: string;
}

interface ManifestEntry {
  id: string;
  labelKey: string;
  descriptionKey: string;
  icon: string;
  tags: string[];
  entry: string;
  requires?: ScriptRequirement[];
  config: ScriptConfig;
  syncFrom?: string;
}

interface Manifest {
  version: number;
  scripts: ManifestEntry[];
}

// Read the bundled library manifest and return the resolved scripts. The
// manifest lives next to the script folders inside the extension's install
// directory — `context.extensionPath` provides the root. Returns an empty
// array when the manifest is missing or malformed (a defensive posture so
// a corrupt install still activates the rest of the extension).
export function loadScriptLibrary(extensionPath: string): LibraryScript[] {
  const manifestPath = path.join(
    extensionPath,
    "scripts",
    "library",
    "library.json"
  );
  let raw: string;
  try {
    raw = fs.readFileSync(manifestPath, "utf-8");
  } catch {
    return [];
  }

  let manifest: Manifest;
  try {
    manifest = JSON.parse(raw) as Manifest;
  } catch {
    return [];
  }

  if (!Array.isArray(manifest.scripts)) {
    return [];
  }

  // Drop entries missing required fields so a corrupt single entry never
  // crashes the whole loader (the array-level and JSON-level guards above
  // already cover gross corruption; this catches per-entry omissions).
  return manifest.scripts
    .filter(
      (e) =>
        typeof e.id === "string" &&
        typeof e.entry === "string" &&
        typeof e.labelKey === "string" &&
        e.config !== undefined
    )
    .map((entry) => ({
      id: entry.id,
      label: l10n(entry.labelKey),
      description: l10n(entry.descriptionKey ?? ""),
      icon: entry.icon ?? "file",
      tags: entry.tags ?? [],
      entry: entry.entry,
      requires: entry.requires ?? [],
      config: entry.config,
      syncFrom: entry.syncFrom,
    }));
}

// Resolve the absolute filesystem path to a script's entry point, given the
// extension install path and the manifest's relative entry field.
export function resolveScriptEntry(
  extensionPath: string,
  entry: string
): string {
  return path.join(extensionPath, "scripts", "library", entry);
}

// One script whose bundled copy diverges from its canonical source.
export interface SyncDrift {
  readonly script: LibraryScript;
  readonly reason: "source-missing" | "content-changed";
  readonly bundledPath: string;
  readonly sourcePath: string;
}

// Compare each library script that declares a syncFrom path against its
// canonical source. Returns only the entries that have diverged. Skipped
// entries (no syncFrom, or source not reachable) are omitted — silence means
// in-sync or not trackable. This is a dev-time diagnostic, not a runtime gate.
export function checkScriptSync(
  extensionPath: string,
  scripts: readonly LibraryScript[]
): SyncDrift[] {
  const drifted: SyncDrift[] = [];
  for (const script of scripts) {
    if (!script.syncFrom) {
      continue;
    }
    const bundledPath = resolveScriptEntry(extensionPath, script.entry);
    let bundled: string;
    try {
      bundled = fs.readFileSync(bundledPath, "utf-8");
    } catch {
      continue;
    }
    let source: string;
    try {
      source = fs.readFileSync(script.syncFrom, "utf-8");
    } catch {
      drifted.push({
        script,
        reason: "source-missing",
        bundledPath,
        sourcePath: script.syncFrom,
      });
      continue;
    }
    if (bundled !== source) {
      drifted.push({
        script,
        reason: "content-changed",
        bundledPath,
        sourcePath: script.syncFrom,
      });
    }
  }
  return drifted;
}
