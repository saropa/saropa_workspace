import * as vscode from "vscode";
import { Shortcut, shortcutKind } from "../model/shortcut";
import { ShortcutStore } from "../model/shortcutStore";
import {
  planRun,
  runShortcut,
  runAction,
  getOutputChannel,
  runBlockReason,
  blockReasonLabel,
} from "./runner";
import { hasInteractiveTokens } from "./promptTokens";
import { nextOccurrence } from "./schedule";
import { l10n } from "../i18n/l10n";
import { CatchUpContext, fireMissedShortcuts, fireStartupShortcuts } from "./schedulerCatchUp";
import { FireResult, runAndRecord, scheduleName } from "./schedulerFire";

// setTimeout's delay is a signed 32-bit ms value; a larger delay silently
// overflows and fires almost immediately. Far-future fires are chained in
// MAX_TIMEOUT-sized hops instead.
const MAX_TIMEOUT = 2_147_483_647;

// Delay before run-on-startup shortcuts fire, so the run lands AFTER activation
// finishes and the window has settled rather than competing with it (the
// activation rule: no eager file/terminal work in the activation path).
const STARTUP_RUN_DELAY_MS = 1_500;

// What the scheduler needs from outside, so tests can replace it.
export interface SchedulerOptions {
  // Milliseconds since the user last touched the editor. Without it, heavy catch-up jobs do not wait.
  idleMs?: () => number;
  // Starts a non-file shortcut. Defaults to the action runner.
  launch?: (shortcut: Shortcut) => Promise<void>;
}

// Drives in-process timers for scheduled shortcuts (roadmap 2.2). One timer per
// scheduled+enabled shortcut, recomputed whenever the store changes (a shortcut added,
// removed, or its schedule edited) so enabling/disabling a schedule takes effect
// without a window reload. All timers are cleared on dispose, so none leak past
// deactivation.
export class Scheduler implements vscode.Disposable {
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly storeListener: vscode.Disposable;
  // One-shot timer for the deferred run-on-startup pass, cleared on dispose so a
  // fast deactivation does not leave it firing into a torn-down store.
  private startupTimer: NodeJS.Timeout | undefined;
  private disposed = false;
  // Pending idle waits, resolved on dispose so a catch-up pass never hangs on a closed window.
  private readonly sleepers = new Map<NodeJS.Timeout, () => void>();

  constructor(
    private readonly store: ShortcutStore,
    private readonly options: SchedulerOptions = {}
  ) {
    // Any change to the shortcut set re-derives the full timer set. This is also how a
    // fire re-arms itself: recording lastRun refreshes the store, which fires
    // onDidChange, which reschedules the shortcut for its next slot.
    this.storeListener = store.onDidChange(() => this.rescheduleAll());
  }

  // Arm timers for the current shortcut set. Call once after the store is initialized.
  start(): void {
    this.rescheduleAll();
  }

  // Fire shortcuts marked runOnStartup once, shortly after activation. Call once from
  // activate() after the store is loaded. The run is deferred (the activation rule:
  // no eager file/terminal work in the activation path) and de-duped on lastRun so
  // a window-reload storm does not re-run a startup shortcut.
  runStartupShortcuts(): void {
    if (this.disposed) {
      return;
    }
    this.startupTimer = setTimeout(() => {
      this.startupTimer = undefined;
      // Run the run-on-startup shortcuts first, then the missed-slot catch-up, both
      // off the same deferred timer so neither competes with activation.
      void fireStartupShortcuts(this.catchUpContext()).then(() => fireMissedShortcuts(this.catchUpContext()));
    }, STARTUP_RUN_DELAY_MS);
  }

  // The live state the catch-up passes read, as accessors so a pass always sees the current value.
  private catchUpContext(): CatchUpContext {
    return {
      store: this.store,
      isDisposed: () => this.disposed,
      fire: (id) => this.fire(id),
      idleMs: this.options.idleMs,
      sleep: (ms) =>
        new Promise<void>((resolve) => {
          const timer = setTimeout(() => {
            this.sleepers.delete(timer);
            resolve();
          }, ms);
          this.sleepers.set(timer, resolve);
        }),
    };
  }

  private rescheduleAll(): void {
    if (this.disposed) {
      return;
    }
    this.clearAll();
    const shortcuts = [
      ...this.store.getProjectShortcuts(),
      ...this.store.getGlobalShortcuts(),
    ];
    for (const shortcut of shortcuts) {
      this.armShortcut(shortcut);
    }
  }

