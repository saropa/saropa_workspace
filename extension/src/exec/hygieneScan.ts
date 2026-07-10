import * as fs from "fs/promises";
import * as path from "path";

// Workspace hygiene scanner (recipe book section H, #63). Unlike every other recipe
// — which reads only marker files at a folder root — this one DELIBERATELY performs
// a recursive crawl of a chosen scope and reports the outliers at the extremes:
// empty (zero-byte files, zero-child folders) and oversized (files past a ceiling,
// folders whose total size is past a ceiling). The "no full disk crawl" rule governs
// auto-DETECTION (which still reads only marker files); this is an explicit,
// user-run scan the user asked for, so the crawl is intended.
//
// Safety against a runaway crawl: a built-in ignore set (plus the project's
// top-level .gitignore when enabled, plus user excludes) keeps the walk out of
// node_modules / .git / build output, symlinked directories are never followed (no
// cycle), and the finding list is capped so a pathological tree cannot produce an
// unbounded report.

export type ScanMode = "empty" | "oversized" | "both";

// Input to one hygiene crawl: which roots, which finding mode, the size ceilings/floor,
// and how the walk is filtered (built-in ignores, optional .gitignore, user excludes).
export interface ScanOptions {
  // Absolute directories to crawl (one per chosen scope folder, or all workspace
  // folders for a whole-project scan).
  roots: string[];
  mode: ScanMode;
  // Oversized ceilings, in bytes. A file/folder strictly above its ceiling is an
  // outlier.
  fileMaxBytes: number;
  folderMaxBytes: number;
  // Optional floor: a non-empty file strictly below this is flagged as an
  // under-size outlier. Undefined disables the floor check.
  fileMinBytes?: number;
  // Read the project's top-level .gitignore and skip what it names (plus the always
  // built-in ignore set). Off means only the built-in set + user excludes apply.
  respectGitignore: boolean;
  // Extra exclude globs (matched against each entry's path relative to its root).
  excludeGlobs: string[];
}

// The five outlier shapes this scan reports: zero-byte files, childless folders, files
// or folders past their size ceiling, and files under the optional size floor.
export type FindingKind =
  | "emptyFile"
  | "emptyFolder"
  | "largeFile"
  | "largeFolder"
  | "smallFile";

// One flagged file or folder, carrying enough of its own measurement (size, child
// count, the breached threshold) that a report row needs no further lookup.
export interface Finding {
  // Absolute path of the outlier.
  path: string;
  // Path relative to the scan root it was found under, for a compact report.
  relPath: string;
  kind: FindingKind;
  // The measured size (files, and the recursive total for folders) in bytes.
  sizeBytes?: number;
  // The visible child count for a folder finding.
  childCount?: number;
  // The ceiling/floor the finding breached, for the size-based kinds.
  threshold?: number;
}

// The full result of one hygiene crawl: every finding plus enough scan metadata
// (thresholds used, scope, counts, whether the finding cap truncated it) for the
// written JSON report and the summary toast to stand on their own.
export interface ScanReport {
  mode: ScanMode;
  thresholds: {
    fileMaxBytes: number;
    folderMaxBytes: number;
    fileMinBytes?: number;
  };
  scope: string[];
  // ISO timestamp of the scan, so the artifact is diffable run-to-run.
  generatedAt: string;
  findings: Finding[];
  // True when the finding cap was hit, so the consumer can say "and more" rather
  // than implying the report is exhaustive (no silent truncation).
  truncated: boolean;
  // Directories and files visited, for context on how much was scanned.
  dirsScanned: number;
  filesScanned: number;
}

// Hard cap on findings so a pathological tree (thousands of empty files) cannot
// produce an unbounded report or freeze the JSON write. Surfaced via `truncated`.
const MAX_FINDINGS = 5000;

