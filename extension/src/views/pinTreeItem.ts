import * as vscode from "vscode";
import { Pin, pinKind, isAnnotationPin } from "../model/pin";
import { nextOccurrence } from "../exec/schedule";
import { RunResult } from "../exec/runStatus";
import { PinBadge, formatBadgeLead } from "../exec/pinBadges";
import { MetricBadge } from "../exec/metricBadges";
import { RunSource } from "../exec/telemetry";
import { formatRelativeTime } from "./projectFilesProvider";
import { resolvePinRowIcon } from "./pinRowTokens";
import {
  formatNextRun,
  formatRunBadge,
  expirySummary,
  actionSummary,
  formatExpiryInstant,
  formatRunTooltip,
  formatDiagTooltip,
  formatTestTooltip,
} from "./pinRowFormatting";
import { l10n } from "../i18n/l10n";

// The structural tree rows (Recent root, scope roots, group folders) live in
// pinTreeItems; re-exported here so the tree providers keep importing every tree
// node from one place.
export {
  RecentRootItem,
  PinGroupItem,
  PinFolderItem,
} from "./pinTreeItems";

// The divider glyph for a "separator" annotation row. A run of box-drawing dashes
// reads as a horizontal rule in the narrow sidebar (it truncates cleanly to the
// view width). Fixed here as the single source for the separator's appearance.
const SEPARATOR_LABEL = "─".repeat(40);

// Tree node for a single pin. Selecting it fires the activate dispatcher, which
// decides open (single click) vs run (double click within the configured window).
//
// `recentInfo` renders the pin as an entry of the Recent group (local telemetry):
// it gives the node a distinct id namespace (so the same pin can appear both in
// its home scope and under Recent without an id collision) and shows when it last
// ran instead of the schedule/last-run badge.
export class PinTreeItem extends vscode.TreeItem {
  // True when this node is a Recent-group entry; excluded from drag/drop so a
  // recent listing is read-only (the underlying pin is reordered from its home).
  readonly isRecent: boolean;

