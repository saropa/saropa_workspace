import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs/promises";
import { promisify } from "util";
import { execFile as execFileCb } from "child_process";
import { expandRecipeTokens, reportRelativePath } from "./runner";
import { openReport } from "./reportOpen";
import { l10n } from "../i18n/l10n";

const execFile = promisify(execFileCb);

// Same guards as the project-stats sweep: a git subcommand with no other input
// source falls back to reading stdin and never returns, and a large repo can emit
// more than the default pipe buffer.
const GIT_TIMEOUT_MS = 30_000;
const MAX_GIT_BUFFER = 64 * 1024 * 1024;

// How far back "since yesterday" reaches. A day's window rather than "since the last
// run": the baseline must not move when the routine is missed or run twice.
const WINDOW = "24 hours ago";

// Debt markers counted at each end of the window. Kept as one alternation so the two
// counts are computed by identical commands and stay comparable.
const DEBT_PATTERN = "TODO|FIXME|HACK|XXX";

// What changed in the repository across the window. Every field is derived by
// comparing two revisions — nothing here is a stored snapshot from a previous run.
// That matters beyond convenience: a stored baseline is only as good as the last time
// the job happened to run, whereas a revision is exact, survives a fresh clone or a
// new machine, and cannot drift (developer question 2026-07-20).
export interface OvernightDelta {
  // The revision that was HEAD at the start of the window, and undefined when the
  // repository has no commit that old (a young repo — not an error).
  baseline?: string;
  filesChanged: number;
  insertions: number;
  deletions: number;
  commits: number;
  // Commits in the window authored by someone other than the configured user. The
  // number that actually answers "what moved while I was away".
  commitsByOthers: number;
  debtBefore: number;
  debtAfter: number;
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
    // A failed sub-command yields an empty result rather than aborting the report:
    // a repo with no commits in the window is the common case, not an error.
    return "";
  }
}

export async function collectOvernightDelta(root: string): Promise<OvernightDelta> {
  const delta: OvernightDelta = {
    filesChanged: 0,
    insertions: 0,
    deletions: 0,
    commits: 0,
    commitsByOthers: 0,
    debtBefore: 0,
    debtAfter: 0,
  };

  // rev-list, not `HEAD@{1 day ago}`: the reflog form resolves against LOCAL history,
  // so it is empty on a fresh clone and wrong on a machine that was switched off.
  // rev-list reads commit dates, which every clone has.
  const baseline = await git(root, ["rev-list", "-1", `--before=${WINDOW}`, "HEAD"]);
  if (!baseline) {
    return delta;
  }
  delta.baseline = baseline;

  Object.assign(delta, parseShortstat(await git(root, ["diff", "--shortstat", baseline, "HEAD"])));

  const mine = (await git(root, ["config", "user.email"])).toLowerCase();
  // %ae is the author email; one line per commit in the window.
  const authors = await git(root, ["log", `${baseline}..HEAD`, "--pretty=%ae"]);
  const authorLines = authors ? authors.split("\n").filter((l) => l.trim().length > 0) : [];
  delta.commits = authorLines.length;
  delta.commitsByOthers = authorLines.filter((a) => a.trim().toLowerCase() !== mine).length;

  // Counted with `git grep` at each revision rather than by scanning the diff: the
  // diff between two days of a large repo can exceed the pipe buffer entirely (a
  // single translation sweep here moved 460,000 lines), while two greps stay bounded.
  delta.debtBefore = await countDebt(root, baseline);
  delta.debtAfter = await countDebt(root, "HEAD");
  return delta;
}

// Total debt-marker hits at one revision. `git grep -c` prints `rev:path:count` per
// matching file; -I skips binaries so a matching byte sequence in an image cannot
// inflate the count.
async function countDebt(root: string, rev: string): Promise<number> {
  const out = await git(root, ["grep", "-I", "-c", "-E", DEBT_PATTERN, rev]);
  if (!out) {
    return 0;
  }
  let total = 0;
  for (const line of out.split("\n")) {
    // Take the LAST colon-separated field: a path may itself contain colons.
    const count = Number(line.slice(line.lastIndexOf(":") + 1));
    if (Number.isFinite(count)) {
      total += count;
    }
  }
  return total;
}

