import * as vscode from "vscode";

// One curated category of "interesting" project files surfaced in the Project
// Files view. The category label is both the display name and the grouping key.
// Like the synthetic shortcut groups in shortcutStoreShared.ts, the label / glyph
// live inline in this routing table (not in the l10n catalog): they are one-word
// structural folder names kept beside their files so the table is one source of
// truth (see STYLEGUIDE §2, "Synthetic group folder labels are inline").
export interface ProjectFileGroup {
  // Display label and grouping key, e.g. "Android". American English, inline.
  readonly category: string;
  // Codicon id for the category node in the tree. Verified-real product icons
  // only (a non-existent id renders blank with no error — STYLEGUIDE §3).
  readonly glyph: string;
  // Root-relative paths in this category. A path may be nested (e.g.
  // "android/app/build.gradle"); the scanner joins it under each folder and the
  // view shows only the basename. Each appears only when it exists on disk.
  readonly files: readonly string[];
}

// Default catalog: a curated core of the files worth seeing at a glance, grouped
// by where they belong, kept deliberately tight so the useful files are not lost
// among a project's logs and generated junk. "Project" spans the cross-stack
// provenance/version manifests and the standard docs plus the Dart analysis/l10n
// config; the platform groups carry only the few config files a Flutter (or
// native mobile/web) author actually edits. Both the plain `.gradle` (Groovy DSL)
// and `.gradle.kts` (Kotlin DSL) spellings are listed because either may be
// present and only the existing one is surfaced.
export const DEFAULT_PROJECT_FILE_GROUPS: readonly ProjectFileGroup[] = [
  {
    category: "Project",
    glyph: "package",
    files: [
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
      "analysis_options.yaml",
      "l10n.yaml",
    ],
  },
  {
    category: "Android",
    glyph: "device-mobile",
    files: [
      "android/build.gradle",
      "android/build.gradle.kts",
      "android/settings.gradle",
      "android/settings.gradle.kts",
      "android/gradle.properties",
      "android/app/build.gradle",
      "android/app/build.gradle.kts",
      "android/local.properties",
      "android/app/src/main/AndroidManifest.xml",
    ],
  },
  {
    category: "iOS",
    glyph: "device-mobile",
    files: ["ios/Podfile", "ios/Runner/Info.plist"],
  },
  {
    category: "Web",
    glyph: "globe",
    files: ["web/index.html", "web/manifest.json"],
  },
];

// Codicon shown on a category node, looked up from the curated catalog so a
// known category keeps its glyph even when the file list is overridden in
// settings. A user-defined category (one not in the defaults) falls back to the
// generic folder glyph rather than rendering blank.
export function glyphForCategory(category: string): string {
  const known = DEFAULT_PROJECT_FILE_GROUPS.find((g) => g.category === category);
  return known?.glyph ?? "folder";
}

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

// One surfaced project file: where it lives, which category surfaced it, when it
// was last written on disk, and the version it declares (when the type carries
// one).
export interface ProjectFileInfo {
  readonly uri: vscode.Uri;
  // Root-relative path as configured (e.g. "android/app/build.gradle").
  readonly name: string;
  // The category that surfaced this file, used to group the view.
  readonly category: string;
  // Owning workspace folder name, used to group when several folders are open.
  readonly folderName: string;
  // Last-modified time, epoch ms (file mtime). Reflects live edits, not commits,
  // which is what answers "is the changelog updated".
  readonly modified: number;
  // Declared version, when extractable from the file's content.
  readonly version?: string;
}

// Stat each configured path under each folder and collect the ones that exist,
// tagging every result with the category that surfaced it. A missing file is the
// normal case (stat throws) and is skipped silently; only real files are surfaced
// (a directory named like a candidate is ignored).
export async function scanProjectFiles(
  folders: readonly vscode.WorkspaceFolder[],
  groups: readonly ProjectFileGroup[]
): Promise<ProjectFileInfo[]> {
  const results: ProjectFileInfo[] = [];
  for (const folder of folders) {
    for (const group of groups) {
      for (const name of group.files) {
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
          category: group.category,
          folderName: folder.name,
          modified: stat.mtime,
          version,
        });
      }
    }
  }
  return results;
}

// One category bucket of a scan result: the category and the files that landed in
// it. Returned in the supplied category order (not alphabetical) so the view's
// groups read in catalog order (Project, then the platform groups).
export interface ProjectFileCategory {
  readonly category: string;
  readonly files: readonly ProjectFileInfo[];
}

// Bucket surfaced files by category, preserving the catalog's category order and
// dropping categories with no surfaced files. Pure (no filesystem, no host), so
// the grouping/ordering/empty-skip logic is unit-testable without the VS Code
// tree. The caller decides whether to render the buckets as group nodes — the
// "only group when more than one category is present" rule lives at the call site,
// which is why this always returns every non-empty bucket.
export function groupFilesByCategory(
  found: readonly ProjectFileInfo[],
  order: readonly string[]
): ProjectFileCategory[] {
  const byCategory = new Map<string, ProjectFileInfo[]>();
  for (const info of found) {
    const bucket = byCategory.get(info.category);
    if (bucket) {
      bucket.push(info);
    } else {
      byCategory.set(info.category, [info]);
    }
  }
  const result: ProjectFileCategory[] = [];
  // Catalog order first, so known groups read in their declared sequence.
  for (const category of order) {
    const files = byCategory.get(category);
    if (files) {
      result.push({ category, files });
      byCategory.delete(category);
    }
  }
  // Any category not in the supplied order (a user-defined group) follows, in
  // first-seen order, so a custom group is still shown rather than dropped.
  for (const [category, files] of byCategory) {
    result.push({ category, files });
  }
  return result;
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
