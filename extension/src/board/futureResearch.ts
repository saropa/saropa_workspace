import { ResearchState } from "./futureBlock";
import { FutureItem, FutureSort, groupItems } from "./futureList";

// Future tab, research: which documents wait for research, and how many go into one hand-off at
// once. Pure.

export const MIN_PARALLEL = 1;
// Upper bound so a bad setting cannot start dozens of research sessions at once.
export const MAX_PARALLEL = 10;
// Fallback when the setting is missing or invalid; small enough to review results as they arrive.
export const DEFAULT_PARALLEL = 3;

// Plain setting value to the number of documents handed at once: a whole number from 1 to
// 10, else the default.
export function asResearchParallel(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.min(MAX_PARALLEL, Math.max(MIN_PARALLEL, Math.floor(v))) : DEFAULT_PARALLEL;
}

// What the research states add up to.
export interface ResearchCounts {
  // Documents flagged "needed": waiting for research.
  needed: number;
  inProgress: number;
  // Research is ready and nobody has marked it reviewed.
  readyUnreviewed: number;
}

// Counts only the states that need attention (needed, running, ready but unreviewed), which
// feed the pills; finished and untouched documents are left out on purpose.
export function researchCounts(items: readonly Pick<FutureItem, "research">[]): ResearchCounts {
  const n = (state: ResearchState): number => items.filter((i) => i.research === state).length;
  return { needed: n("needed"), inProgress: n("in-progress"), readyUnreviewed: n("ready") };
}

// The documents the next hand-off takes, as indexes into `items`: flagged "needed", in the
// order the tab shows them, at most `limit`. `queued` is how many flagged documents stay
// behind for the next hand-off.
export function researchQueue(items: readonly FutureItem[], sort: FutureSort, limit: number): { batch: number[]; queued: number } {
  const flagged = groupItems([...items], sort).flatMap((g) => g.entries.filter((e) => e.item.research === "needed").map((e) => e.i));
  const take = asResearchParallel(limit);
  return { batch: flagged.slice(0, take), queued: Math.max(0, flagged.length - take) };
}

// The question handed over when the user gives none, so a research hand-off always has a
// concrete task instead of an empty one.
export const DEFAULT_QUESTION = "Is this still possible and worth building? What has changed since it was written?";