// Parse `git diff --shortstat`: " 117 files changed, 462756 insertions(+), 411718
// deletions(-)". Any clause may be absent — a commit that only adds files has no
// deletions clause — so each is matched independently. Exported for tests.
export function parseShortstat(line: string): {
  filesChanged: number;
  insertions: number;
  deletions: number;
} {
  return {
    filesChanged: Number(/(\d+) files? changed/.exec(line)?.[1] ?? 0),
    insertions: Number(/(\d+) insertions?\(\+\)/.exec(line)?.[1] ?? 0),
    deletions: Number(/(\d+) deletions?\(-\)/.exec(line)?.[1] ?? 0),
  };
}

// The window's movement in one line. Exported for tests and reused as the report's
// headline. States the debt change only when it actually moved — "+0 TODOs" is noise.
export function deltaHeadline(delta: OvernightDelta): string {
  if (!delta.baseline) {
    return "No history yet for the last day.";
  }
  if (delta.commits === 0) {
    return "Nothing changed in the last day.";
  }
  const parts = [
    `${delta.commits} commit${delta.commits === 1 ? "" : "s"}`,
    `${delta.filesChanged} file${delta.filesChanged === 1 ? "" : "s"} changed`,
    `+${delta.insertions.toLocaleString()} / -${delta.deletions.toLocaleString()}`,
  ];
  if (delta.commitsByOthers > 0) {
    parts.push(`${delta.commitsByOthers} by others`);
  }
  const debt = delta.debtAfter - delta.debtBefore;
  if (debt !== 0) {
    parts.push(`${debt > 0 ? "+" : ""}${debt.toLocaleString()} TODO/FIXME`);
  }
  return parts.join(" · ");
}

export function buildDeltaMarkdown(delta: OvernightDelta): string {
  const lines: string[] = [
    "# Since yesterday",
    "",
    `**Generated** ${new Date().toLocaleString()}`,
    "",
    // Informational by convention: history is a record of what happened, not a task.
    // Nothing here can be lost or is broken, so it never claims the reader's attention
    // ahead of a red build or uncommitted work (see STYLEGUIDE 4.8a).
    `**Headline:** ${deltaHeadline(delta)}`,
    "",
  ];
  if (!delta.baseline) {
    lines.push("_This repository has no commit older than the last day to compare against._", "");
    return lines.join("\n");
  }
  lines.push(
    `Compared against \`${delta.baseline.slice(0, 9)}\`, the commit that was current a day ago.`,
    "",
    "| Measure | Change |",
    "|---------|-------:|",
    `| Commits | ${delta.commits.toLocaleString()} |`,
    `| Commits by others | ${delta.commitsByOthers.toLocaleString()} |`,
    `| Files changed | ${delta.filesChanged.toLocaleString()} |`,
    `| Lines added | ${delta.insertions.toLocaleString()} |`,
    `| Lines removed | ${delta.deletions.toLocaleString()} |`,
    `| TODO / FIXME markers | ${formatSigned(delta.debtAfter - delta.debtBefore)} (now ${delta.debtAfter.toLocaleString()}) |`,
    ""
  );
  return lines.join("\n");
}

function formatSigned(n: number): string {
  return n > 0 ? `+${n.toLocaleString()}` : n.toLocaleString();
}

// Register the overnight-delta command. Mirrors the project-stats registration: the
// folder arrives as the command arg (a scheduled recipe stores its folder path), and
// the written report path is returned so a routine summary can link it.
export function registerOvernightDeltaCommand(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("saropaWorkspace.recipe.overnightDelta", (folderPath?: unknown) =>
      runOvernightDelta(folderPath)
    )
  );
}

async function runOvernightDelta(folderPath?: unknown): Promise<string | undefined> {
  const root =
    typeof folderPath === "string" && folderPath.length > 0
      ? folderPath
      : vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!root) {
    vscode.window.showWarningMessage(l10n("delta.noFolder"));
    return undefined;
  }
  const delta = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: l10n("delta.collecting") },
    () => collectOvernightDelta(root)
  );

  const relative = expandRecipeTokens(reportRelativePath("since_yesterday"));
  const file = path.join(root, ...relative.split("/"));
  try {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, buildDeltaMarkdown(delta), "utf8");
  } catch (err) {
    vscode.window.showErrorMessage(
      l10n("delta.failed", { error: err instanceof Error ? err.message : String(err) })
    );
    return undefined;
  }
  // Silent under a routine: the routine's summary is the single window it opens.
  await openReport(file);
  return file;
}
