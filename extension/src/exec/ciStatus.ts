import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs/promises";
import { promisify } from "util";
import { execFile as execFileCb } from "child_process";
import { expandRecipeTokens, reportRelativePath } from "./runner";
import { openReport } from "./reportOpen";
import { l10n } from "../i18n/l10n";

const execFile = promisify(execFileCb);

const GH_TIMEOUT_MS = 30_000;
const MAX_GH_BUFFER = 16 * 1024 * 1024;

// Runs fetched. Deliberately larger than the handful shown: finding where CI went
// red means walking back to the newest passing run, and a repo that has been broken
// for a while needs depth to answer that. Only RUN_SHOWN are tabulated.
const RUN_LIMIT = 100;

// Runs listed in the report's table. The rest are fetched for the bisect only.
const RUN_SHOWN = 10;

// Fields requested from `gh run list --json`. This is the CLI's stable machine
// interface; the default table output is presentation, subject to column changes,
// and a version of this file that parsed it read the branch as the workflow.
const RUN_FIELDS =
  "status,conclusion,workflowName,headBranch,displayTitle,headSha,createdAt";

// Annotations shown per failing check. A failing job can emit hundreds; the first few
// carry the cause, and the rest are consequences of it.
const MAX_ANNOTATIONS = 5;

// Failing check runs queried for annotations. Each is a sequential API round trip,
// so the count is bounded independently of how many annotations come back.
const MAX_CHECK_RUNS = 5;

// One CI run, as `gh run list --json` reports it. Field names mirror the CLI's so
// the mapping stays checkable against `gh run list --json` output by eye.
export interface CiRun {
  status: string;
  conclusion: string;
  displayTitle: string;
  workflowName: string;
  headBranch: string;
  headSha: string;
  createdAt: string;
}

// Where CI went from passing to failing: the oldest failing run in the unbroken
// streak of failures at the head of the list, plus the newest passing run before it.
// `noPassingRun` distinguishes "broken since commit X" from "nothing has ever
// passed in the fetched history" — materially different news, and the second is
// easy to misread as the first.
export interface CiBreak {
  firstFailure: CiRun;
  lastSuccess?: CiRun;
  failingSince: number;
  noPassingRun: boolean;
}

// A failure annotation GitHub attached to a check run — the line that says WHY the
// build broke, which the run list alone never carries.
export interface CiAnnotation {
  level: string;
  path: string;
  line: number;
  message: string;
}

export interface CiStatus {
  runs: CiRun[];
  failing: CiRun[];
  annotations: CiAnnotation[];
  // Present only while the newest run is a failure — the question "when did this
  // break" is meaningless for a green build.
  broke?: CiBreak;
  // True when gh is absent or unauthenticated, so the report explains itself rather
  // than rendering as an empty "no runs" result that reads like a green build.
  unavailable: boolean;
}

async function gh(root: string, args: string[]): Promise<string | undefined> {
  try {
    const { stdout } = await execFile("gh", args, {
      cwd: root,
      maxBuffer: MAX_GH_BUFFER,
      timeout: GH_TIMEOUT_MS,
    });
    return stdout.trim();
  } catch {
    // Undefined, not "": the caller must distinguish "gh could not answer" from
    // "gh answered, and the answer was nothing". Reporting a missing CLI as a green
    // build would be the worst possible failure mode for this check.
    return undefined;
  }
}

export async function collectCiStatus(root: string): Promise<CiStatus> {
  const list = await gh(root, [
    "run",
    "list",
    "--limit",
    String(RUN_LIMIT),
    "--json",
    RUN_FIELDS,
  ]);
  if (list === undefined) {
    return { runs: [], failing: [], annotations: [], unavailable: true };
  }
  const runs = parseRunList(list);
  const failing = runs.filter((r) => isFailure(r));
  const annotations = failing.length > 0 ? await collectAnnotations(root) : [];
  return { runs, failing, annotations, unavailable: false, broke: findBreak(runs) };
}

// Walk the head of the list (newest first) while runs are failing, then report the
// oldest failure in that streak and the run that passed before it. Returns undefined
// when the newest completed run passed — nothing is broken, so there is no break to
// locate. Runs still in progress are skipped rather than ending the streak: a build
// queued on top of a red branch does not mean CI recovered. Exported for tests.
export function findBreak(runs: readonly CiRun[]): CiBreak | undefined {
  const completed = runs.filter((r) => r.status === "completed");
  if (completed.length === 0 || !isFailure(completed[0])) {
    return undefined;
  }
  let i = 0;
  while (i < completed.length && isFailure(completed[i])) {
    i++;
  }
  return {
    // The streak runs newest-first, so its LAST element is the oldest failure —
    // the run where the branch went red.
    firstFailure: completed[i - 1],
    lastSuccess: completed[i],
    failingSince: i,
    // No passing run anywhere in the fetched window. Reported as its own state
    // rather than as a very long streak, because "nothing has ever passed" points
    // at the pipeline itself rather than at a commit that broke it.
    noPassingRun: i === completed.length,
  };
}