  constructor(
    readonly pin: Pin,
    resolvedUri: vscode.Uri | undefined,
    isRunning: boolean,
    lastRun?: RunResult,
    isStopping = false,
    recentInfo?: { at: number; source: RunSource },
    // True when this file pin's target no longer exists on disk (computed by the
    // store's stat pass). Drives the warning glyph + "file not found" hover; the
    // open/run handlers re-stat at click time before acting on it.
    missing = false,
    // Lifetime run count for this pin (local telemetry, roadmap 3.3). Surfaced as a
    // tooltip line when greater than zero; the provider passes 0 when telemetry is
    // disabled so a turned-off user sees nothing. Reuses the count the telemetry
    // store already keeps — no separate collection path.
    runCount = 0,
    // When set, the display name of the prerequisite pin that has not yet succeeded
    // this session, so this pin is locked (WOW #13). Drives a lock glyph, a "waiting
    // on" badge, and a tooltip line. Undefined when the pin is cleared to run.
    lockedBy?: string,
    // Lint severity counts / test tally from this pin's last sweep (#26, #32). When
    // present, a compact glyph lead ("3✖ 5⚠", "12✓ 1✗") prefixes the row and a fuller
    // line joins the hover. Undefined when the pin has produced no parseable sweep.
    sweepBadge?: PinBadge,
    // Live metric for a file pin (#24): size / line count / last-modified, measured by
    // the metric engine. Appended to the row as an inline value ("245 KB"); when `over`
    // a size threshold, the icon is tinted as a warning. Undefined when the pin carries
    // no metric. Appended last (a narrow, well-named param) rather than threaded through
    // an options refactor, matching how sweepBadge above was added.
    metricBadge?: MetricBadge
  ) {
    const kind = pinKind(pin);
    const isFile = kind === "file";
    const basename = pin.path.split("/").pop() ?? pin.path;
    // Masked / vault pin (WOW #26): the row must reveal nothing about the target, so
    // it shows a generic localized label (never the filename/alias) and, below, hides
    // the path from the detail/hover and shows a lock glyph. Computed before super()
    // because the displayed label is the super() argument.
    const masked = pin.masked === true;
    const displayLabel = masked ? l10n("mask.label") : pin.label ?? basename;
    super(displayLabel, vscode.TreeItemCollapsibleState.None);

    // Stable id (scope-qualified) so TreeView.reveal can match this node across
    // the tree being rebuilt — the status-bar "next scheduled run" reveals a pin
    // by constructing a fresh item with the same id.
    this.isRecent = recentInfo !== undefined;
    // A Recent entry uses a distinct id namespace so it never collides with the
    // same pin shown in its home scope (VS Code requires unique tree-item ids).
    this.id = this.isRecent
      ? `recent:${pin.scope}:${pin.id}`
      : `pin:${pin.scope}:${pin.id}`;
    // resourceUri drives the file-type icon/decorations; only meaningful for file
    // pins. Non-file pins (url/shell/command/macro) render from their own glyph. A
    // masked pin sets none: the file-type icon (and the decoration VS Code derives
    // from the path) would leak the target's extension/identity, the opposite of the
    // mask. Its lock glyph comes from resolvePinRowIcon instead.
    this.resourceUri = isFile && !masked ? resolvedUri : undefined;

    // Comment / separator: an inert annotation row. It has no command (a click does
    // nothing), no resourceUri, no badges — it only labels or divides the list.
    // Returning here keeps every run/badge/icon path below from treating it as a
    // real pin; combined with the absent `command`, that makes the row unreachable
    // by the click dispatcher (the model's discriminated-union guard in practice).
    if (isAnnotationPin(pin)) {
      this.resourceUri = undefined;
      if (kind === "separator") {
        // VS Code tree rows have no native divider, so a run of box-drawing
        // characters reads as a horizontal rule between groups of pins. No icon:
        // the line itself is the whole visual, and a glyph would break it up.
        this.label = SEPARATOR_LABEL;
        this.tooltip = l10n("annotation.separatorTooltip");
        this.contextValue = "annotationSeparator";
        this.iconPath = undefined;
      } else {
        // Comment: the text is the label, marked by a muted comment glyph so it
        // reads as a note rather than a runnable pin. Empty text falls back to a
        // placeholder so the row stays selectable (and renamable).
        const text = pin.label?.trim();
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

    // Leading inline badge, by priority: a running pin's live state wins; then a
    // scheduled pin's queued next-run time (2.2); then the last completed run's
    // outcome and duration (7.2). Only one badge shows — the most actionable.
    const next = pin.schedule
      ? nextOccurrence(pin.schedule, Date.now())
      : undefined;
    const nextLabel = next !== undefined ? formatNextRun(next) : undefined;

    const lastRunBadge = lastRun ? formatRunBadge(lastRun) : undefined;
    // A locked pin's "waiting on <prerequisite>" badge wins over a schedule / last-run
    // badge while resting, since not-yet-runnable is the most actionable resting fact.
    const lockBadge =
      lockedBy && !isRunning && !isStopping
        ? l10n("depends.treeBadge", { dep: lockedBy })
        : undefined;
    // A paused pin shows a "paused" badge instead of its next-run time: the schedule
    // is kept but no timer is armed, so surfacing a next-run instant it will not honor
    // would mislead. Running / stopping / a lock still win — those are live, more
    // actionable states, and a paused pin can still be run manually.
    const badge = isStopping
      ? l10n("run.stoppingBadge")
      : isRunning
        ? l10n("run.treeBadge")
        : lockBadge
          ? lockBadge
          : pin.paused
            ? l10n("pause.treeBadge")
            : nextLabel
              ? l10n("schedule.treeBadge", { time: nextLabel })
              : lastRunBadge;
    // For a file pin the trailing detail is its path; for a non-file pin it is a
    // summary of what the action does (the URL, the command line, etc.). A masked
    // pin contributes none — the path is exactly what must stay hidden — so the join
    // below drops it (the falsy filter) and the row carries only state badges.
    const detail = masked ? undefined : isFile ? pin.path : actionSummary(pin);
    // A Recent entry leads with when it last ran (and a hint if it was a scheduled
    // fire), since "how recently" is the reason it is in this group; otherwise the
    // leading slot is the most-actionable badge (running / next-run / last-run).
    // A resting pin's last-sweep counts lead the row (the most informative resting
    // fact for a lint / test pin), then the state badge, then the path/action detail.
    // Suppressed while running/stopping, where the live state is what matters.
    const badgeLead =
      sweepBadge && !isRunning && !isStopping
        ? formatBadgeLead(sweepBadge)
        : undefined;
    // The live metric value (#24), shared by the row and the hover. Size / line text
    // is precomputed by the engine; "modified" is formatted relative here so it stays
    // current between repaints (the engine cannot re-fire just because wall-clock
    // advanced). Hoisted above the recent/normal split so the tooltip can reuse it.
    // A masked pin shows no metric: a size/line-count value is a hint about the
    // target, and the point of masking is to leak nothing while resting.
    const metricText =
      metricBadge && !masked
        ? metricBadge.kind === "modified" && metricBadge.mtime !== undefined
          ? formatRelativeTime(metricBadge.mtime, Date.now())
          : metricBadge.text
        : undefined;
    if (recentInfo) {
      const when = formatRelativeTime(recentInfo.at, Date.now());
      const tag =
        recentInfo.source === "scheduled" ? ` ${l10n("recent.scheduledTag")}` : "";
      // A masked pin's detail is hidden, so a Recent entry shows only when it ran,
      // never the path — `detail` is undefined under mask.
      this.description = detail ? `${when}${tag} · ${detail}` : `${when}${tag}`;
    } else {
      // A time-bombed pin (WOW #9) shows a compact countdown / branch chip so the
      // row carries its pending self-removal at a glance; the full condition is in
      // the hover. Suppressed while running/stopping, where live state matters more.
      const expiryChip =
        !isRunning && !isStopping ? expirySummary(pin) : undefined;
      // Row budget (UI plan, Phase 1): leading sweep counts, the one most-actionable
      // state badge, a single expiry chip, the identity detail, and the live metric
      // the user opted into per pin. The branch link and mode tags are deliberately
      // NOT joined onto the row — both already have a dedicated hover line below, and
      // crowding a narrow sidebar row with up to seven `·`-joined segments was the
      // main "hard to glance" offender. Holding the row to these few parts lets the
      // eye lock onto state and identity without parsing a long string.
      this.description = [badgeLead, badge, expiryChip, detail, metricText]
        .filter((part) => part)
        .join(" · ");
    }

    // contextValue gates the menus. A running pin uses "pinRunning" so the Stop
    // action shows; recipe pins use "pinRecipe" (Promote / sticky Unpin, but no
    // Configure Run/Schedule which only apply to stored pins); auto-pins are
    // distinguished from explicit pins. All start with "pin" so the /^pin/
    // run/open/unpin clauses match. A resting pin that carries a schedule gets a
    // "Scheduled" suffix (pinScheduled / pinRecipeScheduled) so its context menu
    // shows "Run now" instead of "Run" — firing a scheduled job ahead of its timer
    // reads as intentional. The suffix preserves the /^pin/ prefix, so the generic
    // run/open/unpin/peek clauses still match; only the exact-match clauses
    // (Configure Run/Schedule/Appearance, Promote) are widened to accept it.
    // A paused stored pin appends a "Paused" suffix (pinPaused / pinScheduledPaused)
    // so the context menu can swap "Pause" for "Unpause"; the suffix preserves the
    // /^pin/ prefix and the config clauses match it via /^pin(Scheduled)?(Paused)?$/,
    // so a paused pin keeps every edit/run action. Only explicit pins are pausable
    // (auto/recipe pins are recomputed, not stored), so the suffix is applied to the
    // stored-pin branch alone.
    const scheduled = pin.schedule !== undefined;
    const pausedSuffix = pin.paused ? "Paused" : "";
    this.contextValue = isStopping
      ? "pinStopping"
      : isRunning
        ? "pinRunning"
        : pin.isRecipe
          ? scheduled
            ? "pinRecipeScheduled"
            : "pinRecipe"
          : pin.isAuto
            ? "pinAuto"
            : scheduled
              ? `pinScheduled${pausedSuffix}`
              : `pin${pausedSuffix}`;

    // Tooltip shows the full target (the complete URL for a url pin), even though
    // the row only shows the host — the hover is where the detail belongs. A masked
    // pin replaces the target line with a generic notice: the hover is a passive
    // surface that can sit on a shared screen, so it must never carry the real path.
    // The real name is named only at the deliberate reveal confirm (see openPin).
    const targetLine = masked
      ? l10n("mask.tooltip")
      : isFile
        ? resolvedUri
          ? resolvedUri.fsPath
          : pin.path
        : pin.action?.kind === "url"
          ? pin.action.url ?? ""
          : actionSummary(pin);
    // A recipe's description (what it does + what it was detected from) leads the
    // hover so the catalog prose is one mouse-over away, with the concrete target
    // on the next line. Stored/file pins have no description and start at target. A
    // masked pin shows only the generic notice (its description, if any, could leak).
    const tooltipLines =
      pin.description && !masked ? [pin.description, targetLine] : [targetLine];
    if (isStopping) {
      tooltipLines.push(l10n("run.stoppingTooltip"));
    } else if (isRunning) {
      tooltipLines.push(l10n("run.runningTooltip"));
    } else if (pin.paused) {
      tooltipLines.push(l10n("pause.tooltip"));
    } else if (nextLabel) {
      tooltipLines.push(l10n("schedule.nextRun", { time: nextLabel }));
    }
    // A deleted/moved target is the most actionable fact about the row; surface it
    // in the hover even when a schedule or last-run line would otherwise show.
    if (isFile && missing && !isRunning && !isStopping) {
      tooltipLines.push(l10n("pin.missingTooltip"));
    }
    // Recipe pins do not run on a single click (they would fire a heavy task);
    // tell the user a single click shows details and the play button runs it.
    if (pin.isRecipe && !isRunning && !isStopping) {
      tooltipLines.push(l10n("recipe.clickHint"));
    }
    // A locked pin names the prerequisite it is waiting on, so the hover explains
    // why running it is blocked and what to run first.
    if (lockedBy && !isRunning && !isStopping) {
      tooltipLines.push(l10n("depends.lockedTooltip", { dep: lockedBy }));
    }
    // A time-bombed pin (WOW #9) explains its pending self-removal in the hover:
    // the exact instant for a wall-clock bomb, the branch for a branch bomb. Both
    // lines show when both conditions are set (either one removes the pin).
    if (pin.expires && !isRunning && !isStopping) {
      if (pin.expires.at !== undefined) {
        tooltipLines.push(
          l10n("expiry.tooltip.at", { when: formatExpiryInstant(pin.expires.at) })
        );
      }
      if (pin.expires.onBranchAway !== undefined) {
        tooltipLines.push(
          l10n("expiry.tooltip.branch", { branch: pin.expires.onBranchAway })
        );
      }
    }
    // Always surface the last run in the tooltip, even when a schedule badge is
    // showing, so the most recent outcome is one hover away. A failure points at
    // the output channel (Show Output in the pin's context menu).
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
    // Lifetime run total, so the hover answers "how much does this pin earn its
    // place?" beyond the single most-recent outcome above. Shown only once it has
    // run at least once (a zero count is noise, and is also what a disabled-
    // telemetry pin reports).
    if (runCount > 0) {
      tooltipLines.push(l10n("run.countTooltip", { count: runCount }));
    }
    // Name the pin's mode tags in the hover (WOW #17), so the full set is one
    // mouse-over away even when the row truncates the chips.
    if (pin.tags && pin.tags.length > 0) {
      tooltipLines.push(
        l10n("tag.tooltip", { tags: pin.tags.map((t) => `#${t}`).join(" ") })
      );
    }
    // Name the branch this pin is linked to (WOW #3), so the hover explains why it
    // shows on some branches and not others.
    if (pin.branch !== undefined) {
      tooltipLines.push(l10n("branch.tooltip", { branch: pin.branch }));
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
    // Recipe pins have their own click hint above (single click = details, play =
    // run), so the generic line would contradict them; a running/stopping pin is
    // mid-action and a gesture reminder there is noise.
    if (!pin.isRecipe && !isRunning && !isStopping) {
      tooltipLines.push(l10n("pin.gestureHint"));
    }
    this.tooltip = tooltipLines.join("\n");

    // Row glyph + tint: the priority chain and every codicon/color token live in
    // the shared token map (UI plan, Phase 4), so the visual language is consistent
    // and learnable. The call site only states the inputs; the resolver owns which
    // state wins and what it looks like.
    this.iconPath = resolvePinRowIcon({
      isRunning,
      isStopping,
      isFile,
      hasResolvedUri: resolvedUri !== undefined,
      missing,
      locked: Boolean(lockedBy),
      masked,
      paused: Boolean(pin.paused),
      metricOver: Boolean(metricBadge?.over),
      lastRunOutcome: lastRun?.outcome,
      customIcon: pin.icon,
      customColor: pin.color,
      hasExpiry: Boolean(pin.expires),
      isAuto: Boolean(pin.isAuto),
      kind,
    });

    // Single command for click; the dispatcher reads timing to choose open/run.
    this.command = {
      command: "saropaWorkspace.activatePin",
      title: "Activate",
      arguments: [pin],
    };
  }
}
