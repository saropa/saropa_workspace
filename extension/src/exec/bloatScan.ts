import * as fs from "fs/promises";
import * as path from "path";

// Workspace bloat scanner (recipe book section H, #63 — "Workspace bloat scan").
// Distinct from the empty/oversized FILE scan (hygieneScan.ts): this one catches the
// directory-bloat failure that freezes VS Code on folder-open. VS Code crawls the
// whole workspace on open except a short default exclude list (node_modules, .git);
// ANY immediate child directory that has grown large and is NOT in the workspace's
// files.watcherExclude makes the file watcher + search/TS indexer crawl a huge tree
// and pin a CPU core. Gitignore stops commits; it does not stop the watcher.
//
// The canonical trigger was @vscode/test-electron, which downloads a full ~200 MB
// VS Code build per version under .vscode-test/ and never prunes — one project had
// reached 16.3 GB / 179,824 files across 26 installs. So the scan has two halves:
//   - oversized crawlable dirs: an immediate child over a size / file-count ceiling
//     that is not watcher-excluded (the actual freeze risk).
//   - unguarded test-downloader cache: a project that depends on
//     @vscode/test-(electron|cli) but whose .vscode/settings.json does not exclude
//     **/.vscode-test/** — a finding even when .vscode-test is small or absent today,
//     because it WILL grow.

// What VS Code already excludes from the watcher by default, so an oversized one of
// these is not a finding (the plan's Scan B measures "every immediate child except
// node_modules / .git").
const DEFAULT_WATCHER_SKIP = new Set<string>(["node_modules", ".git"]);

// Directory names that commonly grow large and should be watcher-excluded when
// present and oversized. Used to enrich a finding's remediation, not to gate it —
// ANY oversized crawlable dir is flagged, named or not.
const BLOAT_PRONE_NAMES = new Set<string>([
  ".vscode-test",
  ".vscode-test-web",
  "build",
  "dist",
  "out",
  "coverage",
  "reports",
  ".gradle",
  "Pods",
  ".dart_tool",
  "target",
  "bin",
  "obj",
]);

// Input to one bloat scan: which project roots to measure and the two ceilings that
// decide whether an immediate child directory counts as oversized.
export interface BloatOptions {
  // Absolute project roots to scan (each immediate child of a root is measured).
  roots: string[];
  // A folder whose recursive total exceeds this many bytes is oversized.
  folderCeilingBytes: number;
  // A folder with more than this many files (recursive) is oversized.
  fileCountCeiling: number;
}

// The two things this scan flags: a crawlable directory over a size/file-count
// ceiling, or a project that depends on a VS Code test downloader but has not
// watcher-excluded its (unbounded-growth) cache.
export type BloatKind = "oversizedDir" | "unguardedTestCache";

// One flagged directory or cache, carrying enough detail (measured size, the exact
// watcherExclude glob, a human remediation line) for the Markdown report row to stand
// on its own without the reader re-deriving anything.
export interface BloatFinding {
  // The project root this finding belongs to (for the cross-project report grouping).
  root: string;
  kind: BloatKind;
  // The directory name (oversizedDir) or the cache name (unguardedTestCache).
  name: string;
  // Measured recursive total, when known. For unguardedTestCache the cache may not
  // exist yet, so size is omitted.
  sizeBytes?: number;
  fileCount?: number;
  // True when measurement stopped early at the ceiling, so the report says "at least"
  // rather than implying an exact total (no silent precision claim).
  approx?: boolean;
  // The exact files.watcherExclude glob the remediation adds.
  watcherGlob: string;
  // One-line, human remediation for the report row.
  remediation: string;
}

// Per-project scan tally, independent of whether that project produced any findings —
// feeds the report's "Scanned projects" table so a clean project is still accounted for.
export interface BloatRootSummary {
  root: string;
  // Immediate child dirs measured (excludes node_modules / .git).
  dirsMeasured: number;
  // True when this root depends on @vscode/test-(electron|cli).
  usesTestDownloader: boolean;
  // True when **/.vscode-test/** is already in files.watcherExclude.
  testCacheGuarded: boolean;
}

// The full result of a bloat scan across one or more project roots: every finding,
// a per-root summary, and the one boolean the command layer needs to decide whether
// to badge/auto-open the report or stay silent.
export interface BloatReport {
  roots: string[];
  generatedAt: string;
  findings: BloatFinding[];
  perRoot: BloatRootSummary[];
  // True when any finding crosses a ceiling / is an unguarded cache — drives the
  // red badge + auto-open. A clean scan is silent (badge green, report written for
  // the trend, not opened).
  hasThresholdCross: boolean;
}