// Annotations for the checks on the current commit. Two calls: the check-run ids,
// then each one's annotations. Only failing checks are asked about — a green check's
// annotations are deprecation notices nobody needs at 8am.
async function collectAnnotations(root: string): Promise<CiAnnotation[]> {
  const ids = await gh(root, [
    "api",
    "repos/{owner}/{repo}/commits/HEAD/check-runs",
    "--jq",
    ".check_runs[] | select(.conclusion == \"failure\") | .id",
  ]);
  if (!ids) {
    return [];
  }
  const out: CiAnnotation[] = [];
  // Cap the IDS, not just the annotations: each id is a sequential network round
  // trip, and many failing checks that each return no annotations would otherwise
  // walk the whole list before the morning report could be written.
  const idList = ids.split("\n").filter((i) => i.trim().length > 0).slice(0, MAX_CHECK_RUNS);
  for (const id of idList) {
    const raw = await gh(root, [
      "api",
      `repos/{owner}/{repo}/check-runs/${id.trim()}/annotations`,
      "--jq",
      ".[] | [.annotation_level, .path, (.start_line|tostring), .message] | @tsv",
    ]);
    if (raw) {
      out.push(...parseAnnotations(raw));
    }
    if (out.length >= MAX_ANNOTATIONS) {
      break;
    }
  }
  return out.slice(0, MAX_ANNOTATIONS);
}

// Parse `gh run list --json`. Every field is read defensively: this is JSON from an
// external tool, so a missing or non-string field must yield an empty string rather
// than an undefined that reaches the report. A run still in progress has an EMPTY
// conclusion, which is why status and conclusion stay separate rather than collapsing
// into one "result" — merged, a queued run reads as one that finished with no result.
// Exported for tests.
export function parseRunList(text: string): CiRun[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Malformed JSON yields no runs, which ciHeadline reports as "no runs recorded"
    // rather than as a green build.
    return [];
  }
  if (!Array.isArray(parsed)) {
    return [];
  }
  const runs: CiRun[] = [];
  for (const row of parsed) {
    if (typeof row !== "object" || row === null) {
      continue;
    }
    const r = row as Record<string, unknown>;
    runs.push({
      status: str(r.status),
      conclusion: str(r.conclusion),
      displayTitle: str(r.displayTitle),
      workflowName: str(r.workflowName),
      headBranch: str(r.headBranch),
      headSha: str(r.headSha),
      createdAt: str(r.createdAt),
    });
  }
  return runs;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function parseAnnotations(text: string): CiAnnotation[] {
  const out: CiAnnotation[] = [];
  for (const line of text.split("\n")) {
    const cols = line.split("\t");
    if (cols.length < 4) {
      continue;
    }
    out.push({
      level: cols[0].trim(),
      path: cols[1].trim(),
      line: Number(cols[2]) || 0,
      // The message may itself contain tabs, so everything after the third column
      // is rejoined rather than truncated at the next separator.
      message: cols.slice(3).join(" ").trim(),
    });
  }
  return out;
}

// `cancell?ed` matches either spelling: the GitHub API's conclusion value carries the
// double-l form, which this repo's American-English rule forbids writing out.
function isFailure(run: CiRun): boolean {
  return run.status === "completed" && /^(failure|timed_out|cancell?ed)$/.test(run.conclusion);
}

// The verdict line. Attention when anything is failing — a red default branch is the
// first question of the morning, so it never renders as a mere headline.
export function ciHeadline(status: CiStatus): { text: string; attention: boolean } {
  if (status.unavailable) {
    return { text: "Build status unavailable — the gh CLI did not answer.", attention: true };
  }
  if (status.runs.length === 0) {
    return { text: "No CI runs recorded.", attention: false };
  }
  if (status.failing.length > 0) {
    const workflow = status.failing[0]?.workflowName;
    const suffix = workflow ? ` (${workflow})` : "";
    const broke = status.broke;
    if (broke?.noPassingRun) {
      // The strongest statement available, and a different problem from a commit
      // that broke a working pipeline: nothing here has ever gone green.
      return {
        text: `no passing CI run in the last ${status.runs.length}${suffix}`,
        attention: true,
      };
    }
    if (broke) {
      const since = broke.firstFailure.headSha.slice(0, 9);
      const runs = `${broke.failingSince} run${broke.failingSince === 1 ? "" : "s"}`;
      return { text: `CI red since \`${since}\` (${runs})${suffix}`, attention: true };
    }
    const scope =
      status.failing.length === status.runs.length
        ? `all of the last ${status.runs.length} CI runs failing`
        : `${status.failing.length} of the last ${status.runs.length} CI runs failing`;
    return { text: `${scope}${suffix}`, attention: true };
  }
  const running = status.runs.filter((r) => r.status !== "completed").length;
  return {
    text: running > 0 ? `CI green, ${running} still running` : "CI green",
    attention: false,
  };
}

