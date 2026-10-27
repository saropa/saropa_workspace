import * as vscode from "vscode";
import * as path from "path";
import { Shortcut, RoutineMember } from "../model/shortcut";
import { RunSource } from "./telemetry";
import { runStatusRegistry } from "./runStatus";
import { shortcutEvents } from "./shortcutEvents";
import { ShortcutBadge, shortcutBadges } from "./shortcutBadges";
import { hasInteractiveTokens } from "./promptTokens";
import { l10n } from "../i18n/l10n";
import { getOutputChannel } from "./terminalRunner";
// The escaping algorithm itself is centralized (BUG-012); imported directly since this
// file already calls it `escapeHtml`.
import { escapeHtml } from "../utils/escapeHtml";
import { expandRecipeTokens, firstWorkspacePath, reportRelativePath } from "./actionRunner";
import { recordLastReport, peekLastReport, clearLastReport } from "./lastReport";
import { recordLastBrief } from "./lastBrief";
import { openReport, withReportOpenSuppressed } from "./reportOpen";
import { BriefPanel } from "../views/briefPanel";
import { MemberOutcome, embedMemberReport } from "./routineText";
import {
  readMemberReports,
  buildVerdictSection,
  buildMergedSections,
  buildRoutineBrief,
  RoutineBrief,
} from "./routineBrief";

// Re-exported so existing import paths keep working.
export { embedMemberReport };
export { extractHeadline, buildRoutineBrief } from "./routineBrief";
export type { BriefMember, RoutineBrief } from "./routineBrief";
// The routine engine: run a "recipe of recipes" — its member shortcuts strictly in
// sequence, continue-on-failure — then write a one-row-per-member summary report and
// badge the routine shortcut with the worst member outcome. Split out of actionRunner so
// the action dispatcher stays focused on the single-shortcut kinds. The resolve + run
// hooks are injected at activation (the runner cannot import the store/command layer
// without a cycle); runAction dispatches a routine action here.
// --- routine (a recipe of recipes) -------------------------------------

// Hooks injected once at activation (extension.ts) so the runner can resolve a
// routine member to its live shortcut and run it through the same single-shortcut path the
// tree / palette use, WITHOUT importing the store / command layer (that import
// would cycle: pinCommands already imports runAction). runRoutine no-ops with a
// logged note when the hooks are unset.
export interface RoutineHooks {
  // Resolve a member reference to the live shortcut, or undefined when the member recipe
  // / shortcut is absent (removed, not yet detected). recipeId is tried before pinId.
  resolveMember(member: RoutineMember): Shortcut | undefined;
  // Run one member shortcut to completion through the canonical single-shortcut path (handles
  // file vs action, dependency gating, missing files). Awaited so members run
  // strictly in sequence — overlapping report-writing members would interleave
  // output and spike CPU, the exact failure the hygiene member guards against.
  runMember(shortcut: Shortcut): Promise<void>;
}

let routineHooks: RoutineHooks | undefined;

// Wire the resolve/run hooks in from activation, once. Called after pinCommands
// registers so runRoutine can run a member through the canonical single-shortcut
// path without routineRunner importing the store/command layer, which would cycle.
export function setRoutineHooks(hooks: RoutineHooks): void {
  routineHooks = hooks;
}

