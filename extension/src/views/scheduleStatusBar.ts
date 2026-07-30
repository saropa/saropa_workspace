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

// The setting for the lead-time window (minutes). Named once here because both
// the status-bar item and the configuration listener need the exact key.
export const LEAD_MINUTES_SETTING = "scheduleStatusBarLeadMinutes";

// Fallback when the setting is absent or invalid.
export const DEFAULT_LEAD_MINUTES = 30;

// How long the "just ran" flash stays visible after a scheduled run completes.
export const JUST_RAN_WINDOW_MS = 2 * 60_000;

// Pure visibility decision, exported for unit testing without the VS Code host.
// For schedules that fire more frequently than the window (e.g. every 15 min),
// the indicator is correctly always visible — warranted when runs are that close.
export function shouldShowIndicator(nextRunAt: number, now: number, windowMs: number): boolean {
  return nextRunAt - now <= windowMs;
}

// Whether a shortcut just ran recently enough to flash the "just ran" indicator.
export function isJustRan(lastRun: number | undefined, now: number): boolean {
  return lastRun !== undefined && now - lastRun <= JUST_RAN_WINDOW_MS;
}

export class ScheduleStatusBar {
  private readonly item: vscode.StatusBarItem;
  // The shortcut the item currently points at, plus when it next runs, so the reveal
  // and action-menu commands know their target without recomputing.
  private currentShortcutId: string | undefined;
  private currentNextRunAt: number | undefined;
  private readonly timer: NodeJS.Timeout;
  // One-shot timer that clears the "just ran" flash after JUST_RAN_WINDOW_MS.
  private justRanTimer: NodeJS.Timeout | undefined;
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
        if (
          e.affectsConfiguration(`saropaWorkspace.${SCHEDULE_STATUS_BAR_SETTING}`) ||
          e.affectsConfiguration(`saropaWorkspace.${LEAD_MINUTES_SETTING}`)
        ) {
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
    const config = vscode.workspace.getConfiguration("saropaWorkspace");
    if (!config.get<boolean>(SCHEDULE_STATUS_BAR_SETTING, true)) {
      this.currentShortcutId = undefined;
      this.currentNextRunAt = undefined;
      this.item.hide();
      return;
    }

    const leadMinutes = config.get<number>(LEAD_MINUTES_SETTING, DEFAULT_LEAD_MINUTES);
    const windowMs = Math.max(0, leadMinutes) * 60_000;
    const now = Date.now();

    // Check for a shortcut that just ran (within the flash window). The most
    // recently fired shortcut wins — show "ran at {time}" so the user can click
    // through to its report without hunting for it.
    let justRan: { shortcut: Shortcut; ranAt: number } | undefined;
    for (const shortcut of [...this.store.getProjectShortcuts(), ...this.store.getGlobalShortcuts()]) {
      if (!shortcut.schedule?.enabled) {
        continue;
      }
      if (isJustRan(shortcut.schedule.lastRun, now)) {
        if (!justRan || shortcut.schedule.lastRun! > justRan.ranAt) {
          justRan = { shortcut, ranAt: shortcut.schedule.lastRun! };
        }
      }
    }

    if (justRan) {
      const name = justRan.shortcut.label ?? (justRan.shortcut.path.split("/").pop() ?? justRan.shortcut.path);
      const time = formatWhen(justRan.ranAt);
      this.currentShortcutId = justRan.shortcut.id;
      this.currentNextRunAt = undefined;
      this.item.text = l10n("statusBar.justRan", { time });
      this.item.tooltip = l10n("statusBar.justRanTooltip", { name, time });
      this.item.show();
      this.scheduleJustRanExpiry(justRan.ranAt);
      return;
    }

    // No recent run — look for the soonest upcoming one within the lead window.
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

    if (!soonest || !shouldShowIndicator(soonest.at, now, windowMs)) {
      this.currentShortcutId = undefined;
      this.currentNextRunAt = undefined;
      this.item.hide();
      return;
    }

    const name = soonest.shortcut.label ?? (soonest.shortcut.path.split("/").pop() ?? soonest.shortcut.path);
    const time = formatWhen(soonest.at);
    this.currentShortcutId = soonest.shortcut.id;
    this.currentNextRunAt = soonest.at;
    this.item.text = l10n("statusBar.next", { time });
    this.item.tooltip = l10n("statusBar.tooltip", { name, time });
    this.item.show();
  }

  // Schedule a one-shot recompute at the exact moment the "just ran" flash expires,
  // so the indicator hides precisely rather than waiting for the next 60-second tick.
  private scheduleJustRanExpiry(ranAt: number): void {
    if (this.justRanTimer !== undefined) {
      clearTimeout(this.justRanTimer);
    }
    const remaining = JUST_RAN_WINDOW_MS - (Date.now() - ranAt);
    if (remaining <= 0) {
      return;
    }
    this.justRanTimer = setTimeout(() => {
      this.justRanTimer = undefined;
      this.recompute();
    }, remaining);
  }

  dispose(): void {
    clearInterval(this.timer);
    if (this.justRanTimer !== undefined) {
      clearTimeout(this.justRanTimer);
    }
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
