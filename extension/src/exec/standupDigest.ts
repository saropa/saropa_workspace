import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs/promises";
import { promisify } from "util";
import { execFile as execFileCb } from "child_process";
import { expandRecipeTokens, reportRelativePath } from "./runner";
import { openReport } from "./reportOpen";
import { parseShortstat, describeQuiet } from "./overnightDelta";
import { fenceBlock } from "./actionRunner";
import { l10n } from "../i18n/l10n";

const execFile = promisify(execFileCb);

// Git is slow on huge repos: stop waiting after 30 s and cap captured output.
const GIT_TIMEOUT_MS = 30_000;
const MAX_GIT_BUFFER = 64 * 1024 * 1024;

// How far back the digest looks (passed to `git log --since`).
const WINDOW = "24 hours ago";

// A "chore" commit touching more than this many lines is treated as generated
// churn (translations, lockfiles) and folded out of the hand-work counts.
const CHURN_LINE_THRESHOLD = 10_000;

// Subjects that mark a commit as generated churn regardless of its size.
const CHURN_SUBJECT_RE = /machine-translation|auto-generated|regenerated?/i;
// Words that promote a commit to the "Security" section (and the headline).
const SECURITY_RE = /security|auth|token|credential|vulnerab/i;
// Conventional-commit subject: type, optional (scope), optional ! (breaking), text.
const CONVENTIONAL_RE = /^(\w+)(?:\(([^)]*)\))?(!)?:\s*(.*)$/;

/** One commit from `git log --shortstat`, with its conventional-commit parts split out. */
export interface CommitEntry {
  sha: string;
  subject: string;
  filesChanged: number;
  insertions: number;
  deletions: number;
  type?: string;
  scope?: string;
  breaking: boolean;
  description: string;
}

/** Fix commits that share a scope, folded into one line of the report. */
export interface FixGroup {
  scope: string;
  count: number;
  latestSubject: string;
}

/** Count of commits of one other type (docs, refactor, ...) with no section of their own. */
export interface OtherGroup {
  type: string;
  count: number;
}

/** The classified last-24-hours picture that the Markdown report is built from. */
export interface StandupDigest {
  total: number;
  churn: { commits: number; insertions: number; deletions: number };
  security: CommitEntry[];
  features: CommitEntry[];
  fixGroups: FixGroup[];
  otherGroups: OtherGroup[];
  insertions: number;
  deletions: number;
  latestCommitIso?: string;
}