// Default ceilings (the plan's open decision #4): 1 GB or 50,000 files per dir.
export const DEFAULT_FOLDER_CEILING_BYTES = 1024 * 1024 * 1024;
// Companion ceiling to DEFAULT_FOLDER_CEILING_BYTES: a directory with more files than
// this is flagged even when its total byte size is small — a huge count of tiny files
// crawls just as slowly as one big one (the @vscode/test-electron cache case).
export const DEFAULT_FILE_COUNT_CEILING = 50_000;

// Measure one directory's recursive byte total and file count, stopping early once
// BOTH ceilings are exceeded — we only need to know a dir is OVER, not its exact
// size, and short-circuiting bounds the worst case on the very tree (180k files)
// that motivated this scan. Symlinks are never followed (cycle / out-of-scope
// safety). An unreadable subtree is skipped rather than aborting the measure.
async function measureDir(
  dir: string,
  options: BloatOptions
): Promise<{ bytes: number; files: number; approx: boolean }> {
  let bytes = 0;
  let files = 0;
  const stack: string[] = [dir];

  while (stack.length > 0) {
    // Once both ceilings are known-exceeded, stop: the verdict cannot change.
    if (bytes > options.folderCeilingBytes && files > options.fileCountCeiling) {
      return { bytes, files, approx: true };
    }
    const current = stack.pop() as string;
    let entries: import("fs").Dirent[];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) {
        continue;
      }
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile()) {
        files++;
        try {
          bytes += (await fs.stat(full)).size;
        } catch {
          // Raced deletion / permission: count the entry, skip its size.
        }
      }
    }
  }
  return { bytes, files, approx: false };
}

