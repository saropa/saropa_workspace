import * as vscode from "vscode";
import { Shortcut, shortcutKind, isAnnotationShortcut } from "../model/shortcut";
import { nextOccurrence } from "../exec/schedule";
import { RunResult } from "../exec/runStatus";
import { ShortcutBadge, formatBadgeLead } from "../exec/shortcutBadges";
import { MetricBadge } from "../exec/metricBadges";
import { RunSource } from "../exec/telemetry";
import { formatRelativeTime } from "./projectFilesProvider";
import { resolveShortcutRowIcon } from "./shortcutRowTokens";
import {
  formatNextRun,
  formatRunBadge,
  expirySummary,
  actionSummary,
  formatExpiryInstant,
  formatRunTooltip,
  formatDiagTooltip,
  formatTestTooltip,
  recentTag,
} from "./shortcutRowFormatting";
import { l10n } from "../i18n/l10n";

// The structural tree rows (Recent root, scope roots, group folders) live in
// pinTreeItems; re-exported here so the tree providers keep importing every tree
// node from one place.
export {
  RecentRootItem,
  ShortcutGroupItem,
  ShortcutFolderItem,
} from "./shortcutTreeItems";

// The divider glyph for a "separator" annotation row. A run of box-drawing dashes
// reads as a horizontal rule in the narrow sidebar (it truncates cleanly to the
// view width). Fixed here as the single source for the separator's appearance.
const SEPARATOR_LABEL = "─".repeat(40);

// Tree node for a single shortcut. Selecting it fires the activate dispatcher, which
// decides open (single click) vs run (double click within the configured window).
//
// `recentInfo` renders the shortcut as an entry of the Recent group (local telemetry):
// it gives the node a distinct id namespace (so the same shortcut can appear both in
// its home scope and under Recent without an id collision) and shows when it last
// ran or was opened (tagged by kind) instead of the schedule/last-run badge.
export class ShortcutTreeItem extends vscode.TreeItem {
  // True when this node is a Recent-group entry; excluded from drag/drop so a
  // recent listing is read-only (the underlying shortcut is reordered from its home).
  readonly isRecent: boolean;

