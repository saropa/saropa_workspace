import * as vscode from "vscode";

// Default set of "interesting" project files surfaced in the Project Files view.
// Root-relative names; each appears only when it actually exists in a workspace
// folder. The list spans the common provenance/version-bearing manifests across
// stacks (npm, Dart, Rust, Python, Go) plus the standard project docs, so a user
// can see at a glance whether the changelog is current and what version the
// project is up to without opening anything.
export const DEFAULT_PROJECT_FILES: readonly string[] = [
  "README.md",
  "CHANGELOG.md",
  "ROADMAP.md",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "LICENSE",
  "LICENSE.md",
  "package.json",
  "pubspec.yaml",
  "Cargo.toml",
  "pyproject.toml",
  "go.mod",
];

// Files whose content carries a declarable version. Only these are read from
// disk; every other surfaced file is stat-only (cheap, no content read), so the
// scan cost stays at a handful of stats plus a few small reads per folder.
const VERSION_BEARING = new Set([
  "package.json",
  "pubspec.yaml",
  "Cargo.toml",
  "pyproject.toml",
  "CHANGELOG.md",
]);

// One surfaced project file: where it lives, when it was last written on disk,
// and the version it declares (when the file type carries one).
export interface ProjectFileInfo {
  readonly uri: vscode.Uri;
  // Root-relative name as configured (e.g. "package.json").
  readonly name: string;
  // Owning workspace folder name, used to group when several folders are open.
  readonly folderName: string;
  // Last-modified time, epoch ms (file mtime). Reflects live edits, not commits,
  // which is what answers "is the changelog updated".
  readonly modified: number;
  // Declared version, when extractable from the file's content.
  readonly version?: string;
}

// Stat each configured name under each folder and collect the ones that exist.
// A missing file is the normal case (stat throws) and is skipped silently; only
// real files are surfaced (a directory named like a candidate is ignored).
export async function scanProjectFiles(
  folders: readonly vscode.WorkspaceFolder[],
  names: readonly string[]
): Promise<ProjectFileInfo[]> {
  const results: ProjectFileInfo[] = [];
  for (const folder of folders) {
    for (const name of names) {
      const uri = vscode.Uri.joinPath(folder.uri, name);
      let stat: vscode.FileStat;
      try {
        stat = await vscode.workspace.fs.stat(uri);
      } catch {
        // Not present in this folder — the common case, not an error.
        continue;
      }
      if (stat.type !== vscode.FileType.File) {
        continue;
      }
      const version = VERSION_BEARING.has(basename(name))
        ? await readVersion(uri, name)
        : undefined;
      results.push({
        uri,
        name,
        folderName: folder.name,
        modified: stat.mtime,
        version,
      });
    }
  }
  return results;
}

// Read a version-bearing file and pull its declared version. A read or parse
// failure yields no version rather than throwing, so one malformed manifest
// never breaks the whole view.
async function readVersion(
  uri: vscode.Uri,
  name: string
): Promise<string | undefined> {
  try {
    const bytes = await vscode.workspace.fs.readFile(uri);
    const text = Buffer.from(bytes).toString("utf8");
    return extractVersion(basename(name), text);
  } catch {
    return undefined;
  }
}

// Dispatch to the per-format extractor. Exported for unit testing the parse
// rules without touching the filesystem.
export function extractVersion(
  baseName: string,
  text: string
): string | undefined {
  switch (baseName) {
    case "package.json":
      return versionFromPackageJson(text);
    case "pubspec.yaml":
      // YAML: a top-level `version: x.y.z` line (value may be unquoted).
      return matchGroup(text, /^version:\s*["']?([^"'\s#]+)/m);
    case "Cargo.toml":
    case "pyproject.toml":
      // TOML: `version = "x.y.z"`. Both formats quote the value.
      return matchGroup(text, /^\s*version\s*=\s*["']([^"']+)["']/m);
    case "CHANGELOG.md":
      return versionFromChangelog(text);
    default:
      return undefined;
  }
}

function versionFromPackageJson(text: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === "object" && "version" in parsed) {
      const value = (parsed as { version?: unknown }).version;
      return typeof value === "string" ? value : undefined;
    }
  } catch {
    // Malformed JSON — surface the file without a version.
  }
  return undefined;
}

// First heading that names a release version. Requires a leading digit so the
// conventional `## [Unreleased]` placeholder is skipped and the newest actual
// release is reported. Handles `## [1.2.3]`, `## [1.2.3] - 2026-06-25`,
// `## 1.2.3`, and `## v1.2.3`.
function versionFromChangelog(text: string): string | undefined {
  return matchGroup(text, /^#{2,}\s*\[?v?(\d+\.\d+(?:\.\d+)?[\w.+-]*)\]?/m);
}

function matchGroup(text: string, re: RegExp): string | undefined {
  const match = text.match(re);
  const captured = match?.[1]?.trim();
  return captured ? captured : undefined;
}

function basename(name: string): string {
  return name.split("/").pop() ?? name;
}
