import * as vscode from "vscode";
import { Shortcut } from "../model/shortcut";
import { ShortcutStore } from "../model/shortcutStore";
import { isMissed } from "./schedule";
import { offerMissedRuns } from "../views/scheduleFeedback";
import { FeedInfo, catchUpOrder, feedOfAction } from "../board/reportSummary";
import { clampIdleMinutes } from "../board/recipeEvidence";
import { feedJobs } from "./feedJobs";
import { FireResult, scheduleName } from "./schedulerFire";

// The run-on-startup and missed-slot catch-up passes. Split from scheduler.ts, which keeps the
// timers: this module reaches the scheduler's live state only through the accessors below.

// What a pass needs from the scheduler. Accessors, not copies: `disposed` and the sleepers are live state.
export interface CatchUpContext {
  store: ShortcutStore;
  // True once the scheduler is disposed; read on every step, never cached.
  isDisposed: () => boolean;
  // Fires one shortcut by id and reports how it ended.
  fire: (id: string) => Promise<FireResult>;
  // Milliseconds since the user last touched the editor; absent means heavy jobs do not wait.
  idleMs?: () => number;
  // Waits `ms`; the scheduler tracks the wait so dispose can end it early.
  sleep: (ms: number) => Promise<void>;
}

// Reopen de-dup window for run-on-startup. A VS Code "Reload Window" re-activates
// the extension within seconds, so a startup shortcut whose last fire is within this
// window is skipped to avoid a reload storm re-running it. A deliberate reopen
// later than the window is treated as a fresh session and fires — "run on
// startup" means "when I open this workspace," and the only thing guarded against
// is the involuntary rapid reload, not a genuine later reopen.
const STARTUP_DEDUP_MS = 2 * 60_000;

// How often a heavy catch-up job checks whether the editor has been idle long enough.
const IDLE_POLL_MS = 15_000;

// Catch up scheduled slots that elapsed while VS Code was closed. A schedule whose
// most-recent due slot is later than its last fire (isMissed) either auto-runs
// silently when it opted into catchUp, or is collected and OFFERED via one toast
// with a "Run now" action. Runs once per activation, off the startup timer, so it
// does not compete with activation and does not re-nag within a session. The
// STARTUP_DEDUP_MS guard suppresses a reload storm from re-offering/re-running a
// slot that was just handled.
export async function fireMissedShortcuts(ctx: CatchUpContext): Promise<void> {
  if (ctx.isDisposed()) {
    return;
  }
  const now = Date.now();
  const shortcuts = [
    ...ctx.store.getProjectShortcuts(),
    ...ctx.store.getGlobalShortcuts(),
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
        void ctx.fire(shortcut.id);
      }
    });
  }
  await runCatchUp(ctx, caughtUp);
}


// Runs the opted-in missed shortcuts one at a time, each once however many days were missed
// (isMissed looks at the latest due slot only). With the board's recipe evidence on, the
// cheapest feeding jobs go first and a heavy one waits until the editor has been idle. Each
// job's state is published so the board can say "checking now" and refresh after each report.
async function runCatchUp(ctx: CatchUpContext, list: Shortcut[]): Promise<void> {
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
      await waitForIdle(ctx, idleMinutes);
    }
    if (ctx.isDisposed()) {
      return;
    }
    // The wait can be long: the job's own daily timer may have run it meanwhile. Run it only
    // while its slot is still missed.
    const current = ctx.store.findShortcut(shortcut.id);
    if (!current?.schedule?.enabled || current.paused || !isMissed(current.schedule, Date.now())) {
      feedJobs.clear(shortcut.id);
      continue;
    }
    if (info) {
      feedJobs.set(shortcut.id, { state: "running" });
    }
    // fire() records the outcome and advances lastRun so the schedule re-arms cleanly.
    const result = await ctx.fire(shortcut.id);
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
async function waitForIdle(ctx: CatchUpContext, minutes: number): Promise<void> {
  const idleMs = ctx.idleMs;
  if (!idleMs || minutes <= 0) {
    return;
  }
  while (!ctx.isDisposed() && idleMs() < minutes * 60_000) {
    await ctx.sleep(IDLE_POLL_MS);
  }
}


export async function fireStartupShortcuts(ctx: CatchUpContext): Promise<void> {
  if (ctx.isDisposed()) {
    return;
  }
  const now = Date.now();
  const shortcuts = [
    ...ctx.store.getProjectShortcuts(),
    ...ctx.store.getGlobalShortcuts(),
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
    await ctx.fire(shortcut.id);
  }
}
