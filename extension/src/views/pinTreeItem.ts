import * as vscode from "vscode";
import { Pin, PinGroup, PinKind, PinScope, pinKind, isAnnotationPin } from "../model/pin";
import { nextOccurrence } from "../exec/schedule";
import { RunResult, formatDuration } from "../exec/runStatus";
import { PinBadge, formatBadgeLead } from "../exec/pinBadges";
import { MetricBadge } from "../exec/metricBadges";
import { RunSource } from "../exec/telemetry";
import { formatRelativeTime } from "./projectFilesProvider";
import { l10n } from "../i18n/l10n";

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
    super(pin.label ?? basename, vscode.TreeItemCollapsibleState.None);

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
    // pins. Non-file pins (url/shell/command/macro) render from their own glyph.
    this.resourceUri = isFile ? resolvedUri : undefined;

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
    const badge = isStopping
      ? l10n("run.stoppingBadge")
      : isRunning
        ? l10n("run.treeBadge")
        : lockBadge
          ? lockBadge
          : nextLabel
            ? l10n("schedule.treeBadge", { time: nextLabel })
            : lastRunBadge;
    // For a file pin the trailing detail is its path; for a non-file pin it is a
    // summary of what the action does (the URL, the command line, etc.).
    const detail = isFile ? pin.path : actionSummary(pin);
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
    const metricText = metricBadge
      ? metricBadge.kind === "modified" && metricBadge.mtime !== undefined
        ? formatRelativeTime(metricBadge.mtime, Date.now())
        : metricBadge.text
      : undefined;
    // The pin's mode tags as compact "#ops #dev" chips (WOW #17), so the modes a
    // pin belongs to are visible on the row without opening the editor or the
    // hover. Undefined when untagged, so it adds nothing to an untagged row.
    const tagChip =
      pin.tags && pin.tags.length > 0
        ? pin.tags.map((t) => `#${t}`).join(" ")
        : undefined;
    if (recentInfo) {
      const when = formatRelativeTime(recentInfo.at, Date.now());
      const tag =
        recentInfo.source === "scheduled" ? ` ${l10n("recent.scheduledTag")}` : "";
      this.description = `${when}${tag} · ${detail}`;
    } else {
      // A time-bombed pin (WOW #9) shows a compact countdown / branch chip so the
      // row carries its pending self-removal at a glance; the full condition is in
      // the hover. Suppressed while running/stopping, where live state matters more.
      const expiryChip =
        !isRunning && !isStopping ? expirySummary(pin) : undefined;
      this.description = [badgeLead, badge, expiryChip, detail, metricText, tagChip]
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
    const scheduled = pin.schedule !== undefined;
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
              ? "pinScheduled"
              : "pin";

    // Tooltip shows the full target (the complete URL for a url pin), even though
    // the row only shows the host — the hover is where the detail belongs.
    const targetLine = isFile
      ? resolvedUri
        ? resolvedUri.fsPath
        : pin.path
      : pin.action?.kind === "url"
        ? pin.action.url ?? ""
        : actionSummary(pin);
    // A recipe's description (what it does + what it was detected from) leads the
    // hover so the catalog prose is one mouse-over away, with the concrete target
    // on the next line. Stored/file pins have no description and start at target.
    const tooltipLines = pin.description
      ? [pin.description, targetLine]
      : [targetLine];
    if (isStopping) {
      tooltipLines.push(l10n("run.stoppingTooltip"));
    } else if (isRunning) {
      tooltipLines.push(l10n("run.runningTooltip"));
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
    // Name the live metric in the hover: the current value, and — when it is over a
    // size threshold — that fact in words, so the warning tint is explained.
    if (metricText) {
      tooltipLines.push(
        metricBadge?.over
          ? l10n("metric.overTooltip", { value: metricText })
          : l10n("metric.tooltip", { value: metricText })
      );
    }
    this.tooltip = tooltipLines.join("\n");

    // Icon priority mirrors the badge: spinning while running; a missing target
    // is flagged; then the last-run outcome (green pass / red error); then auto
    // vs explicit pin glyph.
    if (isRunning || isStopping) {
      this.iconPath = new vscode.ThemeIcon("loading~spin");
    } else if (isFile && (!resolvedUri || missing)) {
      // Unresolvable folder OR a target deleted on disk: warn, and let this win
      // over any stale last-run badge below (a green check on a gone file misleads).
      this.iconPath = new vscode.ThemeIcon("warning");
    } else if (lockedBy) {
      // Locked on an unmet prerequisite: a lock glyph signals "not runnable yet",
      // winning over a stale last-run badge (a prior session's green check does not
      // mean the dependency is satisfied now).
      this.iconPath = new vscode.ThemeIcon("lock");
    } else if (metricBadge?.over) {
      // Over its size threshold (#24): tint the row as a warning so "this file is too
      // big" reads at a glance (the badge text carries the actual size). Keeps the
      // pin's own glyph when it has one, else a warning triangle; wins over a stale
      // last-run badge since being over budget is the actionable resting state.
      this.iconPath = new vscode.ThemeIcon(
        pin.icon ?? "warning",
        new vscode.ThemeColor("list.warningForeground")
      );
    } else if (lastRun) {
      this.iconPath =
        lastRun.outcome === "success"
          ? new vscode.ThemeIcon("pass", new vscode.ThemeColor("testing.iconPassed"))
          : new vscode.ThemeIcon("error", new vscode.ThemeColor("testing.iconFailed"));
    } else if (!isFile && !pin.icon) {
      // Default glyph per action kind for a non-file pin with no custom icon.
      this.iconPath = new vscode.ThemeIcon(kindIcon(kind));
    } else if (pin.icon) {
      // User-chosen icon/color for the resting state (5.1). Transient state icons
      // above (running / missing / last-run) deliberately win, since they convey
      // actionable state; the custom glyph replaces the default pin/star glyph.
      this.iconPath = new vscode.ThemeIcon(
        pin.icon,
        pin.color ? new vscode.ThemeColor(pin.color) : undefined
      );
    } else if (pin.expires) {
      // A time-bombed pin (WOW #9) wears a watch glyph in its resting state, so the
      // pending self-removal reads at a glance. Transient state icons (running /
      // missing / last-run / locked) and a user-chosen custom icon all win above;
      // this fills the otherwise-idle slot for a default-glyph pin.
      this.iconPath = new vscode.ThemeIcon(
        "watch",
        new vscode.ThemeColor("charts.yellow")
      );
    } else if (pin.isAuto) {
      this.iconPath = new vscode.ThemeIcon("star-empty");
    } else {
      this.iconPath = new vscode.ThemeIcon("pin");
    }

    // Single command for click; the dispatcher reads timing to choose open/run.
    this.command = {
      command: "saropaWorkspace.activatePin",
      title: "Activate",
      arguments: [pin],
    };
  }
}