// Run one routine member to completion and report its outcome. Pulled out of the
// runRoutine loop so the engine reads as resolve -> classify -> run -> derive
// outcome at one level. Returns the summary-row outcome, whether it counts as a
// failure (folded into the routine's worst-outcome badge), and — only when the
// member actually ran — its shortcut id so the caller can fold in the member's badge
// counts. The skip cases (missing member, nested routine, interactive under an
// unattended fire) never run and carry no badge id.
async function runRoutineMember(
  hooks: RoutineHooks,
  member: RoutineMember,
  index: number,
  count: number,
  routineName: string,
  unattended: boolean,
  channel: vscode.OutputChannel
): Promise<{ outcome: MemberOutcome; failed: boolean; badgeShortcutId?: string }> {
  const resolved = hooks.resolveMember(member);
  const memberLabel =
    member.label ??
    resolved?.label ??
    resolved?.id ??
    member.recipeId ??
    member.pinId ??
    `#${index + 1}`;

  // Per-member progress line into the shared channel ("Routine 'Morning' — 2/5: …").
  channel.appendLine(
    l10n("routine.step", {
      name: routineName,
      index: String(index + 1),
      count: String(count),
      member: memberLabel,
    })
  );

  if (!resolved) {
    channel.appendLine(l10n("routine.memberMissing", { member: memberLabel }));
    // A member the routine can no longer resolve counts as a FAILURE, not a note: the
    // routine did not do what it was configured to do. Scored as a non-failure, a
    // routine whose member had been renamed away reported clean success and never
    // opened its summary, so the "Shortcut not found" banner sat unread in a file
    // nobody had reason to look at (user report 2026-07-20). The status stays
    // "missing" so the report says Missing, not Failed.
    return { outcome: { label: memberLabel, status: "missing" }, failed: true };
  }
  // Routines do not nest: a routine member is skipped (bounds sequencing/failure
  // and prevents cycles), the one-level rule macros already enforce.
  if (resolved.action?.kind === "routine") {
    channel.appendLine(l10n("routine.nestedSkipped", { member: memberLabel }));
    return {
      outcome: {
        label: memberLabel,
        status: "skipped",
        detail: l10n("routine.nestedSkippedDetail"),
      },
      failed: false,
    };
  }
  if (unattended && hasInteractiveTokens(resolved)) {
    channel.appendLine(l10n("routine.interactiveSkipped", { member: memberLabel }));
    return {
      outcome: {
        label: memberLabel,
        status: "skipped",
        detail: l10n("routine.interactiveSkippedDetail"),
      },
      failed: false,
    };
  }

  // Drop any report path a PRIOR run of this member left, so the post-run peek below
  // links only a report THIS run actually wrote. Without this, a member that writes
  // no report this run (a deps check that failed, a no-op) would relink its previous
  // run's stale, wrong-dated report into the summary.
  clearLastReport(resolved.id);

  const startedAt = Date.now();
  try {
    await hooks.runMember(resolved);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    channel.appendLine(l10n("routine.memberFailed", { member: memberLabel, error }));
    return {
      outcome: {
        label: memberLabel,
        status: "failed",
        durationMs: Date.now() - startedAt,
        detail: error,
      },
      failed: true,
    };
  }

  // The path of the report this member just wrote (peek, not take: see lastReport).
  // Undefined for a member that writes no file — its summary row then carries no link.
  const reportPath = peekLastReport(resolved.id);

  // Read the member's tracked outcome — background / report runs record one. A
  // terminal / url / command member has no tracked exit, so the absence of a fresh
  // result reads as "dispatched", never a failure. Guard on endedAt >= startedAt so
  // a stale prior-run result is not mistaken for this run's.
  const result = runStatusRegistry.get(resolved.id);
  const fresh = result && result.endedAt >= startedAt ? result : undefined;
  if (fresh) {
    const failed = fresh.outcome !== "success";
    return {
      outcome: {
        label: memberLabel,
        status: failed ? "failed" : "ok",
        durationMs: fresh.durationMs,
        // A tracked failure with no detail would render a bare "Failed — <member>"
        // attention line in the summary; the exit code is the one fact the tracker
        // holds, so carry it (the member's own report, when it wrote one, is merged
        // below with the full story).
        detail: failed
          ? l10n("routine.note.failedExit", { code: fresh.exitCode ?? "—" })
          : undefined,
        reportPath,
      },
      failed,
      badgeShortcutId: resolved.id,
    };
  }
  return {
    outcome: {
      label: memberLabel,
      status: "dispatched",
      durationMs: Date.now() - startedAt,
      reportPath,
    },
    failed: false,
    badgeShortcutId: resolved.id,
  };
}

