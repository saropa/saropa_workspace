import { Shortcut } from "../model/shortcut";
import { nextOccurrence } from "../exec/schedule";
import { RunResult } from "../exec/runStatus";
import { ShortcutBadge, formatBadgeLead } from "../exec/shortcutBadges";
import { MetricBadge } from "../exec/metricBadges";
import { RunSource } from "../exec/telemetry";
import { formatRelativeTime } from "./projectFilesProvider";
import {
  formatNextRun,
  formatRunBadge,
  expirySummary,
  actionSummary,
  recentTag,
} from "./shortcutRowFormatting";
import { l10n } from "../i18n/l10n";

// The badge + description assembly phase of ShortcutTreeItem's constructor, split out
// so the class body stays a short sequence of builder calls. Pure function: every
// input is an explicit value (never the live Shortcut store), so it is unit-testable
// in isolation like the shortcutRowFormatting helpers it composes.

// The raw inputs the row's trailing description (and its leading state badge) are
// built from. Mirrors the subset of ShortcutTreeItem constructor parameters this
// phase actually reads.
export interface ShortcutRowDescriptionInput {
  readonly shortcut: Shortcut;
  readonly masked: boolean;
  readonly isFile: boolean;
  readonly isRunning: boolean;
  readonly isStopping: boolean;
  readonly lastRun: RunResult | undefined;
  readonly lockedBy: string | undefined;
  readonly sweepBadge: ShortcutBadge | undefined;
  readonly metricBadge: MetricBadge | undefined;
  readonly recentInfo:
    | { at: number; source: RunSource; kind?: "run" | "opened" }
    | undefined;
}

// The row's description text, plus the metric value formatted for reuse: the tooltip
// builder needs the identical string for its "current value" line, and recomputing it
// there would risk drifting from what the row actually displays.
export interface ShortcutRowDescriptionResult {
  readonly description: string;
  readonly metricText: string | undefined;
}

// Leading inline badge, by priority: a running shortcut's live state wins; then a
// locked-dependency notice; then a paused notice; then a scheduled shortcut's queued
// next-run time (2.2); then the last completed run's outcome and duration (7.2). Only
// one badge shows — the most actionable.
function computeRowStateBadge(input: ShortcutRowDescriptionInput): string | undefined {
  const { shortcut, isRunning, isStopping, lastRun, lockedBy } = input;
  const next = shortcut.schedule
    ? nextOccurrence(shortcut.schedule, Date.now())
    : undefined;
  const nextLabel = next !== undefined ? formatNextRun(next) : undefined;
  const lastRunBadge = lastRun ? formatRunBadge(lastRun) : undefined;
  // A locked shortcut's "waiting on <prerequisite>" badge wins over a schedule /
  // last-run badge while resting, since not-yet-runnable is the most actionable
  // resting fact.
  const lockBadge =
    lockedBy && !isRunning && !isStopping
      ? l10n("depends.treeBadge", { dep: lockedBy })
      : undefined;
  // A paused shortcut shows a "paused" badge instead of its next-run time: the
  // schedule is kept but no timer is armed, so surfacing a next-run instant it will
  // not honor would mislead. Running / stopping / a lock still win — those are live,
  // more actionable states, and a paused shortcut can still be run manually.
  return isStopping
    ? l10n("run.stoppingBadge")
    : isRunning
      ? l10n("run.treeBadge")
      : lockBadge
        ? lockBadge
        : shortcut.paused
          ? l10n("pause.treeBadge")
          : nextLabel
            ? l10n("schedule.treeBadge", { time: nextLabel })
            : lastRunBadge;
}

// The live metric value (#24), shared by the row and the hover. Size / line text is
// precomputed by the engine; "modified" is formatted relative here so it stays
// current between repaints (the engine cannot re-fire just because wall-clock
// advanced). A masked shortcut shows no metric: a size/line-count value is a hint
// about the target, and the point of masking is to leak nothing while resting.
function computeRowMetricText(
  metricBadge: MetricBadge | undefined,
  masked: boolean
): string | undefined {
  return metricBadge && !masked
    ? metricBadge.kind === "modified" && metricBadge.mtime !== undefined
      ? formatRelativeTime(metricBadge.mtime, Date.now())
      : metricBadge.text
    : undefined;
}

// Assemble a shortcut tree row's trailing description: the leading state badge
// (running / scheduled / paused / last-run), the identity detail (path or action
// summary), and the live metric — or, for a Recent-group entry, when it last ran
// instead of the state badge.
export function buildShortcutRowDescription(
  input: ShortcutRowDescriptionInput
): ShortcutRowDescriptionResult {
  const {
    shortcut,
    masked,
    isFile,
    isRunning,
    isStopping,
    lastRun,
    lockedBy,
    sweepBadge,
    metricBadge,
    recentInfo,
  } = input;

  const badge = computeRowStateBadge(input);
  // For a file shortcut the trailing detail is its path; for a non-file shortcut it
  // is a summary of what the action does (the URL, the command line, etc.). A masked
  // shortcut contributes none — the path is exactly what must stay hidden — so the
  // join below drops it (the falsy filter) and the row carries only state badges.
  const detail = masked
    ? undefined
    : isFile
      ? shortcut.path
      : actionSummary(shortcut);
  // A resting shortcut's last-sweep counts lead the row (the most informative resting
  // fact for a lint / test shortcut), then the state badge, then the path/action
  // detail. Suppressed while running/stopping, where the live state is what matters.
  const badgeLead =
    sweepBadge && !isRunning && !isStopping
      ? formatBadgeLead(sweepBadge)
      : undefined;
  const metricText = computeRowMetricText(metricBadge, masked);

  let description: string;
  // A Recent entry leads with when it last ran (and a hint if it was a scheduled
  // fire), since "how recently" is the reason it is in this group; otherwise the
  // leading slot is the most-actionable badge (running / next-run / last-run).
  if (recentInfo) {
    const when = formatRelativeTime(recentInfo.at, Date.now());
    // Tag a Recent entry as opened vs a scheduled fire (a plain manual run gets no
    // tag), via the shared formatter so the sidebar, dashboard, and report agree.
    const tagToken = recentTag(recentInfo);
    const tag = tagToken ? ` ${tagToken}` : "";
    // A masked shortcut's detail is hidden, so a Recent entry shows only when it ran,
    // never the path — `detail` is undefined under mask.
    description = detail ? `${when}${tag} · ${detail}` : `${when}${tag}`;
  } else {
    // A time-bombed shortcut (WOW #9) shows a compact countdown / branch chip so the
    // row carries its pending self-removal at a glance; the full condition is in
    // the hover. Suppressed while running/stopping, where live state matters more.
    const expiryChip =
      !isRunning && !isStopping ? expirySummary(shortcut) : undefined;
    // Row budget (UI plan, Phase 1): leading sweep counts, the one most-actionable
    // state badge, a single expiry chip, the identity detail, and the live metric
    // the user opted into per shortcut. The branch link and mode tags are
    // deliberately NOT joined onto the row — both already have a dedicated hover line
    // below, and crowding a narrow sidebar row with up to seven `·`-joined segments
    // was the main "hard to glance" offender. Holding the row to these few parts lets
    // the eye lock onto state and identity without parsing a long string.
    description = [badgeLead, badge, expiryChip, detail, metricText]
      .filter((part) => part)
      .join(" · ");
  }

  return { description, metricText };
}
