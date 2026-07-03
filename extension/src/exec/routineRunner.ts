import * as vscode from "vscode";
import * as path from "path";
import { Shortcut, RoutineMember } from "../model/shortcut";
import { RunSource } from "./telemetry";
import { runStatusRegistry, formatDuration } from "./runStatus";
import { shortcutEvents } from "./shortcutEvents";
import { ShortcutBadge, shortcutBadges } from "./shortcutBadges";
import { hasInteractiveTokens } from "./promptTokens";
import { l10n } from "../i18n/l10n";
import { getOutputChannel } from "./terminalRunner";
import { expandRecipeTokens, firstWorkspacePath, reportRelativePath } from "./actionRunner";
import { recordLastReport } from "./lastReport";

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

export function setRoutineHooks(hooks: RoutineHooks): void {
  routineHooks = hooks;
}

// The outcome of one member within a routine run, for the summary report row.
interface MemberOutcome {
  label: string;
  status: "ok" | "failed" | "skipped" | "missing" | "dispatched";
  durationMs?: number;
  detail?: string;
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
    return { outcome: { label: memberLabel, status: "missing" }, failed: false };
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

  // Read the member's tracked outcome — background / report runs record one. A
  // terminal / url / command member has no tracked exit, so the absence of a fresh
  // result reads as "dispatched", never a failure. Guard on endedAt >= startedAt so
  // a stale prior-run result is not mistaken for this run's.
  const result = runStatusRegistry.get(resolved.id);
  const fresh = result && result.endedAt >= startedAt ? result : undefined;
  if (fresh) {
    return {
      outcome: {
        label: memberLabel,
        status: fresh.outcome === "success" ? "ok" : "failed",
        durationMs: fresh.durationMs,
      },
      failed: fresh.outcome === "failure",
      badgeShortcutId: resolved.id,
    };
  }
  return {
    outcome: {
      label: memberLabel,
      status: "dispatched",
      durationMs: Date.now() - startedAt,
    },
    failed: false,
    badgeShortcutId: resolved.id,
  };
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

  vscode.window.showInformationMessage(
    l10n("routine.starting", { name, count: String(members.length) })
  );

  const outcomes: MemberOutcome[] = [];
  const aggregate: ShortcutBadge = { at: Date.now() };
  let anyFailed = false;

  for (const [index, member] of members.entries()) {
    const { outcome, failed, badgeShortcutId } = await runRoutineMember(
      routineHooks,
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

  // Badge the routine shortcut: a tracked worst-outcome result (red when any member
  // failed) plus the aggregated finding counts, both through the per-shortcut machinery
  // the tree already paints.
  runStatusRegistry.record(shortcut.id, {
    outcome: anyFailed ? "failure" : "success",
    exitCode: anyFailed ? 1 : 0,
    durationMs: 0,
    endedAt: Date.now(),
  });
  if (hasBadgeCounts(aggregate)) {
    shortcutBadges.record(shortcut.id, aggregate);
  }
  shortcutEvents.fireComplete(shortcut.id, anyFailed ? "failure" : "success");

  await writeRoutineSummary(shortcut.id, name, outcomes, anyFailed);
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

// Write the routine summary — one row per member (outcome + duration) — to a dated
// reports/ file, and open it when any member failed (otherwise stay quiet, badge
// only: the no-noise rule the scheduled rituals follow). Members write their own
// reports under reports/; this is the one-screen index over them.
async function writeRoutineSummary(
  pinId: string,
  name: string,
  outcomes: MemberOutcome[],
  anyFailed: boolean
): Promise<void> {
  const base = firstWorkspacePath();
  if (!base) {
    return;
  }
  const channel = getOutputChannel();
  // Filesystem-safe slug for the file name; the heading keeps the human name.
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "routine";
  const relative = expandRecipeTokens(reportRelativePath(slug));
  const reportPath = path.join(base, ...relative.split("/"));

  const rows = outcomes
    .map((o) => {
      const duration = o.durationMs !== undefined ? formatDuration(o.durationMs) : "—";
      const detail = o.detail ? escapeCell(o.detail) : "";
      return `| ${escapeCell(o.label)} | ${o.status} | ${duration} | ${detail} |`;
    })
    .join("\n");
  const body =
    `# ${name}\n\n` +
    `Generated ${new Date().toLocaleString()}\n\n` +
    `${outcomes.length} member(s); ${anyFailed ? "one or more need attention." : "all clear."}\n\n` +
    `| Member | Outcome | Duration | Notes |\n` +
    `|---|---|---|---|\n` +
    `${rows}\n`;

  try {
    const fsp = await import("fs/promises");
    await fsp.mkdir(path.dirname(reportPath), { recursive: true });
    await fsp.writeFile(reportPath, body, "utf8");
    channel.appendLine(l10n("report.wrote", { name, path: reportPath }));
    // Hand the summary path to the scheduler so a scheduled routine fire can persist
    // a durable "Open report" link for the routine (see lastReport.ts).
    recordLastReport(pinId, reportPath);
    // Open the summary only when something needs the user — a clean run is silent.
    if (anyFailed) {
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(reportPath));
      await vscode.window.showTextDocument(doc, { preview: false });
    }
  } catch (err) {
    channel.appendLine(
      l10n("report.failed", { name, error: err instanceof Error ? err.message : String(err) })
    );
  }
}

// Escape a Markdown table cell so a member label / error containing a pipe does not
// break the table layout.
function escapeCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ");
}
