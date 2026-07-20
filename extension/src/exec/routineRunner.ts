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
import {
  expandRecipeTokens,
  fenceBlock,
  firstWorkspacePath,
  reportRelativePath,
} from "./actionRunner";
import { recordLastReport, peekLastReport, clearLastReport } from "./lastReport";
import { openReport, withReportOpenSuppressed } from "./reportOpen";

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

// The outcome of one member within a routine run, for the summary report row.
interface MemberOutcome {
  label: string;
  status: "ok" | "failed" | "skipped" | "missing" | "dispatched";
  durationMs?: number;
  detail?: string;
  // Absolute path of the report this member wrote, when it wrote one (the report
  // rituals and project-stats do; a terminal / url member does not). The summary
  // turns it into a relative link so it is the one index over the day's sub-reports.
  reportPath?: string;
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

  // The directory the summary itself lives in, so each member's report path becomes
  // a link relative to the summary — the links resolve wherever the reports/ tree is
  // opened, not just on this machine. Member reports are written to this same dated
  // folder, so their own internal relative links stay valid after the merge.
  const summaryDir = path.dirname(reportPath);
  const fsp = await import("fs/promises");

  const parts: string[] = [
    `# ${name}`,
    "",
    `**${l10n("routine.summary.generated")}** ${new Date().toLocaleString()}`,
    "",
  ];

  // Problems first, and ONLY problems: a failed or missing member is the one piece
  // of execution state the reader must see. OK / dispatched members are invisible
  // as mechanics — their value is their content below (or nothing, for a terminal
  // member that produces no report; announcing "a terminal ran" is noise). Details
  // are sanitized: a multi-line spawn error pasted raw into a blockquote would
  // break out of the quote and swallow the document.
  const problems = outcomes.filter((o) => o.status === "failed" || o.status === "missing");
  for (const o of problems) {
    const note = sanitizeDetail(o.detail ?? defaultNote(o.status));
    parts.push(`> **${statusLabel(o.status)}** — ${o.label}${note ? `: ${note}` : ""}`);
  }
  if (problems.length > 0) {
    parts.push("");
  }

  // Merge each member report's body in as a collapsible section, so a multi-member
  // morning report opens as scannable one-line headers that expand on click. A
  // FAILED member's section renders pre-expanded (`open`) — the reader must not
  // have to hunt for the one section that matters. Read failures degrade to the
  // source link — a torn-down temp file must not lose the rest of the document.
  let merged = 0;
  for (const o of outcomes) {
    if (!o.reportPath) {
      continue;
    }
    // <summary> content is raw HTML (Markdown inline syntax is not parsed inside
    // it), so the member label uses <strong>, and the clickable source link lives
    // in the Markdown body below instead.
    parts.push(
      `<details${o.status === "failed" ? " open" : ""}>`,
      `<summary><strong>${escapeHtml(o.label)}</strong></summary>`,
      ""
    );
    const rel = path.relative(summaryDir, o.reportPath).split(path.sep).join("/");
    // Source link at the top of the section keeps the summary the index over its
    // parts (style guide: a summary links its sub-reports) even though the content
    // is inline.
    parts.push(`_[${path.basename(o.reportPath)}](${rel})_`, "");
    try {
      const content = await fsp.readFile(o.reportPath, "utf8");
      // Only Markdown merges as Markdown. Any other extension (a .log, .txt, .csv
      // a member happened to record) is fenced as preformatted text — raw log
      // content read as Markdown is the "unreadable slop" failure the report
      // conventions exist to prevent.
      const isMarkdown = /\.(md|markdown)$/i.test(o.reportPath);
      parts.push(isMarkdown ? embedMemberReport(content) : fenceBlock(content), "");
      merged++;
    } catch {
      parts.push(`_${l10n("routine.summary.readFailed")}_`, "");
    }
    parts.push("</details>", "");
  }

  // Nothing merged and nothing wrong: say what happened in one line, so a routine of
  // pure terminal members still opens a document that explains itself.
  if (merged === 0 && problems.length === 0) {
    parts.push(`_${l10n("routine.summary.noReports")}_`, "");
  }

  const body = parts.join("\n");

  try {
    await fsp.mkdir(path.dirname(reportPath), { recursive: true });
    await fsp.writeFile(reportPath, body, "utf8");
    channel.appendLine(l10n("report.wrote", { name, path: reportPath }));
    // Hand the summary path to the scheduler so a scheduled routine fire can persist
    // a durable "Open report" link for the routine (see lastReport.ts).
    recordLastReport(pinId, reportPath);
    await openReport(reportPath);
  } catch (err) {
    channel.appendLine(
      l10n("report.failed", { name, error: err instanceof Error ? err.message : String(err) })
    );
  }
}

