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

const GIT_TIMEOUT_MS = 30_000;
const MAX_GIT_BUFFER = 64 * 1024 * 1024;

const WINDOW = "24 hours ago";

const CHURN_LINE_THRESHOLD = 10_000;

const CHURN_SUBJECT_RE = /machine-translation|auto-generated|regenerated?/i;
const SECURITY_RE = /security|auth|token|credential|vulnerab/i;
const CONVENTIONAL_RE = /^(\w+)(?:\(([^)]*)\))?(!)?:\s*(.*)$/;

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

export interface FixGroup {
  scope: string;
  count: number;
  latestSubject: string;
}

export interface OtherGroup {
  type: string;
  count: number;
}

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

// Exported for tests.
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

// Parse tab-separated git log output into commit entries. Exported for tests.
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

// Pure classification. Exported for tests.
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

  const notable: CommitEntry[] = [];

  for (const e of entries) {
    const isChurnByLines =
      e.type === "chore" && e.insertions + e.deletions > CHURN_LINE_THRESHOLD;
    const isChurnBySubject = CHURN_SUBJECT_RE.test(e.subject);

    if (isChurnByLines || isChurnBySubject) {
      digest.churn.commits++;
      digest.churn.insertions += e.insertions;
      digest.churn.deletions += e.deletions;
    } else {
      notable.push(e);
      digest.insertions += e.insertions;
      digest.deletions += e.deletions;
    }
  }

  const fixMap = new Map<string, { count: number; latestSubject: string }>();
  const otherMap = new Map<string, number>();

  for (const e of notable) {
    const isSecurity =
      SECURITY_RE.test(e.scope ?? "") ||
      SECURITY_RE.test(e.description) ||
      SECURITY_RE.test(e.type ?? "") ||
      e.breaking;

    if (isSecurity) {
      digest.security.push(e);
      continue;
    }

    if (e.type === "feat") {
      digest.features.push(e);
      continue;
    }

    if (e.type === "fix" || e.type === "harden") {
      const scope = e.scope ?? "(unscoped)";
      const existing = fixMap.get(scope);
      if (existing) {
        existing.count++;
        existing.latestSubject = e.subject;
      } else {
        fixMap.set(scope, { count: 1, latestSubject: e.subject });
      }
      continue;
    }

    const typeKey = e.type ?? "other";
    otherMap.set(typeKey, (otherMap.get(typeKey) ?? 0) + 1);
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

function formatPlusMinus(ins: number, del: number): string {
  return `±${(ins + del).toLocaleString()} lines`;
}

// Exported for tests.
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

  const handWork = digest.total - digest.churn.commits;
  const headlineParts: string[] = [];
  if (handWork > 0) {
    const details: string[] = [];
    if (digest.features.length > 0) {
      details.push(
        `${digest.features.length} feature${digest.features.length === 1 ? "" : "s"}`
      );
    }
    for (const fg of digest.fixGroups) {
      details.push(
        `${fg.count} ${fg.scope} fix${fg.count === 1 ? "" : "es"}`
      );
    }
    const detailStr = details.length > 0 ? ` (${details.join(", ")})` : "";
    headlineParts.push(
      `${handWork} commit${handWork === 1 ? "" : "s"} by hand${detailStr}`
    );
  }
  if (digest.churn.commits > 0) {
    headlineParts.push(
      `${digest.churn.commits} generated-churn commit${digest.churn.commits === 1 ? "" : "s"} folded (${formatPlusMinus(digest.churn.insertions, digest.churn.deletions)})`
    );
  }

  if (digest.security.length > 0) {
    lines.push(
      `**Attention:** Security-relevant commit landed: ${digest.security[0]!.subject}`
    );
  } else {
    lines.push(`**Headline:** ${headlineParts.join(" · ")}`);
  }
  lines.push("");

  if (digest.security.length > 0) {
    lines.push("### Security");
    lines.push("");
    for (const e of digest.security) {
      lines.push(`- \`${e.sha}\` ${e.subject}`);
    }
    lines.push("");
  }

  if (digest.features.length > 0) {
    lines.push("### Features");
    lines.push("");
    for (const e of digest.features.slice(0, 10)) {
      lines.push(`- \`${e.sha}\` ${e.subject}`);
    }
    if (digest.features.length > 10) {
      lines.push(`- _…and ${digest.features.length - 10} more_`);
    }
    lines.push("");
  }

  if (digest.fixGroups.length > 0) {
    lines.push("### Fixes by area");
    lines.push("");
    for (const fg of digest.fixGroups) {
      lines.push(
        `- ${fg.scope} — ${fg.count} commit${fg.count === 1 ? "" : "s"}, latest: ${fg.latestSubject}`
      );
    }
    lines.push("");
  }

  if (digest.churn.commits > 0) {
    lines.push("### Generated churn");
    lines.push("");
    lines.push(
      `${digest.churn.commits} commit${digest.churn.commits === 1 ? "" : "s"} folded (${formatPlusMinus(digest.churn.insertions, digest.churn.deletions)})`
    );
    lines.push("");
  }

  lines.push("<details>");
  lines.push("<summary>Full commit log</summary>");
  lines.push("");
  lines.push(fenceBlock(rawLog));
  lines.push("");
  lines.push("</details>");
  lines.push("");

  return lines.join("\n");
}

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
