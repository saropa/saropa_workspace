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

// Recent runs to judge "is it broken, or did it just break". Ten covers a normal
// day's pushes without turning the report into a log.
const RUN_LIMIT = 10;

// Annotations shown per failing check. A failing job can emit hundreds; the first few
// carry the cause, and the rest are consequences of it.
const MAX_ANNOTATIONS = 5;

// One CI run, as `gh run list` reports it.
export interface CiRun {
  status: string;
  conclusion: string;
  title: string;
  workflow: string;
  branch: string;
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
  const list = await gh(root, ["run", "list", "--limit", String(RUN_LIMIT)]);
  if (list === undefined) {
    return { runs: [], failing: [], annotations: [], unavailable: true };
  }
  const runs = parseRunList(list);
  const failing = runs.filter((r) => isFailure(r));
  const annotations = failing.length > 0 ? await collectAnnotations(root) : [];
  return { runs, failing, annotations, unavailable: false };
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
  for (const id of ids.split("\n").filter((i) => i.trim().length > 0)) {
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

// Parse `gh run list`'s tab-separated rows. Column order (verified against gh 2.76.2):
// status, conclusion, title, workflow, branch, event, id, duration, timestamp.
// A row that is still running has an EMPTY conclusion, which is why status and
// conclusion are read separately rather than collapsed into one "result" field.
// Exported for tests.
export function parseRunList(text: string): CiRun[] {
  const runs: CiRun[] = [];
  for (const line of text.split("\n")) {
    const cols = line.split("\t");
    if (cols.length < 5) {
      continue;
    }
    runs.push({
      status: cols[0].trim(),
      conclusion: cols[1].trim(),
      title: cols[2].trim(),
      workflow: cols[3].trim(),
      branch: cols[4].trim(),
    });
  }
  return runs;
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
    const workflow = status.failing[0]?.workflow;
    const scope =
      status.failing.length === status.runs.length
        ? `all of the last ${status.runs.length} CI runs failing`
        : `${status.failing.length} of the last ${status.runs.length} CI runs failing`;
    return { text: `${scope}${workflow ? ` (${workflow})` : ""}`, attention: true };
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
    lines.push("## Recent runs", "", "| Result | Workflow | Branch | Commit |", "|---|---|---|---|");
    for (const r of status.runs) {
      const result = r.status === "completed" ? r.conclusion : r.status;
      lines.push(`| ${result} | ${r.workflow} | ${r.branch} | ${r.title} |`);
    }
    lines.push("");
  }
  return lines.join("\n");
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
