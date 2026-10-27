// Routine brief: the structured projection of a routine run (headlines, verdict,
// merged sections) that the summary report and the brief panel both render.
// Split out of routineRunner.
import * as path from "path";
import { l10n } from "../i18n/l10n";
import { escapeHtml } from "../utils/escapeHtml";
import { fenceBlock } from "./actionRunner";
import { MemberOutcome, sanitizeDetail, defaultNote, statusLabel, embedMemberReport } from "./routineText";
// The structured brief — a projection of data writeRoutineSummary already has,
// shaped for the webview panel. No new computation; this packages outcomes,
// headlines, and problems into a form the brief panel can render directly.
export interface BriefMember {
  readonly label: string;
  readonly status: MemberOutcome["status"];
  readonly headline?: string;
  readonly attention: boolean;
  readonly durationMs?: number;
  readonly reportPath?: string;
}

export interface RoutineBrief {
  readonly routineName: string;
  readonly generatedAt: string;
  readonly verdict: "clear" | "attention";
  readonly attentionCount: number;
  readonly members: readonly BriefMember[];
  readonly summaryPath: string;
}

// Read a member report, or undefined when it cannot be read. A torn-down temp file
// must degrade to the source link, never lose the rest of the document.
async function readOrUndefined(
  fsp: typeof import("fs/promises"),
  file: string
): Promise<string | undefined> {
  try {
    return await fsp.readFile(file, "utf8");
  } catch {
    return undefined;
  }
}

// Pull a member report's one-line finding: `**Attention:** …` when it needs action,
// `**Headline:** …` when it only informs. The convention is written by whichever
// generator produced the report, so the summary needs no per-member knowledge of what
// its members do. Attention is checked first — a report carrying both is asking for
// something, and the weaker line must not mask that. Exported for tests.
export function extractHeadline(
  content: string | undefined
): { text: string; attention: boolean } | undefined {
  if (!content) {
    return undefined;
  }
  const header = reportHeader(content);
  // The capture must START on a non-space: a lazy `.+?` would otherwise match the
  // padding of a blank "**Headline:** " line and lift a single space as the headline.
  const attention = /^\*\*Attention:\*\*[ \t]*(\S.*?)[ \t]*$/m.exec(header)?.[1];
  if (attention) {
    return { text: attention, attention: true };
  }
  const headline = /^\*\*Headline:\*\*[ \t]*(\S.*?)[ \t]*$/m.exec(header)?.[1];
  return headline ? { text: headline, attention: false } : undefined;
}

// The part of a report that may declare a headline: everything before its first
// fenced block. Captured output is UNTRUSTED as report structure — a commit subject,
// a lint message, or a log line beginning with `**Attention:**` would otherwise be
// lifted into the routine's verdict and silently misattributed to the member that
// merely quoted it. Every generator writes its headline above its output, so bounding
// the scan to the header costs nothing and makes that ordering enforced rather than
// merely conventional.
function reportHeader(content: string): string {
  const fence = /^\s*(```|~~~)/m.exec(content);
  return fence ? content.slice(0, fence.index) : content;
}

// Project the data writeRoutineSummary already computed into a RoutineBrief for
// the webview. Exported for unit tests. Attention members sort first.
export function buildRoutineBrief(
  routineName: string,
  outcomes: readonly MemberOutcome[],
  contents: Map<string, string | undefined>,
  attentionCount: number,
  summaryPath: string
): RoutineBrief {
  const members: BriefMember[] = outcomes.map((o) => {
    const finding = o.reportPath ? extractHeadline(contents.get(o.reportPath)) : undefined;
    const isAttention =
      o.status === "failed" || o.status === "missing" || (finding?.attention ?? false);
    return {
      label: o.label,
      status: o.status,
      headline: finding?.text,
      attention: isAttention,
      durationMs: o.durationMs,
      reportPath: o.reportPath,
    };
  });
  members.sort((a, b) => (a.attention === b.attention ? 0 : a.attention ? -1 : 1));
  return {
    routineName,
    generatedAt: new Date().toISOString(),
    verdict: attentionCount > 0 ? "attention" : "clear",
    attentionCount,
    members,
    summaryPath,
  };
}

export async function readMemberReports(
  fsp: typeof import("fs/promises"),
  outcomes: MemberOutcome[]
): Promise<Map<string, string | undefined>> {
  const contents = new Map<string, string | undefined>();
  for (const o of outcomes) {
    if (o.reportPath) {
      contents.set(o.reportPath, await readOrUndefined(fsp, o.reportPath));
    }
  }
  return contents;
}

export function buildVerdictSection(
  parts: string[],
  outcomes: MemberOutcome[],
  contents: Map<string, string | undefined>
): number {
  const problems = outcomes.filter((o) => o.status === "failed" || o.status === "missing");
  const headlines = outcomes
    .map((o) => ({
      label: o.label,
      finding: o.reportPath ? extractHeadline(contents.get(o.reportPath)) : undefined,
    }))
    .filter(
      (h): h is { label: string; finding: { text: string; attention: boolean } } =>
        h.finding !== undefined
    );

  const needsAttention = headlines.filter((h) => h.finding.attention);
  const attentionCount = needsAttention.length + problems.length;
  parts.push(
    attentionCount > 0
      ? `## ${l10n("routine.summary.needsAttention", { count: String(attentionCount) })}`
      : `## ${l10n("routine.summary.allClear")}`,
    ""
  );

  for (const o of problems) {
    const note = sanitizeDetail(o.detail ?? defaultNote(o.status));
    parts.push(`> **${statusLabel(o.status)}** — ${o.label}${note ? `: ${note}` : ""}`);
  }
  if (problems.length > 0) {
    parts.push("");
  }

  for (const h of needsAttention) {
    parts.push(`- **${h.label}** — ${h.finding.text}`);
  }
  if (needsAttention.length > 0) {
    parts.push("");
  }

  const informational = headlines.filter((h) => !h.finding.attention);
  if (informational.length > 0) {
    if (attentionCount > 0) {
      parts.push(`### ${l10n("routine.summary.alsoRan")}`, "");
    }
    for (const h of informational) {
      parts.push(`- **${h.label}** — ${h.finding.text}`);
    }
    parts.push("");
  }
  return attentionCount;
}

export function buildMergedSections(
  parts: string[],
  outcomes: MemberOutcome[],
  contents: Map<string, string | undefined>,
  summaryDir: string
): number {
  let merged = 0;
  for (const o of outcomes) {
    if (!o.reportPath) {
      continue;
    }
    parts.push(
      `<details${o.status === "failed" ? " open" : ""}>`,
      `<summary><strong>${escapeHtml(o.label)}</strong></summary>`,
      ""
    );
    const rel = path.relative(summaryDir, o.reportPath).split(path.sep).join("/");
    parts.push(`_[${path.basename(o.reportPath)}](${rel})_`, "");
    const content = contents.get(o.reportPath);
    if (content !== undefined) {
      const isMarkdown = /\.(md|markdown)$/i.test(o.reportPath);
      parts.push(isMarkdown ? embedMemberReport(content) : fenceBlock(content), "");
      merged++;
    } else {
      parts.push(`_${l10n("routine.summary.readFailed")}_`, "");
    }
    parts.push("</details>", "");
  }
  return merged;
}
