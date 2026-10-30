// Adaptive layout: group sizes, collapse and row limits from the number of documents.

// Document counts where the layout changes.
const BOUNDS = [8, 50, 200, 1000];
const MIN_BY_BAND = [2, 2, 3, 4, 5];

export interface Layout {
  band: number;
  // Group headers shown at all (not for a handful of documents).
  headers: boolean;
  min: number;
  max: number;
  // Deepest group level: 1 below 200 documents, else 2.
  levels: number;
  // Rows shown per open group or list; null for all.
  rowLimit: number | null;
  // First view: every group, or only some.
  open: { all: boolean; allWhenAtMost: number; maxWithBlockers: number | null };
  subGroupsOpen: boolean;
  // Finished rows on the Gantt: all dimmed, the last two per group, or only a count.
  finished: "all" | "last2" | "count";
  suggestions: { minConfidence: "low" | "medium" | "high"; page: number | null };
  // Set when groups fold on first view.
  foldWhy?: { key: string; params: Record<string, number> };
}

// The band of a count. A band changes upward at its boundary and downward only 10 percent below it.
export function bandFor(n: number, previous?: number): number {
  const raw = BOUNDS.filter((b) => n >= b).length;
  if (previous !== undefined && raw < previous && n >= BOUNDS[previous - 1] * 0.9) {
    return previous;
  }
  return raw;
}

export function layoutFor(n: number, previousBand?: number): Layout {
  const band = bandFor(n, previousBand);
  const max = Math.min(40, Math.max(8, Math.round(2 * Math.sqrt(n))));
  const base = { band, headers: band > 0, min: MIN_BY_BAND[band], max, levels: band >= 3 ? 2 : 1, subGroupsOpen: false };
  const folded = { key: "releaseBoard.org.why.folded", params: { count: n } };
  switch (band) {
    case 0:
      return { ...base, rowLimit: null, open: { all: true, allWhenAtMost: 0, maxWithBlockers: null }, finished: "all", suggestions: { minConfidence: "low", page: null } };
    case 1:
      return { ...base, rowLimit: 8, open: { all: false, allWhenAtMost: 3, maxWithBlockers: null }, finished: "all", suggestions: { minConfidence: "medium", page: 10 }, foldWhy: folded };
    case 2:
      return { ...base, rowLimit: 5, open: { all: false, allWhenAtMost: 0, maxWithBlockers: 3 }, finished: "last2", suggestions: { minConfidence: "medium", page: 10 }, foldWhy: folded };
    case 3:
      return { ...base, rowLimit: 5, open: { all: false, allWhenAtMost: 0, maxWithBlockers: 3 }, finished: "count", suggestions: { minConfidence: "medium", page: 10 }, foldWhy: folded };
    default:
      return { ...base, rowLimit: 3, open: { all: false, allWhenAtMost: 0, maxWithBlockers: 3 }, finished: "count", suggestions: { minConfidence: "high", page: 10 }, foldWhy: folded };
  }
}

// Which top-level groups are open on first view. The user's own open or close (by stable id) wins over everything.
export function openGroups(layout: Layout, groups: Array<{ id: string; blockers: number }>, remembered: ReadonlyMap<string, boolean> = new Map()): Set<string> {
  const open = new Set<string>();
  let auto: string[];
  if (layout.open.all || groups.length <= layout.open.allWhenAtMost) {
    auto = groups.map((g) => g.id);
  } else {
    auto = groups.filter((g) => g.blockers > 0).sort((a, b) => b.blockers - a.blockers || (a.id < b.id ? -1 : 1)).map((g) => g.id);
    if (layout.open.maxWithBlockers !== null) {
      auto = auto.slice(0, layout.open.maxWithBlockers);
    }
  }
  const chosen = new Set(auto);
  for (const g of groups) {
    if (remembered.get(g.id) ?? chosen.has(g.id)) {
      open.add(g.id);
    }
  }
  return open;
}
