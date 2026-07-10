import * as vscode from "vscode";
import { Shortcut } from "../model/shortcut";
import { nextOccurrence } from "../exec/schedule";
import { RunResult } from "../exec/runStatus";
import { ShortcutBadge } from "../exec/shortcutBadges";
import { MetricBadge } from "../exec/metricBadges";
import {
  formatNextRun,
  actionSummary,
  formatExpiryInstant,
  formatRunTooltip,
  formatDiagTooltip,
  formatTestTooltip,
} from "./shortcutRowFormatting";
import { l10n } from "../i18n/l10n";

// The tooltip-lines assembly phase of ShortcutTreeItem's constructor, split out so the
// class body stays a short sequence of builder calls. Returns the ordered lines
// (never a joined string), matching the function's name; the constructor joins them
// with "\n".

// The raw inputs the hover's lines are built from. Mirrors the subset of
// ShortcutTreeItem constructor parameters this phase actually reads. `metricText` is
// passed in rather than recomputed here so the hover's metric line always matches the
// row's (see shortcutRowDescription.ts, which computes it once).
export interface ShortcutTooltipInput {
  readonly shortcut: Shortcut;
  readonly masked: boolean;
  readonly isFile: boolean;
  readonly resolvedUri: vscode.Uri | undefined;
  readonly isRunning: boolean;
  readonly isStopping: boolean;
  readonly missing: boolean;
  readonly lockedBy: string | undefined;
  readonly lastRun: RunResult | undefined;
  readonly sweepBadge: ShortcutBadge | undefined;
  readonly runCount: number;
  readonly metricBadge: MetricBadge | undefined;
  readonly metricText: string | undefined;
  readonly untapped: boolean;
}