// Compact label for the next-run instant: time-of-day when it is today,
// otherwise a short date plus time. Locale formatting is delegated to the OS so
// the rendered clock matches the user's regional settings.
function formatNextRun(ts: number): string {
  const next = new Date(ts);
  const now = new Date();
  const sameDay =
    next.getFullYear() === now.getFullYear() &&
    next.getMonth() === now.getMonth() &&
    next.getDate() === now.getDate();
  const time = next.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
  if (sameDay) {
    return time;
  }
  const date = next.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
  return `${date} ${time}`;
}

// Compact expiry chip for a time-bombed pin's row (WOW #9): a wall-clock bomb shows
// the time remaining ("2h left"), a branch bomb shows the branch it is tied to. When
// both are set the countdown wins — it is the more concrete, time-sensitive fact.
// The relative time is static per repaint (a TreeView row cannot tick live); it
// re-renders on the next paint, which the expiry sweep and any store change trigger.
function expirySummary(pin: Pin): string | undefined {
  if (!pin.expires) {
    return undefined;
  }
  if (pin.expires.at !== undefined) {
    return formatTimeLeft(pin.expires.at, Date.now());
  }
  if (pin.expires.onBranchAway !== undefined) {
    return l10n("expiry.chip.branch", { branch: pin.expires.onBranchAway });
  }
  return undefined;
}

// Time remaining until an expiry instant, in the coarsest useful unit. A past/now
// instant reads "due" (the next sweep removes it). Minutes under an hour, hours
// under a day, otherwise whole days.
function formatTimeLeft(at: number, now: number): string {
  const diffMs = at - now;
  if (diffMs <= 0) {
    return l10n("expiry.left.due");
  }
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 60) {
    return l10n("expiry.left.minutes", { count: Math.max(1, minutes) });
  }
  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return l10n("expiry.left.hours", { count: hours });
  }
  return l10n("expiry.left.days", { count: Math.round(hours / 24) });
}

