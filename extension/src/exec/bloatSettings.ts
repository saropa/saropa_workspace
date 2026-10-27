// Project settings probes for the bloat scan: tolerant settings.json read, watcher
// exclusion globs and test-downloader detection. Split out of bloatScan.ts.

import * as fs from "fs/promises";
import * as path from "path";

// Tolerant read of a project's .vscode/settings.json. VS Code settings are JSONC
// (comments, trailing commas), so a strict JSON.parse fails on real files; strip the
// comments + trailing commas and retry before giving up. Returns the parsed object
// or undefined (absent / unparseable).
export async function readSettings(root: string): Promise<Record<string, unknown> | undefined> {
  let text: string;
  try {
    text = await fs.readFile(path.join(root, ".vscode", "settings.json"), "utf8");
  } catch {
    return undefined;
  }
  for (const candidate of [text, stripJsonc(text)]) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (parsed && typeof parsed === "object") {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // try the stripped form next
    }
  }
  return undefined;
}

// Remove // line comments, /* */ block comments, and trailing commas so a JSONC
// settings file parses. Deliberately light — it is a fallback for the strict parse,
// not a full JSONC engine, and never runs on already-valid JSON.
function stripJsonc(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
    .replace(/,(\s*[}\]])/g, "$1");
}

// The set of files.watcherExclude glob keys whose value is truthy, lowercased for a
// tolerant name match. An exclude like "**/.vscode-test/**" guards the .vscode-test
// cache; "**/build/**" guards build, etc.
export function watcherExcludeGlobs(settings: Record<string, unknown> | undefined): string[] {
  const raw = settings?.["files.watcherExclude"];
  if (!raw || typeof raw !== "object") {
    return [];
  }
  return Object.entries(raw as Record<string, unknown>)
    .filter(([, on]) => on !== false)
    .map(([glob]) => glob.toLowerCase());
}

// Whether an existing watcherExclude entry already covers a directory name (e.g.
// "**/.vscode-test/**" covers ".vscode-test"). A substring match on the name is
// enough — the globs are simple path patterns naming the directory.
export function isWatcherExcluded(name: string, globs: string[]): boolean {
  const needle = name.toLowerCase();
  return globs.some((g) => g.includes(needle));
}

// Read a project's package.json dependency map and report whether it pulls in a
// VS Code test downloader (@vscode/test-electron or @vscode/test-cli) — the package
// that grows .vscode-test without bound.
export async function usesTestDownloader(root: string): Promise<boolean> {
  let text: string;
  try {
    text = await fs.readFile(path.join(root, "package.json"), "utf8");
  } catch {
    return false;
  }
  try {
    const pkg = JSON.parse(text) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    return "@vscode/test-electron" in deps || "@vscode/test-cli" in deps;
  } catch {
    return false;
  }
}
