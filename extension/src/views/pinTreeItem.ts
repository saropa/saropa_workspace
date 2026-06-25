import * as vscode from "vscode";
import { Pin } from "../model/pin";
import { nextOccurrence } from "../exec/schedule";
import { l10n } from "../i18n/l10n";

// Tree node for a single pin. Selecting it fires the activate dispatcher, which
// decides open (single click) vs run (double click within the configured window).
export class PinTreeItem extends vscode.TreeItem {
  constructor(readonly pin: Pin, resolvedUri: vscode.Uri | undefined) {
    const basename = pin.path.split("/").pop() ?? pin.path;
    super(pin.label ?? basename, vscode.TreeItemCollapsibleState.None);

    this.resourceUri = resolvedUri;

    // Surface the next scheduled run inline (description) and in the tooltip, so a
    // scheduled pin's queued time is visible without opening anything (2.2). An
    // enabled-but-untimed schedule, or a disabled one, shows no badge.
    const next = pin.schedule
      ? nextOccurrence(pin.schedule, Date.now())
      : undefined;
    const nextLabel = next !== undefined ? formatNextRun(next) : undefined;

    this.description = nextLabel
      ? `${l10n("schedule.treeBadge", { time: nextLabel })} · ${pin.path}`
      : pin.path;

    // contextValue gates the inline/run menus (when clause matches /^pin/).
    // Auto-pins get a distinct value so future menus can treat them differently.
    this.contextValue = pin.isAuto ? "pinAuto" : "pin";

    const targetLine = resolvedUri ? resolvedUri.fsPath : pin.path;
    this.tooltip = nextLabel
      ? `${targetLine}\n${l10n("schedule.nextRun", { time: nextLabel })}`
      : targetLine;

    // Auto-pins read as "suggested" with a hollow star; explicit pins use the pin
    // glyph. A missing target is flagged so the user knows the file moved.
    if (!resolvedUri) {
      this.iconPath = new vscode.ThemeIcon("warning");
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

// Group header node (Project Pins / Global Pins).
export class PinGroupItem extends vscode.TreeItem {
  constructor(label: string, readonly group: "project" | "global", count: number) {
    super(label, vscode.TreeItemCollapsibleState.Expanded);
    this.contextValue = "pinGroup";
    this.description = String(count);
    this.iconPath = new vscode.ThemeIcon(
      group === "global" ? "globe" : "folder"
    );
  }
}