  constructor(
    readonly shortcut: Shortcut,
    resolvedUri: vscode.Uri | undefined,
    isRunning: boolean,
    lastRun?: RunResult,
    isStopping = false,
    recentInfo?: { at: number; source: RunSource; kind?: "run" | "opened" },
    // True when this file shortcut's target no longer exists on disk (computed by the
    // store's stat pass). Drives the warning glyph + "file not found" hover; the
    // open/run handlers re-stat at click time before acting on it.
    missing = false,
    // Lifetime run count for this shortcut (local telemetry, roadmap 3.3). Surfaced as
    // a tooltip line when greater than zero; the provider passes 0 when telemetry is
    // disabled so a turned-off user sees nothing. Reuses the count the telemetry
    // store already keeps — no separate collection path.
    runCount = 0,
    // When set, the display name of the prerequisite shortcut that has not yet
    // succeeded this session, so this shortcut is locked (WOW #13). Drives a lock
    // glyph, a "waiting on" badge, and a tooltip line. Undefined when the shortcut is
    // cleared to run.
    lockedBy?: string,
    // Lint severity counts / test tally from this shortcut's last sweep (#26, #32).
    // When present, a compact glyph lead ("3✖ 5⚠", "12✓ 1✗") prefixes the row and a
    // fuller line joins the hover. Undefined when the shortcut has produced no
    // parseable sweep.
    sweepBadge?: ShortcutBadge,
    // Live metric for a file shortcut (#24): size / line count / last-modified,
    // measured by the metric engine. Appended to the row as an inline value ("245 KB");
    // when `over` a size threshold, the icon is tinted as a warning. Undefined when the
    // shortcut carries no metric. Appended last (a narrow, well-named param) rather than
    // threaded through an options refactor, matching how sweepBadge above was added.
    metricBadge?: MetricBadge
  ) {
    const kind = shortcutKind(shortcut);
    const isFile = kind === "file";
    const basename = shortcut.path.split("/").pop() ?? shortcut.path;
    // Masked / vault shortcut (WOW #26): the row must reveal nothing about the target,
    // so it shows a generic localized label (never the filename/alias) and, below,
    // hides the path from the detail/hover and shows a lock glyph. Computed before
    // super() because the displayed label is the super() argument.
    const masked = shortcut.masked === true;
    const displayLabel = masked
      ? l10n("mask.label")
      : shortcut.label ?? basename;
    super(displayLabel, vscode.TreeItemCollapsibleState.None);

    // Stable id (scope-qualified) so TreeView.reveal can match this node across
    // the tree being rebuilt — the status-bar "next scheduled run" reveals a shortcut
    // by constructing a fresh item with the same id.
    this.isRecent = recentInfo !== undefined;
    // A Recent entry uses a distinct id namespace so it never collides with the
    // same shortcut shown in its home scope (VS Code requires unique tree-item ids).
    this.id = this.isRecent
      ? `recent:${shortcut.scope}:${shortcut.id}`
      : `shortcut:${shortcut.scope}:${shortcut.id}`;
    // resourceUri drives the file-type icon/decorations; only meaningful for file
    // shortcuts. Non-file shortcuts (url/shell/command/macro) render from their own
    // glyph. A masked shortcut sets none: the file-type icon (and the decoration VS
    // Code derives from the path) would leak the target's extension/identity, the
    // opposite of the mask. Its lock glyph comes from resolveShortcutRowIcon instead.
    this.resourceUri = isFile && !masked ? resolvedUri : undefined;

    // Comment / separator: an inert annotation row. It has no command (a click does
    // nothing), no resourceUri, no badges — it only labels or divides the list.
    // Returning here keeps every run/badge/icon path below from treating it as a
    // real shortcut; combined with the absent `command`, that makes the row unreachable
    // by the click dispatcher (the model's discriminated-union guard in practice).
    if (isAnnotationShortcut(shortcut)) {
      this.resourceUri = undefined;
      if (kind === "separator") {
        // VS Code tree rows have no native divider, so a run of box-drawing
        // characters reads as a horizontal rule between groups of shortcuts. No icon:
        // the line itself is the whole visual, and a glyph would break it up.
        this.label = SEPARATOR_LABEL;
        this.tooltip = l10n("annotation.separatorTooltip");
        this.contextValue = "annotationSeparator";
        this.iconPath = undefined;
      } else {
        // Comment: the text is the label, marked by a muted comment glyph so it
        // reads as a note rather than a runnable shortcut. Empty text falls back to a
        // placeholder so the row stays selectable (and renamable).
        const text = shortcut.label?.trim();
        this.label =
          text && text.length > 0 ? text : l10n("annotation.commentEmpty");
        this.tooltip = this.label;
        this.contextValue = "annotationComment";
        this.iconPath = new vscode.ThemeIcon(
          "comment",
          new vscode.ThemeColor("descriptionForeground")
        );
      }
      // Deliberately NO this.command: an annotation is inert, so a click neither
      // opens nor runs. Returning leaves it a plain leaf node.
      return;
    }

    // Leading inline badge, by priority: a running shortcut's live state wins; then a
    // scheduled shortcut's queued next-run time (2.2); then the last completed run's
    // outcome and duration (7.2). Only one badge shows — the most actionable.
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
    const badge = isStopping
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
    // For a file shortcut the trailing detail is its path; for a non-file shortcut it
    // is a summary of what the action does (the URL, the command line, etc.). A masked
    // shortcut contributes none — the path is exactly what must stay hidden — so the
    // join below drops it (the falsy filter) and the row carries only state badges.
    const detail = masked
      ? undefined
      : isFile
        ? shortcut.path
        : actionSummary(shortcut);
    // A Recent entry leads with when it last ran (and a hint if it was a scheduled
    // fire), since "how recently" is the reason it is in this group; otherwise the
    // leading slot is the most-actionable badge (running / next-run / last-run).
    // A resting shortcut's last-sweep counts lead the row (the most informative resting
    // fact for a lint / test shortcut), then the state badge, then the path/action
    // detail. Suppressed while running/stopping, where the live state is what matters.
    const badgeLead =
      sweepBadge && !isRunning && !isStopping
        ? formatBadgeLead(sweepBadge)
        : undefined;
    // The live metric value (#24), shared by the row and the hover. Size / line text
    // is precomputed by the engine; "modified" is formatted relative here so it stays
    // current between repaints (the engine cannot re-fire just because wall-clock
    // advanced). Hoisted above the recent/normal split so the tooltip can reuse it.
    // A masked shortcut shows no metric: a size/line-count value is a hint about the
    // target, and the point of masking is to leak nothing while resting.
    const metricText =
      metricBadge && !masked
        ? metricBadge.kind === "modified" && metricBadge.mtime !== undefined
          ? formatRelativeTime(metricBadge.mtime, Date.now())
          : metricBadge.text
        : undefined;
    if (recentInfo) {
      const when = formatRelativeTime(recentInfo.at, Date.now());
      // Tag a Recent entry as opened vs a scheduled fire (a plain manual run gets no
      // tag), via the shared formatter so the sidebar, dashboard, and report agree.
      const tagToken = recentTag(recentInfo);
      const tag = tagToken ? ` ${tagToken}` : "";
      // A masked shortcut's detail is hidden, so a Recent entry shows only when it ran,
      // never the path — `detail` is undefined under mask.
      this.description = detail ? `${when}${tag} · ${detail}` : `${when}${tag}`;
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
      this.description = [badgeLead, badge, expiryChip, detail, metricText]
        .filter((part) => part)
        .join(" · ");
    }

    // contextValue gates the menus. A running shortcut uses "shortcutRunning" so the
    // Stop action shows; recipe shortcuts use "shortcutRecipe" (Promote / sticky Remove,
    // but no Configure Run/Schedule which only apply to stored shortcuts); auto-added
    // shortcuts are distinguished from explicit shortcuts. All start with "shortcut" so
    // the /^shortcut/ run/open/remove clauses match. A resting shortcut that carries a
    // schedule gets a "Scheduled" suffix (shortcutScheduled / shortcutRecipeScheduled)
    // so its context menu shows "Run now" instead of "Run" — firing a scheduled job
    // ahead of its timer reads as intentional. The suffix preserves the /^shortcut/
    // prefix, so the generic run/open/remove/peek clauses still match; only the
    // exact-match clauses (Configure Run/Schedule/Appearance, Promote) are widened to
    // accept it.
    // A paused stored shortcut appends a "Paused" suffix (shortcutPaused /
    // shortcutScheduledPaused) so the context menu can swap "Pause" for "Unpause"; the
    // suffix preserves the /^shortcut/ prefix and the config clauses match it via
    // /^shortcut(Scheduled)?(Paused)?$/, so a paused shortcut keeps every edit/run
    // action. Only explicit shortcuts are pausable (auto/recipe shortcuts are
    // recomputed, not stored), so the suffix is applied to the stored-shortcut branch
    // alone.
    const scheduled = shortcut.schedule !== undefined;
    const pausedSuffix = shortcut.paused ? "Paused" : "";
    this.contextValue = isStopping
      ? "shortcutStopping"
      : isRunning
        ? "shortcutRunning"
        : shortcut.isRecipe
          ? scheduled
            ? "shortcutRecipeScheduled"
            : "shortcutRecipe"
          : shortcut.isAuto
            ? "shortcutAuto"
            : scheduled
              ? `shortcutScheduled${pausedSuffix}`
              : `shortcut${pausedSuffix}`;

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
    // The single/double-click gesture model, stated as a hover footer so the
    // extension's core interaction is always one mouse-over away (UI plan, Phase 3).
    // Recipe shortcuts have their own click hint above (single click = details, play =
    // run), so the generic line would contradict them; a running/stopping shortcut is
    // mid-action and a gesture reminder there is noise.
    if (!shortcut.isRecipe && !isRunning && !isStopping) {
      tooltipLines.push(l10n("pin.gestureHint"));
    }
    this.tooltip = tooltipLines.join("\n");

    // Row glyph + tint: the priority chain and every codicon/color token live in
    // the shared token map (UI plan, Phase 4), so the visual language is consistent
    // and learnable. The call site only states the inputs; the resolver owns which
    // state wins and what it looks like.
    this.iconPath = resolveShortcutRowIcon({
      isRunning,
      isStopping,
      isFile,
      hasResolvedUri: resolvedUri !== undefined,
      missing,
      locked: Boolean(lockedBy),
      masked,
      paused: Boolean(shortcut.paused),
      metricOver: Boolean(metricBadge?.over),
      lastRunOutcome: lastRun?.outcome,
      customIcon: shortcut.icon,
      customColor: shortcut.color,
      hasExpiry: Boolean(shortcut.expires),
      isAuto: Boolean(shortcut.isAuto),
      kind,
      fileName: isFile ? basename : undefined,
    });

    // Single command for click; the dispatcher reads timing to choose open/run.
    this.command = {
      command: "saropaWorkspace.activatePin",
      title: "Activate",
      arguments: [shortcut],
    };
  }
}
