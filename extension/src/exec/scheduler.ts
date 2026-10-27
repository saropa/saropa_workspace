import * as vscode from "vscode";
import { Shortcut, shortcutKind } from "../model/shortcut";
import { shortcutDisplayName } from "../model/shortcutDisplayName";
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
import { FeedInfo, catchUpOrder, feedOfAction } from "../board/reportSummary";
import { clampIdleMinutes } from "../board/recipeEvidence";
import { feedJobs } from "./feedJobs";

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

// How often a heavy catch-up job checks whether the editor has been idle long enough.
const IDLE_POLL_MS = 15_000;

// How a scheduled fire ended: started, or why it could not start.
type FireResult = { started: true } | { started: false; reason: string };

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
    const caughtUp: Shortcut[] = [];
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
        caughtUp.push(shortcut);
      } else {
        offered.push(shortcut);
      }
    }
    // The offer is not awaited: it waits for a click, and the catch-up must not wait behind it.
    if (offered.length > 0) {
      const single = offered.length === 1 ? scheduleName(offered[0]) : undefined;
      void offerMissedRuns(offered.length, single, () => {
        for (const shortcut of offered) {
          void this.fire(shortcut.id);
        }
      });
    }
    await this.runCatchUp(caughtUp);
  }

  // Runs the opted-in missed shortcuts one at a time, each once however many days were missed
  // (isMissed looks at the latest due slot only). With the board's recipe evidence on, the
  // cheapest feeding jobs go first and a heavy one waits until the editor has been idle. Each
  // job's state is published so the board can say "checking now" and refresh after each report.
  private async runCatchUp(list: Shortcut[]): Promise<void> {
    const cfg = vscode.workspace.getConfiguration("saropaWorkspace.releaseBoard.recipeEvidence");
    const feeding = cfg.get<boolean>("enabled", true);
    const idleMinutes = clampIdleMinutes(cfg.get<number>("idleMinutes", 2));
    const infoOf = (s: Shortcut): FeedInfo | undefined => (feeding ? feedOfAction(s.action) : undefined);
    const ordered = feeding ? catchUpOrder(list, infoOf) : list;
    for (const s of ordered) {
      if (infoOf(s)) {
        feedJobs.set(s.id, { state: "queued" });
      }
    }
    for (const shortcut of ordered) {
      const info = infoOf(shortcut);
      if (info?.heavy) {
        await this.waitForIdle(idleMinutes);
      }
      if (this.disposed) {
        return;
      }
      // The wait can be long: the job's own daily timer may have run it meanwhile. Run it only
      // while its slot is still missed.
      const current = this.store.findShortcut(shortcut.id);
      if (!current?.schedule?.enabled || current.paused || !isMissed(current.schedule, Date.now())) {
        feedJobs.clear(shortcut.id);
        continue;
      }
      if (info) {
        feedJobs.set(shortcut.id, { state: "running" });
      }
      // fire() records the outcome and advances lastRun so the schedule re-arms cleanly.
      const result = await this.fire(shortcut.id);
      if (!info) {
        continue;
      }
      if (result.started) {
        feedJobs.clear(shortcut.id);
      } else {
        feedJobs.set(shortcut.id, { state: "failed", reason: result.reason });
      }
    }
  }

  // Resolves once the editor has been idle for the given minutes. No wait without an idle source.
  private async waitForIdle(minutes: number): Promise<void> {
    const idleMs = this.options.idleMs;
    if (!idleMs || minutes <= 0) {
      return;
    }
    while (!this.disposed && idleMs() < minutes * 60_000) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          this.sleepers.delete(timer);
          resolve();
        }, IDLE_POLL_MS);
        this.sleepers.set(timer, resolve);
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
      return this.runAndRecord(shortcut, name, () => (this.options.launch ?? ((s) => runAction(s, "scheduled")))(shortcut));
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
    return this.runAndRecord(shortcut, name, () => runShortcut(shortcut, uri, "scheduled"));
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
  ): Promise<FireResult> {
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
      return { started: false, reason: plainReason(error) };
    }
    await this.recordFireResult(shortcut, name, startedAt);
    return { started: true };
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
    for (const [timer, resolve] of this.sleepers) {
      clearTimeout(timer);
      resolve();
    }
    this.sleepers.clear();
  }
}

// A start failure as one short line for the board: file paths shrink to the file name.
function plainReason(message: string): string {
  const short = message.split("\n")[0].replace(/(?:[A-Za-z]:)?[\\/](?:[^\s'"\\/]+[\\/])+([^\s'"\\/]+)/g, "$1").trim();
  return short.length > 0 ? short.slice(0, 120) : l10n("schedule.reason.unknown");
}

// Display name for a scheduled shortcut, matching the scheduler's log lines and the
// status bar. Single source so the fire log, the missed-run offer, and the result
// toast all name the item the same way.
function scheduleName(shortcut: Shortcut): string {
  return shortcutDisplayName(shortcut);
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