/** Runs git in `root`; any failure (not a repo, timeout) yields an empty string. */
async function git(root: string, args: string[]): Promise<string> {
  try {
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

// Splits "feat(scope)!: text" into its parts; a non-conventional subject keeps
// the whole line as the description. Exported for tests.
export function parseConventionalCommit(subject: string): {
  type: string | undefined;
  scope: string | undefined;
  breaking: boolean;
  description: string;
} {
  const m = CONVENTIONAL_RE.exec(subject);
  if (!m) {
    return { type: undefined, scope: undefined, breaking: false, description: subject };
  }
  return {
    type: m[1]?.toLowerCase(),
    scope: m[2] || undefined,
    breaking: m[3] === "!",
    description: m[4] ?? "",
  };
}

// Parse tab-separated git log output into commit entries. A line starting with
// "<hex sha><TAB>" opens a commit; the following "N files changed" line (from
// --shortstat) fills in that commit's size. Exported for tests.
export function parseGitLog(raw: string): CommitEntry[] {
  if (!raw) {
    return [];
  }
  const entries: CommitEntry[] = [];
  const lines = raw.split("\n");
  let current: CommitEntry | undefined;

  for (const line of lines) {
    if (line === "") {
      continue;
    }
    const tabIdx = line.indexOf("\t");
    if (tabIdx > 0 && /^[0-9a-f]+$/.test(line.slice(0, tabIdx))) {
      if (current) {
        entries.push(current);
      }
      const sha = line.slice(0, tabIdx);
      const subject = line.slice(tabIdx + 1);
      const parsed = parseConventionalCommit(subject);
      current = {
        sha,
        subject,
        filesChanged: 0,
        insertions: 0,
        deletions: 0,
        type: parsed.type,
        scope: parsed.scope,
        breaking: parsed.breaking,
        description: parsed.description,
      };
    } else if (current && /\d+ files? changed/.test(line)) {
      const stats = parseShortstat(line);
      current.filesChanged = stats.filesChanged;
      current.insertions = stats.insertions;
      current.deletions = stats.deletions;
    }
  }
  if (current) {
    entries.push(current);
  }
  return entries;
}

/** True for a generated-churn commit: a huge "chore", or a churn-marker subject. */
function isChurnCommit(e: CommitEntry): boolean {
  const byLines =
    e.type === "chore" && e.insertions + e.deletions > CHURN_LINE_THRESHOLD;
  return byLines || CHURN_SUBJECT_RE.test(e.subject);
}

/** True when the scope, text or type mentions security, or the commit is breaking. */
function isSecurityCommit(e: CommitEntry): boolean {
  return (
    SECURITY_RE.test(e.scope ?? "") ||
    SECURITY_RE.test(e.description) ||
    SECURITY_RE.test(e.type ?? "") ||
    e.breaking
  );
}

/** Adds a fix commit to its scope group; the last commit seen becomes "latest". */
function addToFixGroup(
  fixMap: Map<string, { count: number; latestSubject: string }>,
  e: CommitEntry
): void {
  const scope = e.scope ?? "(unscoped)";
  const existing = fixMap.get(scope);
  if (existing) {
    existing.count++;
    existing.latestSubject = e.subject;
  } else {
    fixMap.set(scope, { count: 1, latestSubject: e.subject });
  }
}

/**
 * Adds churn commits to the digest's churn totals and the rest to its line
 * totals. Returns the non-churn ("notable") commits for bucketing.
 */
function foldChurn(digest: StandupDigest, entries: readonly CommitEntry[]): CommitEntry[] {
  const notable: CommitEntry[] = [];
  for (const e of entries) {
    if (isChurnCommit(e)) {
      digest.churn.commits++;
      digest.churn.insertions += e.insertions;
      digest.churn.deletions += e.deletions;
    } else {
      notable.push(e);
      digest.insertions += e.insertions;
      digest.deletions += e.deletions;
    }
  }
  return notable;
}

// Pure classification. Churn is split off first and excluded from the line
// totals; the rest goes to the first matching bucket: security, feature, fix
// group, or a per-type count. Exported for tests.
export function classifyCommits(entries: readonly CommitEntry[]): StandupDigest {
  const digest: StandupDigest = {
    total: entries.length,
    churn: { commits: 0, insertions: 0, deletions: 0 },
    security: [],
    features: [],
    fixGroups: [],
    otherGroups: [],
    insertions: 0,
    deletions: 0,
  };

  const notable = foldChurn(digest, entries);

  const fixMap = new Map<string, { count: number; latestSubject: string }>();
  const otherMap = new Map<string, number>();
  for (const e of notable) {
    if (isSecurityCommit(e)) {
      digest.security.push(e);
    } else if (e.type === "feat") {
      digest.features.push(e);
    } else if (e.type === "fix" || e.type === "harden") {
      addToFixGroup(fixMap, e);
    } else {
      const typeKey = e.type ?? "other";
      otherMap.set(typeKey, (otherMap.get(typeKey) ?? 0) + 1);
    }
  }

  digest.fixGroups = [...fixMap.entries()].map(([scope, { count, latestSubject }]) => ({
    scope,
    count,
    latestSubject,
  }));
  digest.otherGroups = [...otherMap.entries()].map(([type, count]) => ({
    type,
    count,
  }));
  return digest;
}

/**
 * Reads the last 24 hours of git history and classifies it. Also returns the
 * plain log text for the report's collapsible "Full commit log" block.
 */
export async function collectStandupDigest(
  root: string
): Promise<{ digest: StandupDigest; rawLog: string }> {
  const raw = await git(root, [
    "log",
    `--since=${WINDOW}`,
    "--pretty=format:%h%x09%s",
    "--shortstat",
  ]);

  // A second call with the human-readable format for the details block.
  const rawLog = await git(root, [
    "log",
    `--since=${WINDOW}`,
    "--pretty=format:%h %s",
    "--shortstat",
  ]);

  const entries = parseGitLog(raw);
  const digest = classifyCommits(entries);

  if (digest.total === 0) {
    const latestCommitIso = await git(root, ["log", "-1", "--pretty=%cI", "HEAD"]);
    digest.latestCommitIso = latestCommitIso || undefined;
  }

  return { digest, rawLog };
}

/** "±1,234 lines": total churn size without signs, easy to scan. */
function formatPlusMinus(ins: number, del: number): string {
  return `±${(ins + del).toLocaleString()} lines`;
}

/** Adds "s" (or the given plural) unless the count is exactly one. */
function plural(n: number, suffix = "s"): string {
  return n === 1 ? "" : suffix;
}

/** One-line summary: hand-written commits (with feature/fix detail) plus folded churn. */
function buildHeadline(digest: StandupDigest): string {
  const handWork = digest.total - digest.churn.commits;
  const parts: string[] = [];
  if (handWork > 0) {
    const details: string[] = [];
    if (digest.features.length > 0) {
      details.push(`${digest.features.length} feature${plural(digest.features.length)}`);
    }
    for (const fg of digest.fixGroups) {
      details.push(`${fg.count} ${fg.scope} fix${plural(fg.count, "es")}`);
    }
    const detailStr = details.length > 0 ? ` (${details.join(", ")})` : "";
    parts.push(`${handWork} commit${plural(handWork)} by hand${detailStr}`);
  }
  if (digest.churn.commits > 0) {
    const size = formatPlusMinus(digest.churn.insertions, digest.churn.deletions);
    parts.push(
      `${digest.churn.commits} generated-churn commit${plural(digest.churn.commits)} folded (${size})`
    );
  }
  return parts.join(" · ");
}

/** The Security, Features, Fixes and Generated churn sections, each only when non-empty. */
function buildSections(digest: StandupDigest): string[] {
  const lines: string[] = [];
  if (digest.security.length > 0) {
    lines.push("### Security", "");
    for (const e of digest.security) {
      lines.push(`- \`${e.sha}\` ${e.subject}`);
    }
    lines.push("");
  }
  if (digest.features.length > 0) {
    lines.push("### Features", "");
    for (const e of digest.features.slice(0, 10)) {
      lines.push(`- \`${e.sha}\` ${e.subject}`);
    }
    if (digest.features.length > 10) {
      lines.push(`- _…and ${digest.features.length - 10} more_`);
    }
    lines.push("");
  }
  if (digest.fixGroups.length > 0) {
    lines.push("### Fixes by area", "");
    for (const fg of digest.fixGroups) {
      lines.push(
        `- ${fg.scope} — ${fg.count} commit${plural(fg.count)}, latest: ${fg.latestSubject}`
      );
    }
    lines.push("");
  }
  if (digest.churn.commits > 0) {
    const size = formatPlusMinus(digest.churn.insertions, digest.churn.deletions);
    lines.push(
      "### Generated churn",
      "",
      `${digest.churn.commits} commit${plural(digest.churn.commits)} folded (${size})`,
      ""
    );
  }
  return lines;
}

// Renders the report. A quiet day gets a one-line headline; a security-relevant
// commit replaces the headline with an Attention line. Exported for tests.
export function buildStandupMarkdown(
  digest: StandupDigest,
  rawLog: string
): string {
  const lines: string[] = [
    "# Standup digest",
    "",
    `**Generated** ${new Date().toLocaleString()}`,
    "",
  ];

  if (digest.total === 0) {
    const quiet = describeQuiet(digest.latestCommitIso);
    lines.push(`**Headline:** No commits in the last day${quiet}.`);
    lines.push("");
    return lines.join("\n");
  }

  if (digest.security.length > 0) {
    lines.push(
      `**Attention:** Security-relevant commit landed: ${digest.security[0]!.subject}`
    );
  } else {
    lines.push(`**Headline:** ${buildHeadline(digest)}`);
  }
  lines.push("");
  lines.push(...buildSections(digest));

  lines.push("<details>");
  lines.push("<summary>Full commit log</summary>");
  lines.push("");
  lines.push(fenceBlock(rawLog));
  lines.push("");
  lines.push("</details>");
  lines.push("");

  return lines.join("\n");
}

/** Registers the standup-digest recipe command (optionally given a folder path). */
export function registerStandupDigestCommand(
  context: vscode.ExtensionContext
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "saropaWorkspace.recipe.standupDigest",
      (folderPath?: unknown) => runStandupDigest(folderPath)
    )
  );
}

// Collects the digest for the given (or first workspace) folder, writes the
// report file under the recipe report folder and opens it. Returns the path,
// or undefined when there is no folder or the write failed.
async function runStandupDigest(
  folderPath?: unknown
): Promise<string | undefined> {
  const root =
    typeof folderPath === "string" && folderPath.length > 0
      ? folderPath
      : vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!root) {
    vscode.window.showWarningMessage(l10n("standup.noFolder"));
    return undefined;
  }

  const { digest, rawLog } = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: l10n("standup.collecting") },
    () => collectStandupDigest(root)
  );

  const relative = expandRecipeTokens(reportRelativePath("standup"));
  const file = path.join(root, ...relative.split("/"));
  try {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, buildStandupMarkdown(digest, rawLog), "utf8");
  } catch (err) {
    vscode.window.showErrorMessage(
      l10n("standup.failed", { error: err instanceof Error ? err.message : String(err) })
    );
    return undefined;
  }
  await openReport(file);
  return file;
}
