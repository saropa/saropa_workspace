import type { CiStatus } from "./ciStatus";

// Markdown rendering of a CI status. Split out of ciStatus.ts, which re-exports
// ciHeadline and buildCiMarkdown so existing imports keep working.

// Runs listed in the report's table. The rest are fetched for the bisect only.
const RUN_SHOWN = 10;

/** Returns a one-line verdict string and attention flag for the given CI status. Attention is raised when anything is failing. */
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

/** The "When it broke" section: how long the branch has been red and the commit that did it. */
function brokeLines(status: CiStatus): string[] {
  const lines: string[] = [];
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
  return lines;
}

/** The "Why it failed" section: one bullet per failure annotation. */
function annotationLines(status: CiStatus): string[] {
  const lines: string[] = [];
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
  return lines;
}

/** The "Recent runs" table of the newest few runs, with a note when older ones were read. */
function recentRunLines(status: CiStatus): string[] {
  const lines: string[] = [];
  if (status.runs.length > 0) {
    // Only the newest few are tabulated. The rest were fetched to locate the break
    // above, and listing 100 rows would rebuild the wall of output this report
    // exists to replace.
    const shown = status.runs.slice(0, RUN_SHOWN);
    lines.push("## Recent runs", "", "| Result | Workflow | Branch | Commit |", "|---|---|---|---|");
    for (const r of shown) {
      const result = r.status === "completed" ? r.conclusion : r.status;
      lines.push(
        `| ${result} | ${escapeCell(r.workflowName)} | ${escapeCell(r.headBranch)} | ${escapeCell(r.displayTitle)} |`
      );
    }
    lines.push("");
    if (status.runs.length > shown.length) {
      lines.push(`_${status.runs.length - shown.length} older runs were read to locate the break, and are not listed._`, "");
    }
  }
  return lines;
}

/** Renders a full Markdown CI status report from a {@link CiStatus} object. */
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

  lines.push(...brokeLines(status));
  lines.push(...annotationLines(status));
  lines.push(...recentRunLines(status));
  return lines.join("\n");
}

// A commit subject containing a pipe would split the row into extra columns and
// break the table for every row after it; a literal backslash must be escaped
// FIRST so it can't recombine with the pipe-escaping backslash added below and
// unescape it, and an embedded newline must be flattened so it can't start a
// new (unescaped) table row of its own.
function escapeCell(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

// An ISO timestamp read as a date, degrading to the raw value when it is not
// parseable — an unrecognized timestamp must not render as "Invalid Date".
function formatWhen(iso: string): string {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? iso : at.toLocaleString();
}
