import { Shortcut } from "../model/shortcut";
import { shortcutDisplayName } from "../model/shortcutDisplayName";
import { ShortcutStore } from "../model/shortcutStore";
import { getOutputChannel } from "./runner";
import { runStatusRegistry } from "./runStatus";
import { takeLastReport } from "./lastReport";
import { firstWorkspacePath } from "./actionRunner";
import { surfaceRunResult } from "../views/scheduleFeedback";
import { l10n } from "../i18n/l10n";
import * as path from "path";

// Recording the result of a scheduled fire. Split from scheduler.ts, which keeps the timers.

// How a scheduled fire ended: started, or why it could not start.
export type FireResult = { started: true } | { started: false; reason: string };

// Run a scheduled fire and record its result. Wraps the run in try/catch so a
// thrown run (the non-routine paths do not catch internally) cannot become an
// unhandled rejection: on error it logs, persists a failure outcome, still advances
// lastRun so the schedule re-arms rather than tight-looping, and surfaces a failure
// toast. On success it hands off to recordFireResult.
export async function runAndRecord(
  store: ShortcutStore,
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
    await store.updateShortcutScheduleLastRun(shortcut, Date.now(), {
      outcome: "failure",
      reportRelPath: undefined,
    });
    void surfaceRunResult(name, "failure");
    return { started: false, reason: plainReason(error) };
  }
  await recordFireResult(store, shortcut, name, startedAt);
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
async function recordFireResult(
  store: ShortcutStore,
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
  await store.updateShortcutScheduleLastRun(
    shortcut,
    Date.now(),
    fresh ? { outcome: fresh.outcome, reportRelPath: reportRel } : undefined
  );
  if (fresh && reportAbs) {
    void surfaceRunResult(name, fresh.outcome, reportAbs);
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
export function scheduleName(shortcut: Shortcut): string {
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
