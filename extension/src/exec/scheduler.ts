import * as vscode from "vscode";
import { Pin, pinKind } from "../model/pin";
import { PinStore } from "../model/pinStore";
import { planRun, runPin, runAction, getOutputChannel } from "./runner";
import { hasInteractiveTokens } from "./promptTokens";
import { nextOccurrence } from "./schedule";
import { l10n } from "../i18n/l10n";

// setTimeout's delay is a signed 32-bit ms value; a larger delay silently
// overflows and fires almost immediately. Far-future fires are chained in
// MAX_TIMEOUT-sized hops instead.
const MAX_TIMEOUT = 2_147_483_647;

// Drives in-process timers for scheduled pins (roadmap 2.2). One timer per
// scheduled+enabled pin, recomputed whenever the store changes (a pin added,
// removed, or its schedule edited) so enabling/disabling a schedule takes effect
// without a window reload. All timers are cleared on dispose, so none leak past
// deactivation.
export class Scheduler implements vscode.Disposable {
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly storeListener: vscode.Disposable;
  private disposed = false;

  constructor(private readonly store: PinStore) {
    // Any change to the pin set re-derives the full timer set. This is also how a
    // fire re-arms itself: recording lastRun refreshes the store, which fires
    // onDidChange, which reschedules the pin for its next slot.
    this.storeListener = store.onDidChange(() => this.rescheduleAll());
  }

  // Arm timers for the current pin set. Call once after the store is initialized.
  start(): void {
    this.rescheduleAll();
  }

  private rescheduleAll(): void {
    if (this.disposed) {
      return;
    }
    this.clearAll();
    const pins = [
      ...this.store.getProjectPins(),
      ...this.store.getGlobalPins(),
    ];
    for (const pin of pins) {
      this.armPin(pin);
    }
  }

  private armPin(pin: Pin): void {
    if (!pin.schedule) {
      return;
    }
    const next = nextOccurrence(pin.schedule, Date.now());
    if (next === undefined) {
      return;
    }
    const delay = Math.max(0, next - Date.now());
    // Hop in capped steps for far-future fires so the delay never overflows.
    const wait = Math.min(delay, MAX_TIMEOUT);
    const timer = setTimeout(() => {
      this.timers.delete(pin.id);
      if (wait < delay) {
        // The capped hop elapsed but it is not yet time; re-arm for the rest.
        this.armPin(pin);
      } else {
        void this.fire(pin.id);
      }
    }, wait);
    this.timers.set(pin.id, timer);
  }

  // Execute a pin's scheduled run: emit a timestamped output line and a toast
  // (via runPin), then record the fire. Recording lastRun refreshes the store and
  // re-arms the pin for its next occurrence (see the onDidChange wiring above).
  private async fire(pinId: string): Promise<void> {
    if (this.disposed) {
      return;
    }
    // Re-read from the store: the pin may have been edited or removed between
    // arming and firing.
    const pin = this.store.findPin(pinId);
    if (!pin || !pin.schedule?.enabled) {
      return;
    }
    const name = pin.label ?? (pin.path.split("/").pop() ?? pin.path);
    const channel = getOutputChannel();
    const stamp = new Date().toLocaleString();

    // Non-file scheduled pins (shell/url/command/macro — e.g. a promoted
    // scheduled-ritual recipe) run through the action dispatcher; there is no
    // file uri to resolve. Then advance the schedule as for a file run.
    if (pinKind(pin) !== "file") {
      channel.appendLine(l10n("schedule.fired", { time: stamp, name, command: actionLabel(pin) }));
      await runAction(pin, "scheduled");
      await this.store.updatePinScheduleLastRun(pin, Date.now());
      return;
    }

    const uri = this.store.resolveUri(pin);

    if (!uri) {
      // Target file is gone: note it and skip the run. Still record the fire so
      // the schedule advances to its next slot — without it, nextOccurrence would
      // return this same now-past slot, re-arm with a zero delay, and tight-loop.
      channel.appendLine(l10n("schedule.missing", { time: stamp, name }));
      channel.show(true);
      await this.store.updatePinScheduleLastRun(pin, Date.now());
      return;
    }

    // A scheduled fire is unattended; a pin whose run needs interactive input
    // (${prompt:...} / ${pick:...}) cannot be answered here. Skip it, note why,
    // and still advance the schedule so it does not tight-loop on this slot.
    if (hasInteractiveTokens(pin)) {
      channel.appendLine(l10n("schedule.interactiveSkipped", { time: stamp, name }));
      channel.show(true);
      await this.store.updatePinScheduleLastRun(pin, Date.now());
      return;
    }

    const plan = planRun(pin, uri);
    channel.appendLine(
      l10n("schedule.fired", { time: stamp, name, command: plan.commandLine })
    );
    await runPin(pin, uri, "scheduled");

    // Persisting lastRun triggers refresh -> onDidChange -> rescheduleAll, which
    // re-arms this pin (the daily dedup advances it to tomorrow; the interval
    // advances by one period).
    await this.store.updatePinScheduleLastRun(pin, Date.now());
  }

  private clearAll(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
  }

  dispose(): void {
    this.disposed = true;
    this.storeListener.dispose();
    this.clearAll();
  }
}

// Short description of a non-file pin's action for the scheduled-run log line.
function actionLabel(pin: Pin): string {
  const action = pin.action;
  if (!action) {
    return pin.path;
  }
  return (
    action.shellCommand ?? action.url ?? action.commandId ?? `${action.kind} action`
  );
}
