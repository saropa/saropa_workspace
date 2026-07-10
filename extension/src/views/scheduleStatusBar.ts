import * as vscode from "vscode";
import { Shortcut } from "../model/shortcut";
import { ShortcutStore } from "../model/shortcutStore";
import { nextOccurrence } from "../exec/schedule";
import { l10n } from "../i18n/l10n";

// Roadmap 4.3 — a status-bar item showing the soonest upcoming scheduled run
// (shortcut name + time). Clicking it reveals that shortcut in the tree. Hidden
// when no shortcut has an enabled schedule, so it adds no empty noise. Reinforces
// the "no silent execution" principle by always showing what is queued.

// The setting that suppresses this indicator entirely. Named once here because both
// the item (which reads it) and its action menu (which writes it, from the "Hide"
// entry) need the exact key, and a second spelling of it would silently un-hide.
export const SCHEDULE_STATUS_BAR_SETTING = "showScheduleStatusBar";

export class ScheduleStatusBar {
  private readonly item: vscode.StatusBarItem;
  // The shortcut the item currently points at, plus when it next runs, so the reveal
  // and action-menu commands know their target without recomputing.
  private currentShortcutId: string | undefined;
  private currentNextRunAt: number | undefined;
  private readonly timer: NodeJS.Timeout;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly store: ShortcutStore) {
    this.item = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100
    );
    // Without a name, VS Code labels this entry with the extension's display name in
    // its own right-click "Hide" menu — indistinguishable from the extension's other
    // status-bar item, so a user could not tell which one they were hiding.
    this.item.name = l10n("statusBar.name");
    this.item.command = "saropaWorkspace.scheduleStatusBarActions";

    // Recompute when shortcuts/schedules change (a fire updates lastRun -> store
    // change), and on a slow tick so the soonest run rolls forward past a fire
    // even without a store change.
    this.disposables.push(store.onDidChange(() => this.recompute()));
    // The visibility setting is read on every recompute, so a change to it must
    // trigger one — otherwise "Hide" would not take effect until the next minute tick.
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration(`saropaWorkspace.${SCHEDULE_STATUS_BAR_SETTING}`)) {
          this.recompute();
        }
      })
    );
    this.timer = setInterval(() => this.recompute(), 60_000);
    this.recompute();
  }

  // The shortcut the status bar currently advertises, for the reveal command.
  getCurrentShortcutId(): string | undefined {
    return this.currentShortcutId;
  }

  // When that shortcut next runs, so the action menu titles itself identically to the
  // item the user just clicked rather than recomputing a second, drifting answer.
  getCurrentNextRunAt(): number | undefined {
    return this.currentNextRunAt;
  }

  private recompute(): void {
    // Hidden by setting: still track nothing, so a later un-hide recomputes cleanly.
    const visible = vscode.workspace
      .getConfiguration("saropaWorkspace")
      .get<boolean>(SCHEDULE_STATUS_BAR_SETTING, true);
    if (!visible) {
      this.currentShortcutId = undefined;
      this.currentNextRunAt = undefined;
      this.item.hide();
      return;
    }

    const now = Date.now();
    let soonest: { shortcut: Shortcut; at: number } | undefined;
    for (const shortcut of [...this.store.getProjectShortcuts(), ...this.store.getGlobalShortcuts()]) {
      if (!shortcut.schedule?.enabled) {
        continue;
      }
      const at = nextOccurrence(shortcut.schedule, now);
      if (at === undefined) {
        continue;
      }
      if (!soonest || at < soonest.at) {
        soonest = { shortcut, at };
      }
    }

    if (!soonest) {
      this.currentShortcutId = undefined;
      this.currentNextRunAt = undefined;
      this.item.hide();
      return;
    }

    const name = soonest.shortcut.label ?? (soonest.shortcut.path.split("/").pop() ?? soonest.shortcut.path);
    const time = formatWhen(soonest.at);
    this.currentShortcutId = soonest.shortcut.id;
    this.currentNextRunAt = soonest.at;
    this.item.text = l10n("statusBar.next", { name, time });
    this.item.tooltip = l10n("statusBar.tooltip", { name, time });
    this.item.show();
  }

  dispose(): void {
    clearInterval(this.timer);
    for (const d of this.disposables) {
      d.dispose();
    }
    this.item.dispose();
  }
}

// Time-of-day when the run is today, otherwise a short date plus time. Locale
// formatting is delegated to the OS so the clock matches regional settings. Exported
// so the Schedule screen formats "next run" identically to the status bar.
export function formatWhen(ts: number): string {
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