// Assemble the ordered hover lines for a shortcut tree row: the target/action, live
// state, missing/lock/expiry/recipe notices, the last run's outcome, sweep and metric
// summaries, and the click-gesture footer.
export function buildShortcutTooltipLines(input: ShortcutTooltipInput): string[] {
  const {
    shortcut,
    masked,
    isFile,
    resolvedUri,
    isRunning,
    isStopping,
    missing,
    lockedBy,
    lastRun,
    sweepBadge,
    runCount,
    metricBadge,
    metricText,
    untapped,
  } = input;

  // The next-scheduled-run instant, recomputed here (identically to the row's badge)
  // so the hover's "next run" line does not require threading the value through both
  // builders.
  const next = shortcut.schedule
    ? nextOccurrence(shortcut.schedule, Date.now())
    : undefined;
  const nextLabel = next !== undefined ? formatNextRun(next) : undefined;

  // Tooltip shows the full target (the complete URL for a url shortcut), even though
  // the row only shows the host — the hover is where the detail belongs. A masked
  // shortcut replaces the target line with a generic notice: the hover is a passive
  // surface that can sit on a shared screen, so it must never carry the real path.
  // The real name is named only at the deliberate reveal confirm (see openShortcut).
  const targetLine = masked
    ? l10n("mask.tooltip")
    : isFile
      ? resolvedUri
        ? resolvedUri.fsPath
        : shortcut.path
      : shortcut.action?.kind === "url"
        ? shortcut.action.url ?? ""
        : actionSummary(shortcut);
  // A recipe's description (what it does + what it was detected from) leads the
  // hover so the catalog prose is one mouse-over away, with the concrete target
  // on the next line. Stored/file shortcuts have no description and start at target.
  // A masked shortcut shows only the generic notice (its description, if any, could
  // leak).
  const tooltipLines =
    shortcut.description && !masked
      ? [shortcut.description, targetLine]
      : [targetLine];
  if (isStopping) {
    tooltipLines.push(l10n("run.stoppingTooltip"));
  } else if (isRunning) {
    tooltipLines.push(l10n("run.runningTooltip"));
  } else if (shortcut.paused) {
    tooltipLines.push(l10n("pause.tooltip"));
  } else if (nextLabel) {
    tooltipLines.push(l10n("schedule.nextRun", { time: nextLabel }));
  }
  // A deleted/moved target is the most actionable fact about the row; surface it
  // in the hover even when a schedule or last-run line would otherwise show.
  if (isFile && missing && !isRunning && !isStopping) {
    tooltipLines.push(l10n("pin.missingTooltip"));
  }
  // Recipe shortcuts do not run on a single click (they would fire a heavy task);
  // tell the user a single click shows details and the play button runs it.
  if (shortcut.isRecipe && !isRunning && !isStopping) {
    tooltipLines.push(l10n("recipe.clickHint"));
  }
  // A locked shortcut names the prerequisite it is waiting on, so the hover explains
  // why running it is blocked and what to run first.
  if (lockedBy && !isRunning && !isStopping) {
    tooltipLines.push(l10n("depends.lockedTooltip", { dep: lockedBy }));
  }
  // A time-bombed shortcut (WOW #9) explains its pending self-removal in the hover:
  // the exact instant for a wall-clock bomb, the branch for a branch bomb. Both
  // lines show when both conditions are set (either one removes the shortcut).
  if (shortcut.expires && !isRunning && !isStopping) {
    if (shortcut.expires.at !== undefined) {
      tooltipLines.push(
        l10n("expiry.tooltip.at", {
          when: formatExpiryInstant(shortcut.expires.at),
        })
      );
    }
    if (shortcut.expires.onBranchAway !== undefined) {
      tooltipLines.push(
        l10n("expiry.tooltip.branch", {
          branch: shortcut.expires.onBranchAway,
        })
      );
    }
  }
  // Always surface the last run in the tooltip, even when a schedule badge is
  // showing, so the most recent outcome is one hover away. A failure points at
  // the output channel (Show Output in the shortcut's context menu).
  if (lastRun) {
    tooltipLines.push(formatRunTooltip(lastRun));
  }
  // The last sweep's full breakdown in words (the row shows only compact glyphs),
  // so the hover answers "what did the lint sweep / test run actually find".
  if (sweepBadge && !isRunning && !isStopping) {
    const diagLine = formatDiagTooltip(sweepBadge);
    if (diagLine) {
      tooltipLines.push(diagLine);
    }
    const testLine = formatTestTooltip(sweepBadge);
    if (testLine) {
      tooltipLines.push(testLine);
    }
  }
  // Lifetime run total, so the hover answers "how much does this shortcut earn its
  // place?" beyond the single most-recent outcome above. Shown only once it has
  // run at least once (a zero count is noise, and is also what a disabled-
  // telemetry shortcut reports).
  if (runCount > 0) {
    tooltipLines.push(l10n("run.countTooltip", { count: runCount }));
  }
  // Name the shortcut's mode tags in the hover (WOW #17), so the full set is one
  // mouse-over away even when the row truncates the chips.
  if (shortcut.tags && shortcut.tags.length > 0) {
    tooltipLines.push(
      l10n("tag.tooltip", {
        tags: shortcut.tags.map((t) => `#${t}`).join(" "),
      })
    );
  }
  // Name the branch this shortcut is linked to (WOW #3), so the hover explains why it
  // shows on some branches and not others.
  if (shortcut.branch !== undefined) {
    tooltipLines.push(l10n("branch.tooltip", { branch: shortcut.branch }));
  }
  // Name the live metric in the hover: the current value, and — when it is over a
  // size threshold — that fact in words, so the warning tint is explained.
  if (metricText) {
    tooltipLines.push(
      metricBadge?.over
        ? l10n("metric.overTooltip", { value: metricText })
        : l10n("metric.tooltip", { value: metricText })
    );
  }
  // Explain the untapped dot in words, so the hover answers "why is this row marked
  // and what clears it". Suppressed while running/stopping, where live state is what
  // the hover should lead with (and a running shortcut is already marked tapped).
  if (untapped && !isRunning && !isStopping) {
    tooltipLines.push(l10n("untapped.rowTooltip"));
  }
  // The single/double-click gesture model, stated as a hover footer so the
  // extension's core interaction is always one mouse-over away (UI plan, Phase 3).
  // Recipe shortcuts have their own click hint above (single click = details, play =
  // run), so the generic line would contradict them; a running/stopping shortcut is
  // mid-action and a gesture reminder there is noise.
  if (!shortcut.isRecipe && !isRunning && !isStopping) {
    tooltipLines.push(l10n("pin.gestureHint"));
  }
  return tooltipLines;
}
