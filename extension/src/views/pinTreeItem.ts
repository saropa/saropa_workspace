import * as vscode from "vscode";
import { Pin, PinGroup, PinKind, PinScope, pinKind } from "../model/pin";
import { nextOccurrence } from "../exec/schedule";
import { RunResult, formatDuration } from "../exec/runStatus";
import { RunSource } from "../exec/telemetry";
import { formatRelativeTime } from "./projectFilesProvider";
import { l10n } from "../i18n/l10n";

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
    runCount = 0
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

    // Leading inline badge, by priority: a running pin's live state wins; then a
    // scheduled pin's queued next-run time (2.2); then the last completed run's
    // outcome and duration (7.2). Only one badge shows — the most actionable.
    const next = pin.schedule
      ? nextOccurrence(pin.schedule, Date.now())
      : undefined;
    const nextLabel = next !== undefined ? formatNextRun(next) : undefined;

    const lastRunBadge = lastRun ? formatRunBadge(lastRun) : undefined;
    const badge = isStopping
      ? l10n("run.stoppingBadge")
      : isRunning
        ? l10n("run.treeBadge")
        : nextLabel
          ? l10n("schedule.treeBadge", { time: nextLabel })
          : lastRunBadge;
    // For a file pin the trailing detail is its path; for a non-file pin it is a
    // summary of what the action does (the URL, the command line, etc.).
    const detail = isFile ? pin.path : actionSummary(pin);
    // A Recent entry leads with when it last ran (and a hint if it was a scheduled
    // fire), since "how recently" is the reason it is in this group; otherwise the
    // leading slot is the most-actionable badge (running / next-run / last-run).
    if (recentInfo) {
      const when = formatRelativeTime(recentInfo.at, Date.now());
      const tag =
        recentInfo.source === "scheduled" ? ` ${l10n("recent.scheduledTag")}` : "";
      this.description = `${when}${tag} · ${detail}`;
    } else {
      this.description = badge ? `${badge} · ${detail}` : detail;
    }

    // contextValue gates the menus. A running pin uses "pinRunning" so the Stop
    // action shows; recipe pins use "pinRecipe" (Promote / sticky Unpin, but no
    // Configure Run/Schedule which only apply to stored pins); auto-pins are
    // distinguished from explicit pins. All start with "pin" so the /^pin/
    // run/open/unpin clauses match.
    this.contextValue = isStopping
      ? "pinStopping"
      : isRunning
        ? "pinRunning"
        : pin.isRecipe
          ? "pinRecipe"
          : pin.isAuto
            ? "pinAuto"
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
    // Always surface the last run in the tooltip, even when a schedule badge is
    // showing, so the most recent outcome is one hover away. A failure points at
    // the output channel (Show Output in the pin's context menu).
    if (lastRun) {
      tooltipLines.push(formatRunTooltip(lastRun));
    }
    // Lifetime run total, so the hover answers "how much does this pin earn its
    // place?" beyond the single most-recent outcome above. Shown only once it has
    // run at least once (a zero count is noise, and is also what a disabled-
    // telemetry pin reports).
    if (runCount > 0) {
      tooltipLines.push(l10n("run.countTooltip", { count: runCount }));
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
