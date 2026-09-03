// In-memory, per-session store of the most recent RoutineBrief each routine
// produced. Mirrors lastReport.ts: the routine runner records a brief after
// writing the summary; the brief panel reads the latest one to render. Keyed by
// shortcut id so the map is bounded by the shortcut count and a later run of the
// same routine simply overwrites its own entry.

import type { RoutineBrief } from "./routineRunner";

// Not wired to onDidRemoveShortcut — a removed routine's entry here is never cleared
// (shortcut ids are never reused), so this is a real leak bounded by how many
// routines the workspace has EVER had, not how many exist now. Low severity: one
// RoutineBrief object per removed routine, and routines are removed far less often
// than shortcuts are. See BUG-011 for the cleanup pattern this should follow.
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