// Human-readable status word for an attention line, from the catalog. The raw enum
// values ("missing", "failed") are code identifiers, not user copy.
const STATUS_KEYS: Record<MemberOutcome["status"], string> = {
  ok: "routine.status.ok",
  failed: "routine.status.failed",
  skipped: "routine.status.skipped",
  missing: "routine.status.missing",
  dispatched: "routine.status.dispatched",
};

function statusLabel(status: MemberOutcome["status"]): string {
  return l10n(STATUS_KEYS[status]);
}

// Explanation for statuses whose meaning is not self-evident: what happened and
// what the user can do. Failed members carry their own error detail instead.
function defaultNote(status: MemberOutcome["status"]): string {
  if (status === "missing") {
    return l10n("routine.note.missing");
  }
  return "";
}

// How much of a member's error detail the attention line carries. A spawn error
// can be a full stack trace; the attention line is a one-line pointer, not the
// error's home (the output channel keeps the full text).
const DETAIL_MAX_CHARS = 200;

// Flatten a detail to one line and bound its length so a raw multi-line error
// message cannot break out of the attention blockquote or dominate the document.
function sanitizeDetail(detail: string): string {
  const oneLine = detail.replace(/\s*\n\s*/g, " ").trim();
  return oneLine.length > DETAIL_MAX_CHARS
    ? `${oneLine.slice(0, DETAIL_MAX_CHARS)}…`
    : oneLine;
}

// Escape a member label for raw-HTML contexts (<summary>), where Markdown escaping
// does not apply and an angle bracket in a label would be parsed as a tag.
function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Prepare one member report's body for inline embedding under its `## <member>`
// section heading: drop the report's own H1 (the section heading already names it —
// keeping both renders a duplicate title), then demote every remaining heading two
// levels so the member's internal structure nests under the section instead of
// competing with the summary's own hierarchy. Heading syntax inside fenced code
// blocks (captured command output is fenced per the report conventions) is left
// untouched — a `# comment` in captured shell output is content, not structure.
// ATX headings only (`# Title`); Setext headings (`Title` over `===`) are not
// recognized — no report writer in this codebase emits them, and a future one must
// not without extending this.
// Exported for unit tests: the fence tracking and demotion edge cases are pure
// string transforms, assertable without running a routine.
export function embedMemberReport(markdown: string): string {
  const lines = markdown.split("\n");

  // Drop the leading H1 (first non-empty line only — an H1 later in the body is a
  // real section and gets demoted like the rest).
  const firstContent = lines.findIndex((line) => line.trim() !== "");
  if (firstContent >= 0 && /^# /.test(lines[firstContent] ?? "")) {
    lines.splice(firstContent, 1);
  }

  // Fence tracking pairs the CHARACTER and LENGTH of the opening fence, matching
  // CommonMark: a fence closes only on the same character with at least the opening
  // run's length. This matters because buildCommandReport deliberately widens its
  // fence to (longest inner run + 1) so captured output containing ``` stays inside
  // the block — a naive any-3+-run toggle would flip state on that inner run and
  // then mangle the rest of the document as if it were outside the fence.
  let openFence: { char: string; length: number } | undefined;
  const out = lines.map((line) => {
    // A fence opener/closer may be indented at most 3 spaces (CommonMark): 4+
    // spaces is an indented code block, and a backtick run inside one (e.g. inside
    // a list item's code) is content, not a fence toggle.
    const run = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (run) {
      const char = (run[1] ?? "")[0] ?? "`";
      const length = (run[1] ?? "").length;
      if (!openFence) {
        openFence = { char, length };
      } else if (char === openFence.char && length >= openFence.length) {
        openFence = undefined;
      }
      // A shorter or different-character run inside an open fence is content —
      // fall through as a plain line (no state change, and headings can't match a
      // fence line anyway).
      return line;
    }
    if (openFence) {
      return line;
    }
    // Demote headings outside fences, clamped at H6 (Markdown's deepest level —
    // more # characters would render as literal text). An H5/H6 therefore lands on
    // H6 alongside a demoted H4; a flattened tail beats un-renderable syntax.
    const heading = /^(#{1,6}) /.exec(line);
    if (!heading) {
      return line;
    }
    const depth = Math.min(6, (heading[1] ?? "").length + 2);
    return `${"#".repeat(depth)} ${line.slice((heading[1] ?? "").length + 1)}`;
  });
  return out.join("\n").trim();
}