export function buildCiMarkdown(status: CiStatus): string {
  const headline = ciHeadline(status);
  const lines: string[] = [
    "# Build status",
    "",
    `**Generated** ${new Date().toLocaleString()}`,
    "",
    `**${headline.attention ? "Attention" : "Headline"}:** ${headline.text}`,
    "",
  ];
  if (status.unavailable) {
    lines.push(
      "_`gh` is not installed, not authenticated, or this folder has no GitHub remote. Run `gh auth status` to check._",
      ""
    );
    return lines.join("\n");
  }

  // Where it broke, before why: the commit that turned the branch red is the single
  // most useful pointer a red-CI report can give, and it costs no extra call — the
  // run list was already fetched deep enough to find it.
  if (status.broke) {
    lines.push("## When it broke", "");
    if (status.broke.noPassingRun) {
      lines.push(
        `No run in the last ${status.runs.length} passed. This reads as a pipeline that has not worked in the fetched history, rather than a change that broke a working one.`,
        ""
      );
    } else {
      const f = status.broke.firstFailure;
      lines.push(
        `Red for **${status.broke.failingSince} run${status.broke.failingSince === 1 ? "" : "s"}**, starting at \`${f.headSha.slice(0, 9)}\` — ${f.displayTitle} (${formatWhen(f.createdAt)}).`,
        ""
      );
      const s = status.broke.lastSuccess;
      if (s) {
        lines.push(
          `Last passing run: \`${s.headSha.slice(0, 9)}\` — ${s.displayTitle} (${formatWhen(s.createdAt)}).`,
          ""
        );
      }
    }
  }

  // The annotations are the point of this report: a run list says the build is red,
  // an annotation says which file and which line made it red.
  if (status.annotations.length > 0) {
    lines.push("## Why it failed", "");
    for (const a of status.annotations) {
      const where = a.path ? `\`${a.path}${a.line > 0 ? `:${a.line}` : ""}\` — ` : "";
      lines.push(`- **${a.level}** ${where}${a.message.split("\n")[0]}`);
    }
    lines.push("");
  }

  if (status.runs.length > 0) {
    // Only the newest few are tabulated. The rest were fetched to locate the break
    // above, and listing 100 rows would rebuild the wall of output this report
    // exists to replace.
    const shown = status.runs.slice(0, RUN_SHOWN);
    lines.push("## Recent runs", "", "| Result | Workflow | Branch | Commit |", "|---|---|---|---|");
    for (const r of shown) {
      const result = r.status === "completed" ? r.conclusion : r.status;
      lines.push(`| ${result} | ${r.workflowName} | ${r.headBranch} | ${escapeCell(r.displayTitle)} |`);
    }
    lines.push("");
    if (status.runs.length > shown.length) {
      lines.push(`_${status.runs.length - shown.length} older runs were read to locate the break, and are not listed._`, "");
    }
  }
  return lines.join("\n");
}

// A commit subject containing a pipe would split the row into extra columns and
// break the table for every row after it.
function escapeCell(text: string): string {
  return text.replace(/\|/g, "\\|");
}

// An ISO timestamp read as a date, degrading to the raw value when it is not
// parseable — an unrecognized timestamp must not render as "Invalid Date".
function formatWhen(iso: string): string {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? iso : at.toLocaleString();
}

export function registerCiStatusCommand(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("saropaWorkspace.recipe.ciStatus", (folderPath?: unknown) =>
      runCiStatus(folderPath)
    )
  );
}

async function runCiStatus(folderPath?: unknown): Promise<string | undefined> {
  const root =
    typeof folderPath === "string" && folderPath.length > 0
      ? folderPath
      : vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!root) {
    vscode.window.showWarningMessage(l10n("ci.noFolder"));
    return undefined;
  }
  const status = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: l10n("ci.collecting") },
    () => collectCiStatus(root)
  );

  const relative = expandRecipeTokens(reportRelativePath("ci"));
  const file = path.join(root, ...relative.split("/"));
  try {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, buildCiMarkdown(status), "utf8");
  } catch (err) {
    vscode.window.showErrorMessage(
      l10n("ci.failed", { error: err instanceof Error ? err.message : String(err) })
    );
    return undefined;
  }
  await openReport(file);
  return file;
}
