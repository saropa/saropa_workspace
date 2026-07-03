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
import { nextOccurrence, isMissed } from "./schedule";
import { runStatusRegistry } from "./runStatus";
import { takeLastReport } from "./lastReport";
import { firstWorkspacePath } from "./actionRunner";
import { surfaceRunResult, offerMissedRuns } from "../views/scheduleFeedback";
import { l10n } from "../i18n/l10n";
import * as path from "path";

// setTimeout's delay is a signed 32-bit ms value; a larger delay silently
// overflows and fires almost immediately. Far-future fires are chained in
// MAX_TIMEOUT-sized hops instead.
const MAX_TIMEOUT = 2_147_483_647;

// Delay before run-on-startup shortcuts fire, so the run lands AFTER activation
// finishes and the window has settled rather than competing with it (the
// activation rule: no eager file/terminal work in the activation path).
const STARTUP_RUN_DELAY_MS = 1_500;

// Reopen de-dup window for run-on-startup. A VS Code "Reload Window" re-activates
// the extension within seconds, so a startup shortcut whose last fire is within this
// window is skipped to avoid a reload storm re-running it. A deliberate reopen
// later than the window is treated as a fresh session and fires — "run on
// startup" means "when I open this workspace," and the only thing guarded against
// is the involuntary rapid reload, not a genuine later reopen.
const STARTUP_DEDUP_MS = 2 * 60_000;

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

  constructor(private readonly store: ShortcutStore) {
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
      void this.fireStartupShortcuts().then(() => this.fireMissedShortcuts());
    }, STARTUP_RUN_DELAY_MS);
  }

  // Catch up scheduled slots that elapsed while VS Code was closed. A schedule whose
  // most-recent due slot is later than its last fire (isMissed) either auto-runs
  // silently when it opted into catchUp, or is collected and OFFERED via one toast
  // with a "Run now" action. Runs once per activation, off the startup timer, so it
  // does not compete with activation and does not re-nag within a session. The
  // STARTUP_DEDUP_MS guard suppresses a reload storm from re-offering/re-running a
  // slot that was just handled.
  private async fireMissedShortcuts(): Promise<void> {
    if (this.disposed) {
      return;
    }
    const now = Date.now();
    const shortcuts = [
      ...this.store.getProjectShortcuts(),
      ...this.store.getGlobalShortcuts(),
    ];
    const offered: Shortcut[] = [];
    for (const shortcut of shortcuts) {
      const schedule = shortcut.schedule;
      if (shortcut.paused || !schedule?.enabled || !isMissed(schedule, now)) {
        continue;
      }
      // Skip a slot handled within the reload window so a rapid reload does not
      // re-run or re-offer it.
      if (schedule.lastRun !== undefined && now - schedule.lastRun < STARTUP_DEDUP_MS) {
        continue;
      }
      if (schedule.catchUp) {
        // Opted into silent catch-up: fire it through the normal slot path (which
        // records the outcome and advances lastRun so it re-arms cleanly).
        await this.fire(shortcut.id);
      } else {
        offered.push(shortcut);
      }
    }
    if (offered.length > 0) {
      const single = offered.length === 1 ? scheduleName(offered[0]) : undefined;
      await offerMissedRuns(offered.length, single, () => {
        for (const shortcut of offered) {
          void this.fire(shortcut.id);
        }
      });
    }
  }

  private async fireStartupShortcuts(): Promise<void> {
    if (this.disposed) {
      return;
    }
    const now = Date.now();
    const shortcuts = [
      ...this.store.getProjectShortcuts(),
      ...this.store.getGlobalShortcuts(),
    ];
    for (const shortcut of shortcuts) {
      const schedule = shortcut.schedule;
      if (shortcut.paused || !schedule?.enabled || !schedule.runOnStartup) {
        continue;
      }
      // Skip a shortcut that already fired within the reload window — a Reload Window
      // re-activates within seconds and we do not want it to re-run.
      if (schedule.lastRun !== undefined && now - schedule.lastRun < STARTUP_DEDUP_MS) {
        continue;
      }
      // fire() does the file-resolve / interactive-skip / run + records lastRun,
      // exactly as a time-based slot does, so the startup run reuses one code path.
      await this.fire(shortcut.id);
    }
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
  private async fire(pinId: string): Promise<void> {
    if (this.disposed) {
      return;
    }
    // Re-read from the store: the shortcut may have been edited or removed between
    // arming and firing.
    const shortcut = this.store.findShortcut(pinId);
    // Re-check paused as well as enabled: the shortcut may have been paused between
    // arming and this fire (a timer armed before the pause survives until it pops).
    if (!shortcut || shortcut.paused || !shortcut.schedule?.enabled) {
      return;
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
      return;
    }

    // Non-file scheduled shortcuts (shell/url/command/macro — e.g. a promoted
    // scheduled-ritual recipe) run through the action dispatcher; there is no
    // file uri to resolve. Then advance the schedule as for a file run.
    if (shortcutKind(shortcut) !== "file") {
      channel.appendLine(l10n("schedule.fired", { time: stamp, name, command: actionLabel(shortcut) }));
      await this.runAndRecord(shortcut, name, () => runAction(shortcut, "scheduled"));
      return;
    }

    const uri = this.store.resolveUri(shortcut);

    if (!uri) {
      // Target file is gone: note it and skip the run. Still record the fire so
      // the schedule advances to its next slot — without it, nextOccurrence would
      // return this same now-past slot, re-arm with a zero delay, and tight-loop.
      channel.appendLine(l10n("schedule.missing", { time: stamp, name }));
      channel.show(true);
      await this.store.updateShortcutScheduleLastRun(shortcut, Date.now());
      return;
    }

    // A scheduled fire is unattended; a shortcut whose run needs interactive input
    // (${prompt:...} / ${pick:...}) cannot be answered here. Skip it, note why,
    // and still advance the schedule so it does not tight-loop on this slot.
    if (hasInteractiveTokens(shortcut)) {
      channel.appendLine(l10n("schedule.interactiveSkipped", { time: stamp, name }));
      channel.show(true);
      await this.store.updateShortcutScheduleLastRun(shortcut, Date.now());
      return;
    }

    const plan = planRun(shortcut, uri);
    channel.appendLine(
      l10n("schedule.fired", { time: stamp, name, command: plan.commandLine })
    );
    // runAndRecord runs the fire, then persists lastRun + the tracked outcome/report
    // in one store update. Persisting lastRun triggers refresh -> onDidChange ->
    // rescheduleAll, which re-arms this shortcut (the daily dedup advances it to
    // tomorrow; the interval advances by one period).
    await this.runAndRecord(shortcut, name, () => runShortcut(shortcut, uri, "scheduled"));
  }

  // Run a scheduled fire and record its result. Wraps the run in try/catch so a
  // thrown run (the non-routine paths do not catch internally) cannot become an
  // unhandled rejection: on error it logs, persists a failure outcome, still advances
  // lastRun so the schedule re-arms rather than tight-looping, and surfaces a failure
  // toast. On success it hands off to recordFireResult.
  private async runAndRecord(
    shortcut: Shortcut,
    name: string,
    run: () => Promise<void>
  ): Promise<void> {
    const startedAt = Date.now();
    try {
      await run();
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      getOutputChannel().appendLine(
        l10n("schedule.runFailed", { time: new Date().toLocaleString(), name, error })
      );
      await this.store.updateShortcutScheduleLastRun(shortcut, Date.now(), {
        outcome: "failure",
        reportRelPath: undefined,
      });
      void surfaceRunResult(name, "failure");
      return;
    }
    await this.recordFireResult(shortcut, name, startedAt);
  }

  // Persist a completed scheduled fire's outcome + report, then surface it. Reads the
  // fresh tracked result (guarded on endedAt >= startedAt so a stale prior result is
  // not mistaken for this run's — the freshness check the routine engine uses) and the
  // report the run wrote (takeLastReport). Report-producing paths (routines, report
  // recipes) complete synchronously before their run() resolves, so the result is
  // available here; a background file run completes asynchronously and surfaces its own
  // completion toast, so here it only advances lastRun (its session outcome still shows
  // in the Schedule screen). The toast is shown ONLY when a report exists — its purpose
  // is the Open report action, and a report-less run already surfaced itself.
  private async recordFireResult(
    shortcut: Shortcut,
    name: string,
    startedAt: number
  ): Promise<void> {
    const result = runStatusRegistry.get(shortcut.id);
    const fresh = result && result.endedAt >= startedAt ? result : undefined;
    // takeLastReport clears the entry so a later report-less run cannot re-link it.
    // Pairing it with `fresh` is safe because every path that produces a synchronous
    // fresh outcome (runShellToReport, writeRoutineSummary) co-writes its own report
    // in the same block, overwriting any stale entry before this read; and the single-
    // instance guard (runBlockReason) prevents an overlapping run of this shortcut from
    // interleaving a different report. So a fresh outcome is always paired with its own
    // report, never a stale one.
    const reportAbs = takeLastReport(shortcut.id);
    const reportRel = reportAbs ? toWorkspaceRelative(reportAbs) : undefined;
    await this.store.updateShortcutScheduleLastRun(
      shortcut,
      Date.now(),
      fresh ? { outcome: fresh.outcome, reportRelPath: reportRel } : undefined
    );
    if (fresh && reportAbs) {
      void surfaceRunResult(name, fresh.outcome, reportAbs);
    }
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
  }
}

// Display name for a scheduled shortcut, matching the scheduler's log lines and the
// status bar. Single source so the fire log, the missed-run offer, and the result
// toast all name the item the same way.
function scheduleName(shortcut: Shortcut): string {
  return shortcut.label ?? (shortcut.path.split("/").pop() ?? shortcut.path);
}

// Workspace-root-relative form (forward slashes) of an absolute report path, for
// durable storage on the schedule (survives clone/move like a project shortcut path).
// Falls back to the absolute path when no workspace root resolves — validateReportPath
// then simply refuses to open anything outside reports/.
function toWorkspaceRelative(absPath: string): string {
  const root = firstWorkspacePath();
  if (!root) {
    return absPath;
  }
  return path.relative(root, absPath).split(path.sep).join("/");
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
