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

  return manifest.scripts.map((entry) => ({
    id: entry.id,
    label: l10n(entry.labelKey),
    description: l10n(entry.descriptionKey),
    icon: entry.icon,
    tags: entry.tags ?? [],
    entry: entry.entry,
    requires: entry.requires ?? [],
    config: entry.config,
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