// The full expiry instant for the hover, in the user's locale.
function formatExpiryInstant(at: number): string {
  return new Date(at).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Compact inline badge for the last completed run: "ok 2.3s" on success, or
// "exit 1 2.3s" on failure (a signal-killed run has no code and reads "exit ?").
function formatRunBadge(result: RunResult): string {
  const duration = formatDuration(result.durationMs);
  if (result.outcome === "success") {
    return l10n("run.statusOk", { duration });
  }
  const code = result.exitCode === null ? "?" : String(result.exitCode);
  return l10n("run.statusFailed", { code, duration });
}

// Fuller last-run line for the tooltip, including the wall-clock time it ended.
function formatRunTooltip(result: RunResult): string {
  const duration = formatDuration(result.durationMs);
  const time = new Date(result.endedAt).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
  if (result.outcome === "success") {
    return l10n("run.tooltipOk", { duration, time });
  }
  const code = result.exitCode === null ? "?" : String(result.exitCode);
  return l10n("run.tooltipFailed", { code, duration, time });
}

// Full diagnostic breakdown line for the hover, or undefined when the badge carries
// no diagnostic half. A clean sweep reads as "no issues".
function formatDiagTooltip(badge: PinBadge): string | undefined {
  const hasDiag =
    badge.errors !== undefined ||
    badge.warnings !== undefined ||
    badge.infos !== undefined;
  if (!hasDiag) {
    return undefined;
  }
  return l10n("badge.diagTooltip", {
    errors: badge.errors ?? 0,
    warnings: badge.warnings ?? 0,
    infos: badge.infos ?? 0,
  });
}

// Full test-tally line for the hover, or undefined when the badge carries no test
// half.
function formatTestTooltip(badge: PinBadge): string | undefined {
  if (badge.testsPassed === undefined && badge.testsFailed === undefined) {
    return undefined;
  }
  return l10n("badge.testTooltip", {
    passed: badge.testsPassed ?? 0,
    failed: badge.testsFailed ?? 0,
  });
}

// One-line summary of a non-file pin's action, shown as the tree row's detail.
function actionSummary(pin: Pin): string {
  const action = pin.action;
  if (!action) {
    return pin.path;
  }
  switch (action.kind) {
    case "url":
      // Full URLs are unreadable in the narrow sidebar row; show just the host
      // (e.g. "github.com"). The full URL stays in the hover tooltip.
      return urlHost(action.url);
    case "shell":
      return action.shellCommand ?? "";
    case "command":
      return action.commandId ?? "";
    case "macro":
      return l10n("action.macroSteps", { count: action.steps?.length ?? 0 });
    case "routine":
      return l10n("action.routineMembers", { count: action.members?.length ?? 0 });
    default:
      return pin.path;
  }
}

// The host of a URL ("github.com") for the compact sidebar row. Falls back to the
// raw string when it does not parse as a URL, so nothing is lost on a bad value.
function urlHost(url: string | undefined): string {
  if (!url) {
    return "";
  }
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

// Default codicon for a non-file action kind when the pin has no custom icon.
function kindIcon(kind: PinKind): string {
  switch (kind) {
    case "url":
      return "link-external";
    case "shell":
      return "terminal";
    case "command":
      return "symbol-event";
    case "macro":
      return "list-ordered";
    case "routine":
      // A routine runs a block of recipes back-to-back, so it reads as "run all"
      // rather than a single task.
      return "run-all";
    default:
      return "pin";
  }
}

// Top-level "Recent" root listing the last-called pins across both scopes (local
// telemetry, roadmap 3.3). Sits above the scope roots for quick re-run access; its
// children are PinTreeItems built with recentInfo. Shown only when there is recent
// history and telemetry is enabled (the provider gates it).
export class RecentRootItem extends vscode.TreeItem {
  constructor(count: number, expanded: boolean) {
    super(
      l10n("recent.group"),
      expanded
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.Collapsed
    );
    this.id = "scope:recent";
    // "recentRoot", deliberately NOT "pin*"/"scopeRoot": it must not pick up the
    // per-pin menus or the "New Group" action. Its own "Reset Run History" action
    // keys off this value.
    this.contextValue = "recentRoot";
    this.description = String(count);
    this.iconPath = new vscode.ThemeIcon("history");
  }
}

// Scope root node (Project Pins / Global Pins). The two fixed top-level groups.
export class PinGroupItem extends vscode.TreeItem {
  constructor(label: string, readonly group: PinScope, count: number) {
    super(label, vscode.TreeItemCollapsibleState.Expanded);
    this.id = `scope:${group}`;
    // "scopeRoot", deliberately NOT prefixed "pin": the per-pin menus match
    // viewItem =~ /^pin/, so a "pin"-prefixed contextValue would leak the
    // Run/Unpin/Rename actions onto a header that has no single file to act on.
    // The "New Group" action keys off this value.
    this.contextValue = "scopeRoot";
    this.description = String(count);
    this.iconPath = new vscode.ThemeIcon(
      group === "global" ? "globe" : "root-folder"
    );
  }
}

// A user-defined group (folder) under a scope root. Holds pins as children and
// is itself a valid drag-and-drop target (drop a pin onto it to move it in).
export class PinFolderItem extends vscode.TreeItem {
  constructor(
    readonly pinGroup: PinGroup,
    readonly scope: PinScope,
    count: number
  ) {
    super(
      pinGroup.label,
      pinGroup.collapsed
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.Expanded
    );
    this.id = `group:${scope}:${pinGroup.id}`;
    // "userGroup" (not "pin*") so Rename/Delete-Group target it without leaking
    // the per-pin menus. The drop controller recognizes it by instance, not by
    // this string.
    this.contextValue = "userGroup";
    this.description = String(count);
    // A group may carry its own glyph + tint (the synthetic recipe category folders
    // do, so each reads distinctly in the nested tree); a plain user group keeps the
    // default gray folder.
    this.iconPath = new vscode.ThemeIcon(
      pinGroup.icon ?? "folder",
      pinGroup.color ? new vscode.ThemeColor(pinGroup.color) : undefined
    );
  }
}
