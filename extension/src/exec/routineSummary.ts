import * as path from "path";
import { RunSource } from "./telemetry";
import { ShortcutBadge } from "./shortcutBadges";
import { l10n } from "../i18n/l10n";
import { getOutputChannel } from "./terminalRunner";
import { expandRecipeTokens, firstWorkspacePath, reportRelativePath } from "./actionRunner";
import { recordLastReport } from "./lastReport";
import { recordLastBrief } from "./lastBrief";
import { openReport } from "./reportOpen";
import { BriefPanel } from "../views/briefPanel";
import { MemberOutcome } from "./routineText";
import {
  readMemberReports,
  buildVerdictSection,
  buildMergedSections,
  buildRoutineBrief,
  RoutineBrief,
} from "./routineBrief";

// The routine's badge aggregation and its merged summary report. Split out of
// routineRunner.ts, which runs the members and calls into here.

// Sum a member's badge counts into the routine aggregate. Undefined member badge
// (a non-lint / non-test member) contributes nothing.
export function mergeBadge(into: ShortcutBadge, from: ShortcutBadge | undefined): void {
  if (!from) {
    return;
  }
  const add = (a: number | undefined, b: number | undefined): number | undefined =>
    a === undefined && b === undefined ? undefined : (a ?? 0) + (b ?? 0);
  into.errors = add(into.errors, from.errors);
  into.warnings = add(into.warnings, from.warnings);
  into.infos = add(into.infos, from.infos);
  into.testsPassed = add(into.testsPassed, from.testsPassed);
  into.testsFailed = add(into.testsFailed, from.testsFailed);
}

/** True when the badge carries at least one lint or test count worth showing. */
export function hasBadgeCounts(badge: ShortcutBadge): boolean {
  return (
    badge.errors !== undefined ||
    badge.warnings !== undefined ||
    badge.infos !== undefined ||
    badge.testsPassed !== undefined ||
    badge.testsFailed !== undefined
  );
}

/**
 * Shows the finished routine: the Brief panel (falling back to the Markdown report
 * if the panel fails), or just a log line for a clean scheduled run.
 */
async function showSummary(
  brief: RoutineBrief,
  reportPath: string,
  name: string,
  source: RunSource,
  needsReader: boolean
): Promise<void> {
  const channel = getOutputChannel();
  // A manual run must produce a visible window (no-silent-async rule).
  // A scheduled run opens only when something needs the reader.
  const shouldOpen = source !== "scheduled" || needsReader;
  if (shouldOpen) {
    try {
      BriefPanel.show(brief);
    } catch (panelErr) {
      channel.appendLine(
        `[brief] panel failed, falling back to markdown: ${panelErr instanceof Error ? panelErr.message : String(panelErr)}`
      );
      await openReport(reportPath);
    }
  } else {
    channel.appendLine(
      l10n("routine.summary.quietClean", { name, path: reportPath })
    );
  }
}

// Write the routine summary — the day's CONTENT, not execution mechanics: each
// member report's full body merged in as a section, so the one document the routine
// opens is the standup / stats / PR content the user actually wants to read.
// Execution plumbing appears only when something went wrong (a failed or missing
// member gets one attention line at the top); a clean run shows pure content. This
// replaces the old outcome table ("dispatched", durations, per-row status), which
// reported on the runner instead of the results and added no value (user report
// 2026-07-16). This is still the ONE window a routine raises: members ran with
// auto-open suppressed, so the merged summary is both the outcome and the content.
export async function writeRoutineSummary(
  pinId: string,
  name: string,
  outcomes: MemberOutcome[],
  anyFailed: boolean,
  source: RunSource
): Promise<void> {
  const base = firstWorkspacePath();
  if (!base) {
    return;
  }
  const channel = getOutputChannel();
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "routine";
  const relative = expandRecipeTokens(reportRelativePath(slug));
  const reportPath = path.join(base, ...relative.split("/"));
  const summaryDir = path.dirname(reportPath);
  const fsp = await import("fs/promises");

  const contents = await readMemberReports(fsp, outcomes);

  const parts: string[] = [
    `# ${name}`,
    "",
    `**${l10n("routine.summary.generated")}** ${new Date().toLocaleString()}`,
    "",
  ];

  const attentionCount = buildVerdictSection(parts, outcomes, contents);
  const merged = buildMergedSections(parts, outcomes, contents, summaryDir);

  if (merged === 0 && outcomes.every((o) => o.status !== "failed" && o.status !== "missing")) {
    parts.push(`_${l10n("routine.summary.noReports")}_`, "");
  }

  try {
    await fsp.mkdir(path.dirname(reportPath), { recursive: true });
    await fsp.writeFile(reportPath, parts.join("\n"), "utf8");
    channel.appendLine(l10n("report.wrote", { name, path: reportPath }));
    recordLastReport(pinId, reportPath);

    const brief = buildRoutineBrief(name, outcomes, contents, attentionCount, reportPath);
    recordLastBrief(pinId, brief);

    await showSummary(brief, reportPath, name, source, anyFailed || attentionCount > 0);
  } catch (err) {
    channel.appendLine(
      l10n("report.failed", { name, error: err instanceof Error ? err.message : String(err) })
    );
  }
}