// Tolerant read of a project's .vscode/settings.json. VS Code settings are JSONC
// (comments, trailing commas), so a strict JSON.parse fails on real files; strip the
// comments + trailing commas and retry before giving up. Returns the parsed object
// or undefined (absent / unparseable).
async function readSettings(root: string): Promise<Record<string, unknown> | undefined> {
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
function watcherExcludeGlobs(settings: Record<string, unknown> | undefined): string[] {
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
function isWatcherExcluded(name: string, globs: string[]): boolean {
  const needle = name.toLowerCase();
  return globs.some((g) => g.includes(needle));
}

// Read a project's package.json dependency map and report whether it pulls in a
// VS Code test downloader (@vscode/test-electron or @vscode/test-cli) — the package
// that grows .vscode-test without bound.
async function usesTestDownloader(root: string): Promise<boolean> {
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

const HUMAN_GB = (bytes: number): string => `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;

// Human-readable byte size for a toast / prompt (MB under a GB, else GB).
export function humanBytes(bytes: number): string {
  const mb = bytes / 1024 / 1024;
  return mb < 1024 ? `${mb.toFixed(0)} MB` : HUMAN_GB(bytes);
}

// Full recursive size + file count of a directory (no ceiling early-exit), symlink-
// safe. Used by the prune action to name the exact size reclaimed before the confirm.
export async function measureDirectory(
  dir: string
): Promise<{ bytes: number; files: number }> {
  let bytes = 0;
  let files = 0;
  const stack: string[] = [dir];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    let entries: import("fs").Dirent[];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) {
        continue;
      }
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile()) {
        files++;
        try {
          bytes += (await fs.stat(full)).size;
        } catch {
          // raced deletion / permission
        }
      }
    }
  }
  return { bytes, files };
}

// Scan one project root: measure its immediate child dirs, read its watcher guards,
// and emit findings for oversized crawlable dirs + an unguarded test-downloader
// cache. Pure of UI — the command layer writes the report and badges the shortcut.
async function scanRoot(
  root: string,
  options: BloatOptions,
  out: BloatFinding[]
): Promise<BloatRootSummary> {
  const settings = await readSettings(root);
  const globs = watcherExcludeGlobs(settings);
  const guardedTestCache = isWatcherExcluded(".vscode-test", globs);
  const usesDownloader = await usesTestDownloader(root);

  // Half one: oversized, crawlable immediate child dirs.
  let measured = 0;
  let children: import("fs").Dirent[] = [];
  try {
    children = await fs.readdir(root, { withFileTypes: true });
  } catch {
    children = [];
  }
  for (const child of children) {
    if (!child.isDirectory() || child.isSymbolicLink()) {
      continue;
    }
    if (DEFAULT_WATCHER_SKIP.has(child.name)) {
      continue;
    }
    measured++;
    // Already watcher-excluded: VS Code never crawls it, so its size is not a freeze
    // risk — skip the (expensive) measurement entirely.
    if (isWatcherExcluded(child.name, globs)) {
      continue;
    }
    const full = path.join(root, child.name);
    const { bytes, files, approx } = await measureDir(full, options);
    const overSize = bytes > options.folderCeilingBytes;
    const overCount = files > options.fileCountCeiling;
    if (!overSize && !overCount) {
      continue;
    }
    const glob = `**/${child.name}/**`;
    const prunable = BLOAT_PRONE_NAMES.has(child.name);
    out.push({
      root,
      kind: "oversizedDir",
      name: child.name,
      sizeBytes: bytes,
      fileCount: files,
      approx,
      watcherGlob: glob,
      remediation:
        `Add "${glob}": true to files.watcherExclude in .vscode/settings.json` +
        (prunable ? `, and prune / pin ${child.name} so it stops growing.` : "."),
    });
  }

  // Half two: an unguarded test-downloader cache. A finding even when .vscode-test is
  // small or absent today — the guard belongs in place before the cache grows.
  if (usesDownloader && !guardedTestCache) {
    out.push({
      root,
      kind: "unguardedTestCache",
      name: ".vscode-test",
      watcherGlob: "**/.vscode-test/**",
      remediation:
        'Add "**/.vscode-test/**": true to files.watcherExclude (the @vscode test ' +
        "downloader grows .vscode-test without bound); also pin the runner to one " +
        "VS Code version and prune the cache in a posttest / CI step.",
    });
  }

  return {
    root,
    dirsMeasured: measured,
    usesTestDownloader: usesDownloader,
    testCacheGuarded: guardedTestCache,
  };
}

// Scan every root and assemble the report. Findings are sorted oversized-by-size
// first (the biggest offender leads), then the unguarded-cache findings.
export async function scanBloat(options: BloatOptions): Promise<BloatReport> {
  const findings: BloatFinding[] = [];
  const perRoot: BloatRootSummary[] = [];
  for (const root of options.roots) {
    perRoot.push(await scanRoot(root, options, findings));
  }
  findings.sort((a, b) => (b.sizeBytes ?? -1) - (a.sizeBytes ?? -1));
  return {
    roots: options.roots,
    generatedAt: new Date().toISOString(),
    findings,
    perRoot,
    hasThresholdCross: findings.length > 0,
  };
}

// Render the report as Markdown for reports/<stamp>_workspace_hygiene.md. Each
// finding carries its exact remediation (the watcherExclude line to add, the
// prune/pin advice). A clean scan still writes a report (for the trend), it is just
// not auto-opened.
export function renderBloatReport(report: BloatReport, generatedLabel: string): string {
  const lines: string[] = [];
  lines.push("# Workspace bloat scan");
  lines.push("");
  lines.push(`Generated ${generatedLabel}`);
  lines.push("");

  if (report.findings.length === 0) {
    lines.push("No oversized crawlable directories and no unguarded test caches found.");
    lines.push("");
  } else {
    lines.push(
      `${report.findings.length} finding(s) — VS Code crawls these on folder-open, ` +
        "which can pin a CPU core and freeze the window."
    );
    lines.push("");
    lines.push("| Project | Finding | Size | Files | Remediation |");
    lines.push("|---|---|---|---|---|");
    for (const f of report.findings) {
      const project = path.basename(f.root) || f.root;
      const what =
        f.kind === "unguardedTestCache"
          ? "Unguarded .vscode-test (test downloader)"
          : `Oversized dir: ${f.name}`;
      const size =
        f.sizeBytes !== undefined ? `${f.approx ? "≥ " : ""}${HUMAN_GB(f.sizeBytes)}` : "—";
      const files = f.fileCount !== undefined ? `${f.approx ? "≥ " : ""}${f.fileCount}` : "—";
      lines.push(
        `| ${project} | ${what} | ${size} | ${files} | ${f.remediation.replace(/\|/g, "\\|")} |`
      );
    }
    lines.push("");
  }

  lines.push("## Scanned projects");
  lines.push("");
  lines.push("| Project | Dirs measured | Uses test downloader | .vscode-test guarded |");
  lines.push("|---|---|---|---|");
  for (const r of report.perRoot) {
    const project = path.basename(r.root) || r.root;
    lines.push(
      `| ${project} | ${r.dirsMeasured} | ${r.usesTestDownloader ? "yes" : "no"} | ${
        r.testCacheGuarded ? "yes" : r.usesTestDownloader ? "**NO**" : "n/a"
      } |`
    );
  }
  lines.push("");
  return lines.join("\n");
}
