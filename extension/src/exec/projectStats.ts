import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs/promises";
import { promisify } from "util";
import { execFile as execFileCb } from "child_process";
import { expandRecipeTokens, reportRelativePath } from "./runner";
import { l10n } from "../i18n/l10n";

const execFile = promisify(execFileCb);

// Sunrise project stats (recipe book #27). The original recipe captured only a git
// activity summary; this completes the design's "per-language file/line aggregation"
// — a breakdown of the tracked codebase by language (files, lines, share) alongside
// the recent-activity summary, written to a dated report and opened.
//
// Tracked files come from `git ls-files` (so .gitignore is honored for free and no
// recursive crawl is needed), and lines are counted by reading each text file once.
// The work is bounded: a file cap, a per-file size cap, and binary-file skipping
// keep a large repo from freezing the run.

const MAX_FILES = 20000;
// A file larger than this is counted toward bytes but not read for lines — a 50 MB
// generated artifact should not be slurped to count newlines.
const MAX_LINE_READ_BYTES = 2 * 1024 * 1024;
// git ls-files / log output can be large; lift execFile's 1 MB default.
const MAX_GIT_BUFFER = 64 * 1024 * 1024;
// Hard cap on any single git sub-command so a stdin-blocking call (see git()) can
// never hang the whole report. Generous: even a slow `log`/`ls-files` on a large
// repo finishes well under this.
const GIT_TIMEOUT_MS = 30_000;

interface LangStat {
  language: string;
  files: number;
  lines: number;
  bytes: number;
}

// The full stats-report payload: per-language file/line/byte breakdown plus the
// recent git activity summary, assembled once by collectProjectStats and
// rendered by buildStatsMarkdown.
export interface ProjectStats {
  root: string;
  generatedAt: string;
  totalFiles: number;
  totalLines: number;
  totalBytes: number;
  languages: LangStat[];
  // True when the tracked-file count exceeded MAX_FILES, so the report says so
  // rather than implying it covered everything.
  truncated: boolean;
  branch?: string;
  recentCommits: string;
  contributors: string;
}

// Extension -> human language name. Covers the common ecosystems; an unknown
// extension is grouped under its own ".ext" bucket, and an extensionless file under
// "(no extension)", so nothing is silently dropped.
const LANGUAGE_BY_EXT: Record<string, string> = {
  ".ts": "TypeScript",
  ".tsx": "TypeScript (JSX)",
  ".js": "JavaScript",
  ".jsx": "JavaScript (JSX)",
  ".mjs": "JavaScript",
  ".cjs": "JavaScript",
  ".dart": "Dart",
  ".py": "Python",
  ".rs": "Rust",
  ".go": "Go",
  ".java": "Java",
  ".kt": "Kotlin",
  ".swift": "Swift",
  ".c": "C",
  ".h": "C/C++ header",
  ".cpp": "C++",
  ".cc": "C++",
  ".cs": "C#",
  ".rb": "Ruby",
  ".php": "PHP",
  ".sh": "Shell",
  ".ps1": "PowerShell",
  ".sql": "SQL",
  ".html": "HTML",
  ".css": "CSS",
  ".scss": "SCSS",
  ".vue": "Vue",
  ".svelte": "Svelte",
  ".json": "JSON",
  ".yaml": "YAML",
  ".yml": "YAML",
  ".toml": "TOML",
  ".xml": "XML",
  ".md": "Markdown",
};

function languageFor(file: string): string {
  const ext = path.extname(file).toLowerCase();
  if (ext === "") {
    return "(no extension)";
  }
  return LANGUAGE_BY_EXT[ext] ?? ext;
}

// Count text lines in a buffer: newline count, plus one for a final line with no
// trailing newline. An empty file is 0 lines. A buffer with a NUL byte in its head is
// treated as binary (0 lines) — counting newlines in a binary is meaningless.
function countLines(buffer: Buffer): number {
  if (buffer.length === 0) {
    return 0;
  }
  if (buffer.subarray(0, 8000).includes(0)) {
    return 0;
  }
  let lines = 0;
  for (let i = 0; i < buffer.length; i++) {
    if (buffer[i] === 0x0a) {
      lines++;
    }
  }
  // A trailing non-newline-terminated line still counts.
  if (buffer[buffer.length - 1] !== 0x0a) {
    lines++;
  }
  return lines;
}

// Run a git command in the root, returning trimmed stdout or "" on any failure (a
// missing git, a non-repo, a command error) so one failed sub-command never aborts
// the whole report.
async function git(root: string, args: string[]): Promise<string> {
  try {
    // timeout guards against a git subcommand that blocks on stdin: when a command
    // has no other input source it falls back to reading stdin, and the inherited
    // pipe never closes, so it waits forever (the run hung on the "Collecting
    // project stats" notification with the git process at 0% CPU). The timeout sends
    // SIGTERM so the catch below turns a hang into a graceful empty result. The
    // shortlog call below also passes an explicit HEAD range so it never reaches
    // this fallback in the first place.
    const { stdout } = await execFile("git", args, {
      cwd: root,
      maxBuffer: MAX_GIT_BUFFER,
      timeout: GIT_TIMEOUT_MS,
    });
    return stdout.trim();
  } catch {
    return "";
  }
}

