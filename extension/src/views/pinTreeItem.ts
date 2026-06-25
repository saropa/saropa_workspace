import * as vscode from "vscode";
import { Pin, PinGroup, PinKind, PinScope, pinKind } from "../model/pin";
import { nextOccurrence } from "../exec/schedule";
import { RunResult, formatDuration } from "../exec/runStatus";
import { l10n } from "../i18n/l10n";

// Tree node for a single pin. Selecting it fires the activate dispatcher, which
// decides open (single click) vs run (double click within the configured window).
export class PinTreeItem extends vscode.TreeItem {
  constructor(
    readonly pin: Pin,
    resolvedUri: vscode.Uri | undefined,
    isRunning: boolean,
    lastRun?: RunResult
  ) {
    const kind = pinKind(pin);
    const isFile = kind === "file";
    const basename = pin.path.split("/").pop() ?? pin.path;
    super(pin.label ?? basename, vscode.TreeItemCollapsibleState.None);

    // Stable id (scope-qualified) so TreeView.reveal can match this node across
    // the tree being rebuilt — the status-bar "next scheduled run" reveals a pin
    // by constructing a fresh item with the same id.
    this.id = `pin:${pin.scope}:${pin.id}`;
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
    const badge = isRunning
      ? l10n("run.treeBadge")
      : nextLabel
        ? l10n("schedule.treeBadge", { time: nextLabel })
        : lastRunBadge;
    // For a file pin the trailing detail is its path; for a non-file pin it is a
    // summary of what the action does (the URL, the command line, etc.).
    const detail = isFile ? pin.path : actionSummary(pin);
    this.description = badge ? `${badge} · ${detail}` : detail;

    // contextValue gates the menus. A running pin uses "pinRunning" so the Stop
    // action shows; recipe pins use "pinRecipe" (Promote / sticky Unpin, but no
    // Configure Run/Schedule which only apply to stored pins); auto-pins are
    // distinguished from explicit pins. All start with "pin" so the /^pin/
    // run/open/unpin clauses match.
    this.contextValue = isRunning
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
    const tooltipLines = [targetLine];
    if (isRunning) {
      tooltipLines.push(l10n("run.runningTooltip"));
    } else if (nextLabel) {
      tooltipLines.push(l10n("schedule.nextRun", { time: nextLabel }));
    }
    // Always surface the last run in the tooltip, even when a schedule badge is
    // showing, so the most recent outcome is one hover away. A failure points at
    // the output channel (Show Output in the pin's context menu).
    if (lastRun) {
      tooltipLines.push(formatRunTooltip(lastRun));
    }
    this.tooltip = tooltipLines.join("\n");

    // Icon priority mirrors the badge: spinning while running; a missing target
    // is flagged; then the last-run outcome (green pass / red error); then auto
    // vs explicit pin glyph.
    if (isRunning) {
      this.iconPath = new vscode.ThemeIcon("loading~spin");
    } else if (isFile && !resolvedUri) {
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
    this.iconPath = new vscode.ThemeIcon("folder");
  }
}
