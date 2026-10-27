// Report text helpers for shell actions: fenced output blocks, the command report
// layout and the one-line headline summarized from command output. Pure. Split out
// of actionRunner.ts, which re-exports them.

import * as path from "path";

// Wrap raw command output in a Markdown fenced code block so a Markdown preview
// renders it as monospace preformatted text instead of mangling it as prose — a
// `git log --stat` / `git status` dump read as Markdown is the "unreadable slop"
// the report bug called out. The fence length is one backtick longer than the
// longest backtick run in the body, so output that itself contains a ``` fence
// (rare, but e.g. a grep over Markdown) can never break out of the block.
// Exported: routineRunner reuses this to fence a non-Markdown member report when
// merging it into the routine summary (single source for the widened-fence rule).
export function fenceBlock(body: string): string {
  const runs = body.match(/`+/g);
  const longest = runs ? Math.max(...runs.map((r) => r.length)) : 0;
  const fence = "`".repeat(Math.max(3, longest + 1));
  return `${fence}text\n${body.replace(/\n+$/, "")}\n${fence}`;
}

// Build a captured-command report as clean Markdown: an H1 heading, a metadata
// block (generation time + the exact command, code-formatted so it is copy-paste
// safe), and the command's combined output fenced as a code block. An empty result
// is stated plainly rather than left as a blank fence, so "no output" reads as a
// deliberate outcome. Single source for every scheduled shell ritual's report shape.
// Exported for the unit test (report-bug items 1 and 2: no more unfenced slop).
export function buildCommandReport(name: string, commandLine: string, body: string): string {
  const trimmed = body.trim();
  const output = trimmed.length > 0 ? fenceBlock(body) : "_No output._";
  // Only the end is trimmed for the headline: a status line such as " M a.ts" starts with
  // a space that is part of its two-column code.
  const headline = summarizeReportBody(body.trimEnd());
  // Two conventions, not one: **Attention:** marks a finding that needs the reader to
  // DO something, **Headline:** one that merely informs. The routine summary sorts on
  // this to decide its verdict, so the distinction has to be made by whoever
  // understands the output — the summarizer — not guessed at later from wording.
  const label = headline?.attention ? "Attention" : "Headline";
  return (
    `# ${name}\n\n` +
    `**Generated** ${new Date().toLocaleString()}\n\n` +
    (headline ? `**${label}:** ${headline.text}\n\n` : "") +
    `**Command** \`${commandLine}\`\n\n` +
    `${output}\n`
  );
}

// A report's one-line finding, and whether it is something to act on.
export interface ReportHeadline {
  text: string;
  attention: boolean;
}

// One line stating what the captured output amounts to, or undefined when the output
// has no shape worth summarizing (a headline of "412 lines" is noise, not a headline).
// Keyed off the OUTPUT, never the command line: the same digest is reachable through a
// hand-written shortcut, and a command-string match would silently stop working the
// first time a flag order changed.
export function summarizeReportBody(body: string): ReportHeadline | undefined {
  if (body.length === 0) {
    return { text: "Nothing to report.", attention: false };
  }
  const lines = body.split("\n");

  // `gh run list` — tab-separated, leading with the run's status and conclusion.
  // Checked before the commit shape because a run row also carries a commit sha.
  const runs = lines.filter((l) => /^(completed|in_progress|queued|requested)\t/.test(l));
  if (runs.length > 0) {
    // `cancell?ed` matches either spelling: the GitHub API's conclusion value carries
    // the double-l form, which this repo's American-English rule forbids writing out.
    const failed = runs.filter((l) => /^completed\t(failure|timed_out|cancell?ed)\t/.test(l));
    if (failed.length > 0) {
      // Name the workflow of the newest failure: "2 runs failing" sends the reader
      // hunting, "2 runs failing (Flutter CI)" tells them where to look. Column 3 is
      // the workflow; gh's column order is
      // status, conclusion, title, workflow, branch, event, id, duration, timestamp
      // (verified against gh 2.76.2 — an earlier guess of column 4 named the BRANCH).
      const workflow = failed[0]?.split("\t")[3]?.trim();
      return {
        text: `${failed.length} of the last ${runs.length} CI runs failing${workflow ? ` (${workflow})` : ""}`,
        attention: true,
      };
    }
    const running = runs.filter((l) => !l.startsWith("completed\t")).length;
    return {
      text: running > 0 ? `CI green, ${running} still running` : "CI green",
      attention: false,
    };
  }

  // `<sha> <subject>` — the shape of --oneline / --pretty=format:"%h %s".
  const commits = lines.filter((l) => /^[0-9a-f]{7,40} \S/.test(l)).length;
  if (commits > 0) {
    const totals = sumShortstat(lines);
    const parts = [`${commits} commit${commits === 1 ? "" : "s"}`];
    if (totals) {
      parts.push(
        `${totals.files} file${totals.files === 1 ? "" : "s"} changed`,
        `+${totals.insertions.toLocaleString()} / -${totals.deletions.toLocaleString()}`
      );
    }
    // History is a record, not a task: it informs, it does not ask for anything.
    return { text: parts.join(" · "), attention: false };
  }

  // `XY path` — git status --porcelain, the shape the uncommitted-work guard captures.
  const dirty = lines.filter((l) => /^[ MADRCU?!]{2} \S/.test(l)).length;
  if (dirty > 0) {
    // Work left outside a commit is the one finding here that can be lost, so it
    // asks for action rather than merely reporting a count.
    return {
      text: `${dirty} uncommitted file${dirty === 1 ? "" : "s"}`,
      attention: true,
    };
  }
  return undefined;
}

// Total the `N files changed, N insertions(+), N deletions(-)` lines --shortstat emits
// after each commit. Any of the three clauses may be absent (a commit that only added
// files has no deletions clause), so each is matched independently.
function sumShortstat(lines: readonly string[]):
  | { files: number; insertions: number; deletions: number }
  | undefined {
  let files = 0;
  let insertions = 0;
  let deletions = 0;
  let seen = false;
  for (const line of lines) {
    if (!/^\s*\d+ files? changed/.test(line)) {
      continue;
    }
    seen = true;
    files += Number(/(\d+) files? changed/.exec(line)?.[1] ?? 0);
    insertions += Number(/(\d+) insertions?\(\+\)/.exec(line)?.[1] ?? 0);
    deletions += Number(/(\d+) deletions?\(-\)/.exec(line)?.[1] ?? 0);
  }
  return seen ? { files, insertions, deletions } : undefined;
}