// Walk the tracked files (via `git ls-files`, so .gitignore is honored for free
// and no recursive crawl is needed), bucket them by language, and count
// lines/bytes per bucket, alongside a recent git activity summary. Bounded by
// MAX_FILES / MAX_LINE_READ_BYTES so a large repo cannot freeze the run; a
// truncated listing is flagged on the result rather than silently under-reported.
export async function collectProjectStats(root: string): Promise<ProjectStats> {
  const stats: ProjectStats = {
    root,
    generatedAt: new Date().toISOString(),
    totalFiles: 0,
    totalLines: 0,
    totalBytes: 0,
    languages: [],
    truncated: false,
    branch: (await git(root, ["rev-parse", "--abbrev-ref", "HEAD"])) || undefined,
    recentCommits: await git(root, ["log", "--oneline", "-30"]),
    // Explicit HEAD range is required: `git shortlog` with no revision range reads
    // commit data from stdin, and under execFile (stdin is an open pipe, not a tty)
    // it blocks forever. Passing HEAD makes it walk history instead.
    contributors: await git(root, ["shortlog", "-sn", "--since=30 days ago", "HEAD"]),
  };

  // NUL-delimited so paths with spaces/newlines are handled correctly.
  const listing = await git(root, ["ls-files", "-z"]);
  const files = listing ? listing.split("\0").filter((f) => f.length > 0) : [];
  if (files.length > MAX_FILES) {
    stats.truncated = true;
  }

  const byLang = new Map<string, LangStat>();
  for (const rel of files.slice(0, MAX_FILES)) {
    const full = path.join(root, rel);
    let size = 0;
    let lines = 0;
    try {
      const stat = await fs.stat(full);
      size = stat.size;
      // Only read for line counting up to the size cap; a huge file still counts its
      // bytes but contributes no line total (and is not slurped into memory).
      if (size > 0 && size <= MAX_LINE_READ_BYTES) {
        lines = countLines(await fs.readFile(full));
      }
    } catch {
      // A file listed by git but unreadable now (raced deletion, permissions): skip
      // its size/lines but still count it as a tracked file below.
    }
    const language = languageFor(rel);
    const entry =
      byLang.get(language) ?? { language, files: 0, lines: 0, bytes: 0 };
    entry.files++;
    entry.lines += lines;
    entry.bytes += size;
    byLang.set(language, entry);
    stats.totalFiles++;
    stats.totalLines += lines;
    stats.totalBytes += size;
  }

  // Largest by line count leads — the report and any future badge read top-down.
  stats.languages = [...byLang.values()].sort((a, b) => b.lines - a.lines);
  return stats;
}

function fmtBytes(bytes: number): string {
  if (bytes <= 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB", "TB"];
  const exp = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / Math.pow(1024, exp);
  return `${value.toFixed(value >= 100 || exp === 0 ? 0 : 1)} ${units[exp]}`;
}

// Render the stats as a Markdown report: a per-language table (with each language's
// share of total lines), the totals, and the recent git activity.
export function buildStatsMarkdown(stats: ProjectStats): string {
  const lines: string[] = [];
  lines.push("# Project stats");
  lines.push("");
  lines.push(`Generated ${new Date(stats.generatedAt).toLocaleString()}`);
  if (stats.branch) {
    lines.push(`Branch: \`${stats.branch}\``);
  }
  lines.push("");

  lines.push("## By language");
  lines.push("");
  if (stats.truncated) {
    lines.push(
      `> Capped at the first ${MAX_FILES.toLocaleString()} tracked files; the totals below cover that subset.`
    );
    lines.push("");
  }
  lines.push("| Language | Files | Lines | Share | Size |");
  lines.push("|----------|------:|------:|------:|-----:|");
  for (const lang of stats.languages) {
    const share =
      stats.totalLines > 0
        ? `${((lang.lines / stats.totalLines) * 100).toFixed(1)}%`
        : "-";
    lines.push(
      `| ${lang.language} | ${lang.files.toLocaleString()} | ${lang.lines.toLocaleString()} | ${share} | ${fmtBytes(lang.bytes)} |`
    );
  }
  lines.push(
    `| **Total** | **${stats.totalFiles.toLocaleString()}** | **${stats.totalLines.toLocaleString()}** | **100%** | **${fmtBytes(stats.totalBytes)}** |`
  );
  lines.push("");

  lines.push("## Recent commits (last 30)");
  lines.push("");
  lines.push("```");
  lines.push(stats.recentCommits || "(none)");
  lines.push("```");
  lines.push("");

  lines.push("## Contributors (last 30 days)");
  lines.push("");
  lines.push("```");
  lines.push(stats.contributors || "(none)");
  lines.push("```");
  lines.push("");
  return lines.join("\n");
}

// Register the project-stats command: collect the per-language + git summary, write
// a dated report under reports/, and open it. The folder is the command arg (a
// scheduled recipe stores its folder path) or the first workspace folder.
export function registerProjectStatsCommand(
  context: vscode.ExtensionContext
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "saropaWorkspace.recipe.projectStats",
      // Returns the written report path so a routine summary can link it (the
      // command dispatcher records the returned path for the shortcut).
      (folderPath?: unknown) => runProjectStats(folderPath)
    )
  );
}

async function runProjectStats(folderPath?: unknown): Promise<string | undefined> {
  const root =
    typeof folderPath === "string" && folderPath.length > 0
      ? folderPath
      : vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!root) {
    vscode.window.showWarningMessage(l10n("stats.noFolder"));
    return undefined;
  }
  const stats = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: l10n("stats.collecting") },
    () => collectProjectStats(root)
  );

  const relative = expandRecipeTokens(reportRelativePath("project_stats"));
  const file = path.join(root, ...relative.split("/"));
  try {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, buildStatsMarkdown(stats), "utf8");
  } catch (err) {
    vscode.window.showErrorMessage(
      l10n("stats.failed", { error: err instanceof Error ? err.message : String(err) })
    );
    return undefined;
  }
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
  await vscode.window.showTextDocument(doc, { preview: false });
  vscode.window.showInformationMessage(
    l10n("stats.done", {
      languages: stats.languages.length,
      files: stats.totalFiles,
      lines: stats.totalLines,
    })
  );
  return file;
}
