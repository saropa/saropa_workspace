import type { EvidenceFeed, EvidenceRead } from "./recipeEvidence";
import type { FeedKind } from "./reportSummary";

// Reports that add a note to the board but never change a light: the pull request queue, the
// uncommitted-work guard, the checks on the changelog, versions, branches and links, the
// release readiness summary, and the reports behind the Tidy sweep and the "Since you last
// looked" strip. Pure. A signal exists only for a fresh, readable report; a missing, old or
// unreadable report gives none, so absence never changes what the board shows.

// Where a signal is shown.
export type SignalPlace = "row" | "tidy" | "since";

// The feeds that are signals; build, lint, tests and deps are evidence instead.
export type SignalKind = Exclude<FeedKind, "build" | "lint" | "tests" | "deps">;

export const SIGNAL_PLACES: Record<SignalKind, SignalPlace> = {
  prs: "row",
  uncommitted: "row",
  staleBranches: "row",
  changelog: "row",
  version: "row",
  links: "row",
  readiness: "row",
  debt: "tidy",
  branches: "tidy",
  bloat: "tidy",
  bigFiles: "tidy",
  standup: "since",
  delta: "since",
};

export const SIGNAL_KINDS = Object.keys(SIGNAL_PLACES) as SignalKind[];

// The feeds of one place.
export function kindsAt(place: SignalPlace): SignalKind[] {
  return SIGNAL_KINDS.filter((k) => SIGNAL_PLACES[k] === place);
}

// One fresh report, reduced to what the board stores: no report text, no path.
export interface Signal {
  kind: SignalKind;
  result: "pass" | "fail";
  count?: number;
  // When the report was written (ms since the epoch).
  at: number;
  // The count in the report before this one, when it was read (tech-debt trend).
  previousCount?: number;
  detail: string;
}

export function isSignalKind(feed: EvidenceFeed): feed is SignalKind {
  return feed in SIGNAL_PLACES;
}

// The signals among the reads: only fresh, readable reports of a signal feed.
export function signalsOf(reads: Partial<Record<EvidenceFeed, EvidenceRead>> | undefined): Signal[] {
  const out: Signal[] = [];
  for (const kind of SIGNAL_KINDS) {
    const r = reads?.[kind];
    if (r?.ok) {
      out.push({ kind, result: r.result, count: r.count, at: r.at, previousCount: r.previousCount, detail: r.detail });
    }
  }
  return out;
}

// Whether a signal is worth a note on the project's row. A clean report is silent, except the
// readiness summary, which is the one line a reader looks for either way.
export function showsOnRow(s: Signal): boolean {
  if (SIGNAL_PLACES[s.kind] !== "row") {
    return false;
  }
  if (s.kind === "readiness") {
    return true;
  }
  return s.kind === "prs" ? (s.count ?? 0) > 0 : s.result === "fail";
}

// Whether a signal is a Tidy candidate.
export function isTidyReport(s: Signal): boolean {
  if (SIGNAL_PLACES[s.kind] !== "tidy") {
    return false;
  }
  return s.kind === "debt" || s.kind === "branches" ? (s.count ?? 0) > 0 : s.result === "fail";
}

// Whether a signal has something to tell in the "Since you last looked" strip.
export function isSinceReport(s: Signal): boolean {
  return SIGNAL_PLACES[s.kind] === "since" && (s.count ?? 0) > 0;
}

export type Trend = "up" | "down" | "same";

// How a count moved from the report before. Undefined when there was no report before.
export function trendOf(count: number | undefined, previous: number | undefined): Trend | undefined {
  if (count === undefined || previous === undefined) {
    return undefined;
  }
  return count > previous ? "up" : count < previous ? "down" : "same";
}
