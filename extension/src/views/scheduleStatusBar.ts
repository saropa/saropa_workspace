import * as vscode from "vscode";
import { Pin } from "../model/pin";
import { PinStore } from "../model/pinStore";
import { nextOccurrence } from "../exec/schedule";
import { l10n } from "../i18n/l10n";

// Roadmap 4.3 — a status-bar item showing the soonest upcoming scheduled run
// (pin name + time). Clicking it reveals that pin in the tree. Hidden when no
// pin has an enabled schedule, so it adds no empty noise. Reinforces the
// "no silent execution" principle by always showing what is queued.

export class ScheduleStatusBar {
  private readonly item: vscode.StatusBarItem;
  // The pin the item currently points at, so the reveal command knows its target
  // without recomputing.
  private currentPinId: string | undefined;
  private readonly timer: NodeJS.Timeout;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly store: PinStore) {
    this.item = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100
    );
    this.item.command = "saropaWorkspace.revealNextScheduled";

    // Recompute when pins/schedules change (a fire updates lastRun -> store
    // change), and on a slow tick so the soonest run rolls forward past a fire
    // even without a store change.
    this.disposables.push(store.onDidChange(() => this.recompute()));
    this.timer = setInterval(() => this.recompute(), 60_000);
    this.recompute();
  }

  // The pin the status bar currently advertises, for the reveal command.
  getCurrentPinId(): string | undefined {
    return this.currentPinId;
  }

  private recompute(): void {
    const now = Date.now();
    let soonest: { pin: Pin; at: number } | undefined;
    for (const pin of [...this.store.getProjectPins(), ...this.store.getGlobalPins()]) {
      if (!pin.schedule?.enabled) {
        continue;
      }
      const at = nextOccurrence(pin.schedule, now);
      if (at === undefined) {
        continue;
      }
      if (!soonest || at < soonest.at) {
        soonest = { pin, at };
      }
    }

    if (!soonest) {
      this.currentPinId = undefined;
      this.item.hide();
      return;
    }

    const name = soonest.pin.label ?? (soonest.pin.path.split("/").pop() ?? soonest.pin.path);
    const time = formatWhen(soonest.at);
    this.currentPinId = soonest.pin.id;
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
// formatting is delegated to the OS so the clock matches regional settings.
function formatWhen(ts: number): string {
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