  private armShortcut(shortcut: Shortcut): void {
    if (!shortcut.schedule) {
      return;
    }
    // A paused shortcut keeps its schedule but arms no timer — pausing is the "stop
    // running this on its own" switch; unpausing fires onDidChange, which re-runs
    // rescheduleAll and re-arms it from its next slot.
    if (shortcut.paused) {
      return;
    }
    const next = nextOccurrence(shortcut.schedule, Date.now());
    if (next === undefined) {
      return;
    }
    const delay = Math.max(0, next - Date.now());
    // Hop in capped steps for far-future fires so the delay never overflows.
    const wait = Math.min(delay, MAX_TIMEOUT);
    const timer = setTimeout(() => {
      this.timers.delete(shortcut.id);
      if (wait < delay) {
        // The capped hop elapsed but it is not yet time; re-arm for the rest.
        this.armShortcut(shortcut);
      } else {
        void this.fire(shortcut.id);
      }
    }, wait);
    this.timers.set(shortcut.id, timer);
  }

  // Execute a shortcut's scheduled run: emit a timestamped output line and a toast
  // (via runShortcut), then record the fire. Recording lastRun refreshes the store and
  // re-arms the shortcut for its next occurrence (see the onDidChange wiring above).
  private async fire(pinId: string): Promise<FireResult> {
    if (this.disposed) {
      return { started: false, reason: l10n("schedule.reason.closed") };
    }
    // Re-read from the store: the shortcut may have been edited or removed between
    // arming and firing.
    const shortcut = this.store.findShortcut(pinId);
    // Re-check paused as well as enabled: the shortcut may have been paused between
    // arming and this fire (a timer armed before the pause survives until it pops).
    if (!shortcut || shortcut.paused || !shortcut.schedule?.enabled) {
      return { started: false, reason: l10n("schedule.reason.off") };
    }
    const name = scheduleName(shortcut);
    const channel = getOutputChannel();
    const stamp = new Date().toLocaleString();

    // Single-instance guard: if a previous run of this shortcut is still in flight (a
    // background run that hung, or a cross-process lock held elsewhere), skip THIS
    // slot rather than launching a second — the "an hourly job that hangs must not
    // stack up" case. Still advance the schedule so it re-arms for the next slot
    // instead of tight-looping on this now-past one (same stance as a missing file).
    const block = runBlockReason(shortcut);
    if (block) {
      channel.appendLine(
        l10n("schedule.skipped", { time: stamp, name, reason: blockReasonLabel(block) })
      );
      await this.store.updateShortcutScheduleLastRun(shortcut, Date.now());
      return { started: false, reason: blockReasonLabel(block) };
    }

    // Non-file scheduled shortcuts (shell/url/command/macro — e.g. a promoted
    // scheduled-ritual recipe) run through the action dispatcher; there is no
    // file uri to resolve. Then advance the schedule as for a file run.
    if (shortcutKind(shortcut) !== "file") {
      channel.appendLine(l10n("schedule.fired", { time: stamp, name, command: actionLabel(shortcut) }));
      return runAndRecord(this.store, shortcut, name, () => (this.options.launch ?? ((s) => runAction(s, "scheduled")))(shortcut));
    }

    const uri = this.store.resolveUri(shortcut);

    if (!uri) {
      // Target file is gone: note it and skip the run. Still record the fire so
      // the schedule advances to its next slot — without it, nextOccurrence would
      // return this same now-past slot, re-arm with a zero delay, and tight-loop.
      channel.appendLine(l10n("schedule.missing", { time: stamp, name }));
      channel.show(true);
      await this.store.updateShortcutScheduleLastRun(shortcut, Date.now());
      return { started: false, reason: l10n("schedule.reason.missingFile") };
    }

    // A scheduled fire is unattended; a shortcut whose run needs interactive input
    // (${prompt:...} / ${pick:...}) cannot be answered here. Skip it, note why,
    // and still advance the schedule so it does not tight-loop on this slot.
    if (hasInteractiveTokens(shortcut)) {
      channel.appendLine(l10n("schedule.interactiveSkipped", { time: stamp, name }));
      channel.show(true);
      await this.store.updateShortcutScheduleLastRun(shortcut, Date.now());
      return { started: false, reason: l10n("schedule.reason.interactive") };
    }

    const plan = planRun(shortcut, uri);
    channel.appendLine(
      l10n("schedule.fired", { time: stamp, name, command: plan.commandLine })
    );
    // runAndRecord runs the fire, then persists lastRun + the tracked outcome/report
    // in one store update. Persisting lastRun triggers refresh -> onDidChange ->
    // rescheduleAll, which re-arms this shortcut (the daily dedup advances it to
    // tomorrow; the interval advances by one period).
    return runAndRecord(this.store, shortcut, name, () => runShortcut(shortcut, uri, "scheduled"));
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
    if (this.startupTimer) {
      clearTimeout(this.startupTimer);
      this.startupTimer = undefined;
    }
    this.clearAll();
    for (const [timer, resolve] of this.sleepers) {
      clearTimeout(timer);
      resolve();
    }
    this.sleepers.clear();
  }
}

// Short description of a non-file shortcut's action for the scheduled-run log line.
function actionLabel(shortcut: Shortcut): string {
  const action = shortcut.action;
  if (!action) {
    return shortcut.path;
  }
  return (
    action.shellCommand ?? action.url ?? action.commandId ?? `${action.kind} action`
  );
}