// Always skipped, regardless of .gitignore: version-control internals and the
// heavy generated/dependency directories a crawl must never descend into. Without
// this a scan of a Node or Dart project would walk node_modules / .dart_tool and
// take minutes while reporting noise.
const BUILTIN_IGNORE_DIRS = new Set<string>([
  ".git",
  "node_modules",
  ".dart_tool",
  ".gradle",
  "build",
  "dist",
  "out",
  ".next",
  ".nuxt",
  ".svelte-kit",
  "target",
  ".venv",
  "venv",
  "__pycache__",
  ".mypy_cache",
  ".pytest_cache",
  ".idea",
  ".vs",
]);

// Convert a simple ignore/exclude glob to a RegExp. Supports `*` (any run within a
// segment), `**` (across segments), `?`, and a trailing `/` (directory). Anything
// fancier than this is intentionally out of scope — the scanner is not a full
// gitignore engine, and the built-in ignore set covers the heavy cases.
function globToRegExp(glob: string): RegExp {
  const trimmed = glob.replace(/\/$/, "");
  let re = "";
  for (let i = 0; i < trimmed.length; i++) {
    const c = trimmed[i];
    if (c === "*") {
      if (trimmed[i + 1] === "*") {
        re += ".*";
        i++;
      } else {
        re += "[^/]*";
      }
    } else if (c === "?") {
      re += "[^/]";
    } else if ("\\^$.|+()[]{}".includes(c)) {
      re += "\\" + c;
    } else {
      re += c;
    }
  }
  // Match the whole relative path or any path segment tail, so "logs" matches both
  // "logs" and "a/logs", mirroring gitignore's name-anywhere behavior.
  return new RegExp(`(^|/)${re}(/|$)`);
}

// Read the top-level .gitignore of a root into bare name/glob patterns. Blank lines,
// comments, and negations (!) are dropped — negation needs full gitignore ordering
// semantics this light reader does not implement, so it is ignored rather than
// half-honored.
async function readGitignore(root: string): Promise<string[]> {
  try {
    const text = await fs.readFile(path.join(root, ".gitignore"), "utf8");
    return text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#") && !line.startsWith("!"));
  } catch {
    return [];
  }
}

interface Compiled {
  excludes: RegExp[];
  ignoreNames: Set<string>;
}

