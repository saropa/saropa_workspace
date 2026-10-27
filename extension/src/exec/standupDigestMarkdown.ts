import { describeQuiet } from "./overnightDelta";
import { fenceBlock } from "./actionRunner";
import type { StandupDigest } from "./standupDigest";

// Markdown rendering of a standup digest. Split out of standupDigest.ts, which
// re-exports buildStandupMarkdown so existing imports keep working.

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
