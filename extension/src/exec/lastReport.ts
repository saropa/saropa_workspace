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