// Build the skip predicate inputs for a root: the always-ignore set plus the
// gitignore-derived names/globs plus the user excludes.
async function compile(root: string, options: ScanOptions): Promise<Compiled> {
  const ignoreNames = new Set(BUILTIN_IGNORE_DIRS);
  const excludes = options.excludeGlobs.map(globToRegExp);
  if (options.respectGitignore) {
    for (const pattern of await readGitignore(root)) {
      // A bare name (no slash, no wildcard) is a fast name-set membership check; a
      // pattern with structure becomes a regex exclude.
      if (/^[^/*?]+$/.test(pattern)) {
        ignoreNames.add(pattern);
      } else {
        excludes.push(globToRegExp(pattern));
      }
    }
  }
  return { excludes, ignoreNames };
}

function isExcluded(name: string, relPath: string, compiled: Compiled): boolean {
  if (compiled.ignoreNames.has(name)) {
    return true;
  }
  const normalized = relPath.split(path.sep).join("/");
  return compiled.excludes.some((re) => re.test(normalized));
}

// The recursive descent for one root. Returns the directory's recursive byte total
// and file count so a parent can roll up its own total. Pushes findings into the
// shared array; stops descending once the finding cap is hit.
async function crawl(
  dir: string,
  root: string,
  options: ScanOptions,
  compiled: Compiled,
  report: ScanReport
): Promise<{ bytes: number; files: number }> {
  report.dirsScanned++;
  let totalBytes = 0;
  let totalFiles = 0;
  let visibleChildren = 0;

  let entries: import("fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    // Unreadable directory (permissions, raced deletion): treat as empty rather
    // than aborting the whole scan.
    return { bytes: 0, files: 0 };
  }

  for (const entry of entries) {
    if (report.findings.length >= MAX_FINDINGS) {
      report.truncated = true;
      break;
    }
    // Never follow a symlink: it can point outside the scope or form a cycle that
    // would make the crawl non-terminating.
    if (entry.isSymbolicLink()) {
      continue;
    }
    const full = path.join(dir, entry.name);
    const rel = path.relative(root, full);
    if (isExcluded(entry.name, rel, compiled)) {
      continue;
    }
    visibleChildren++;

    if (entry.isDirectory()) {
      const sub = await crawl(full, root, options, compiled, report);
      totalBytes += sub.bytes;
      totalFiles += sub.files;
    } else if (entry.isFile()) {
      let size = 0;
      try {
        size = (await fs.stat(full)).size;
      } catch {
        continue;
      }
      report.filesScanned++;
      totalBytes += size;
      totalFiles++;
      evaluateFile(full, rel, size, options, report);
    }
  }

  evaluateFolder(dir, root, totalBytes, visibleChildren, options, report);
  return { bytes: totalBytes, files: totalFiles };
}

function evaluateFile(
  full: string,
  rel: string,
  size: number,
  options: ScanOptions,
  report: ScanReport
): void {
  const wantsEmpty = options.mode === "empty" || options.mode === "both";
  const wantsOversized = options.mode === "oversized" || options.mode === "both";
  if (wantsEmpty && size === 0) {
    report.findings.push({ path: full, relPath: rel, kind: "emptyFile", sizeBytes: 0 });
    return;
  }
  if (wantsOversized && size > options.fileMaxBytes) {
    report.findings.push({
      path: full,
      relPath: rel,
      kind: "largeFile",
      sizeBytes: size,
      threshold: options.fileMaxBytes,
    });
  }
  // The optional floor flags a non-empty file under the minimum (an empty file is
  // already covered by emptyFile, so it is not double-reported here).
  if (options.fileMinBytes !== undefined && size > 0 && size < options.fileMinBytes) {
    report.findings.push({
      path: full,
      relPath: rel,
      kind: "smallFile",
      sizeBytes: size,
      threshold: options.fileMinBytes,
    });
  }
}

function evaluateFolder(
  dir: string,
  root: string,
  totalBytes: number,
  visibleChildren: number,
  options: ScanOptions,
  report: ScanReport
): void {
  // The scan root itself is never reported as an empty/large folder outlier — the
  // user chose it as the scope, so flagging it is noise.
  if (dir === root) {
    return;
  }
  const rel = path.relative(root, dir);
  const wantsEmpty = options.mode === "empty" || options.mode === "both";
  const wantsOversized = options.mode === "oversized" || options.mode === "both";
  if (wantsEmpty && visibleChildren === 0) {
    report.findings.push({ path: dir, relPath: rel, kind: "emptyFolder", childCount: 0 });
    return;
  }
  if (wantsOversized && totalBytes > options.folderMaxBytes) {
    report.findings.push({
      path: dir,
      relPath: rel,
      kind: "largeFolder",
      sizeBytes: totalBytes,
      childCount: visibleChildren,
      threshold: options.folderMaxBytes,
    });
  }
}

// Crawl every root under the chosen options and return the structured report. The
// findings are sorted largest-first (then empties), so the report and the toast
// lead with the biggest offender.
export async function scanOutliers(options: ScanOptions): Promise<ScanReport> {
  const report: ScanReport = {
    mode: options.mode,
    thresholds: {
      fileMaxBytes: options.fileMaxBytes,
      folderMaxBytes: options.folderMaxBytes,
      fileMinBytes: options.fileMinBytes,
    },
    scope: options.roots,
    generatedAt: new Date().toISOString(),
    findings: [],
    truncated: false,
    dirsScanned: 0,
    filesScanned: 0,
  };
  for (const root of options.roots) {
    if (report.findings.length >= MAX_FINDINGS) {
      report.truncated = true;
      break;
    }
    const compiled = await compile(root, options);
    await crawl(root, root, options, compiled, report);
  }
  // Oversized findings (by size desc) lead; empties follow, grouped after, since
  // they have no size to rank.
  report.findings.sort((a, b) => (b.sizeBytes ?? -1) - (a.sizeBytes ?? -1));
  return report;
}