/**
 * Badges the routine shortcut itself and fires its completion event. Result is a
 * worst-outcome (red when any member failed) plus the aggregated finding counts.
 */
function recordRoutineResult(pinId: string, aggregate: ShortcutBadge, anyFailed: boolean): void {
  // Badge the routine shortcut: a tracked worst-outcome result (red when any member
  // failed) plus the aggregated finding counts, both through the per-shortcut machinery
  // the tree already paints.
  runStatusRegistry.record(pinId, {
    outcome: anyFailed ? "failure" : "success",
    exitCode: anyFailed ? 1 : 0,
    durationMs: 0,
    endedAt: Date.now(),
  });
  if (hasBadgeCounts(aggregate)) {
    shortcutBadges.record(pinId, aggregate);
  }
  shortcutEvents.fireComplete(pinId, anyFailed ? "failure" : "success");
}

/** Shows the "routine starting" toast unless run toasts are switched off. */
function announceRoutineStart(name: string, count: number): void {
  const showToasts = vscode.workspace
    .getConfiguration("saropaWorkspace")
    .get<boolean>("showRunToasts", true);
  if (showToasts) {
    vscode.window.showInformationMessage(l10n("routine.starting", { name, count: String(count) }));
  }
}

// Run a routine's members strictly in sequence, continue-on-failure, then write a
// one-row-per-member summary report and badge the routine shortcut with the worst member
// outcome. Mirrors runMacro's failure policy (one broken member never blocks the
// rest) but over real recipe shortcuts rather than inline steps.
export async function runRoutine(
  shortcut: Shortcut,
  members: RoutineMember[],
  source: RunSource
): Promise<void> {
  const channel = getOutputChannel();
  const name = shortcut.label ?? shortcut.id;
  // A scheduled fire is unattended: interactive members cannot be answered, so they
  // are skipped (same rule the scheduler applies to scheduled shortcuts).
  const unattended = source === "scheduled";

  if (!routineHooks) {
    channel.appendLine(l10n("routine.notReady", { name }));
    shortcutEvents.fireComplete(shortcut.id, "dispatched");
    return;
  }
  if (members.length === 0) {
    vscode.window.showInformationMessage(l10n("routine.empty", { name }));
    shortcutEvents.fireComplete(shortcut.id, "dispatched");
    return;
  }

  announceRoutineStart(name, members.length);

  const outcomes: MemberOutcome[] = [];
  const aggregate: ShortcutBadge = { at: Date.now() };
  let anyFailed = false;

  // Members run with their own report auto-open suppressed: a routine opens exactly
  // one window, the consolidated summary below. Without this, each report member
  // raised its own editor and the summary — the index over them — stayed closed.
  const hooks = routineHooks;
  await withReportOpenSuppressed(async () => {
    for (const [index, member] of members.entries()) {
      const { outcome, failed, badgeShortcutId } = await runRoutineMember(
        hooks,
        member,
        index,
        members.length,
        name,
        unattended,
        channel
      );
      outcomes.push(outcome);
      if (failed) {
        anyFailed = true;
      }
      // Fold the member's diagnostic / test badge into the routine's aggregate, so the
      // routine row shows the morning's total findings (#26 / #32 badge reuse). Only a
      // member that actually ran carries a badge shortcut id.
      if (badgeShortcutId) {
        mergeBadge(aggregate, shortcutBadges.get(badgeShortcutId));
      }
    }
  });

  recordRoutineResult(shortcut.id, aggregate, anyFailed);

  await writeRoutineSummary(shortcut.id, name, outcomes, anyFailed, source);
}

// Sum a member's badge counts into the routine aggregate. Undefined member badge
// (a non-lint / non-test member) contributes nothing.
function mergeBadge(into: ShortcutBadge, from: ShortcutBadge | undefined): void {
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

function hasBadgeCounts(badge: ShortcutBadge): boolean {
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
async function writeRoutineSummary(
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
