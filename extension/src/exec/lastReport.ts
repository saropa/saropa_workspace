// Hands the absolute path of the report a run just wrote back to the scheduler, so
// a scheduled fire can persist a durable per-schedule "last report" link the
// Schedule screen opens in one click. In-memory and per-session (like
// runStatusRegistry): the report writers (runShellToReport, writeRoutineSummary)
// set it as they write; the scheduler takes it right after the fire it started
// completes. Keyed by shortcut id, so the map is bounded by the shortcut count and a
// later run of the same shortcut simply overwrites its own entry.
//
// take() clears on read so a subsequent fire that writes NO report (a plain file /
// shell run) does not re-link a stale report from an earlier run.

const lastReport = new Map<string, string>();

// Record the absolute path of the report `pinId`'s latest run wrote.
export function recordLastReport(pinId: string, absPath: string): void {
  lastReport.set(pinId, absPath);
}

// Read and clear the report path `pinId`'s latest run wrote, or undefined when the
// run produced none.
export function takeLastReport(pinId: string): string | undefined {
  const value = lastReport.get(pinId);
  lastReport.delete(pinId);
  return value;
}

// Read WITHOUT clearing. The routine summary reads each member's just-written
// report path to link it, but must not consume the entry: the scheduler still
// take()s the report path for a member that is ALSO independently scheduled, and a
// non-destructive peek here leaves that untouched. The routine path pairs this with
// clearLastReport BEFORE each member runs, so a peek after the run can only return a
// report THIS run wrote — never a stale path a prior run of the same member left.
export function peekLastReport(pinId: string): string | undefined {
  return lastReport.get(pinId);
}

// Drop `pinId`'s recorded report path. The routine engine clears each member's entry
// before running it, so a member that writes NO report this run (a failed / no-op
// run) does not leave the previous run's path for the summary to relink.
export function clearLastReport(pinId: string): void {
  lastReport.delete(pinId);
}
