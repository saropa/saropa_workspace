// In-memory, per-session store of the most recent RoutineBrief each routine
// produced. Mirrors lastReport.ts: the routine runner records a brief after
// writing the summary; the brief panel reads the latest one to render. Keyed by
// shortcut id so the map is bounded by the shortcut count and a later run of the
// same routine simply overwrites its own entry.

import type { RoutineBrief } from "./routineRunner";

const lastBriefs = new Map<string, RoutineBrief>();

export function recordLastBrief(pinId: string, brief: RoutineBrief): void {
  lastBriefs.set(pinId, brief);
}

export function peekLastBrief(pinId: string): RoutineBrief | undefined {
  return lastBriefs.get(pinId);
}

// The most recently recorded brief across all routines, for the command with no
// argument ("open the morning brief" with no specific routine in mind).
export function latestBrief(): RoutineBrief | undefined {
  let newest: RoutineBrief | undefined;
  for (const brief of lastBriefs.values()) {
    if (!newest || brief.generatedAt > newest.generatedAt) {
      newest = brief;
    }
  }
  return newest;
}

// Drop all entries. Exported for test teardown.
export function clearAllBriefs(): void {
  lastBriefs.clear();
}
