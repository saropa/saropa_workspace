import type { BoardItem } from "./boardModelParts";

// Rows in a set order inside their group (Board tab only; the Gantt keeps work order). The order
// is a list of paths per project in the rules file. Rows with a place in their project's list come
// first, in list order; the others follow in the automatic order. A path in the list that is no
// longer a document is ignored here and dropped on the next write. Pure.

// The most paths one project's list holds.
export const MAX_ORDER = 500;

// The order lists of a parsed rules file: only text paths, each listed once, at most MAX_ORDER.
export function orderLists(raw: unknown): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return out;
  }
  for (const [project, list] of Object.entries(raw)) {
    const paths = Array.isArray(list) ? [...new Set(list.filter((p): p is string => typeof p === "string"))].slice(0, MAX_ORDER) : [];
    if (paths.length > 0) {
      out[project] = paths;
    }
  }
  return out;
}

// The rows of one group in the order they are shown.
export function applyOrder(items: BoardItem[], order: Record<string, string[]> | undefined): BoardItem[] {
  if (!order) {
    return items;
  }
  const rank = (i: BoardItem): number => {
    const at = order[i.project]?.indexOf(i.path) ?? -1;
    return at < 0 ? Infinity : at;
  };
  // Array.sort is stable, so rows without a place keep the automatic order.
  return [...items].sort((a, b) => {
    const [x, y] = [rank(a), rank(b)];
    return x === y ? 0 : x < y ? -1 : 1;
  });
}
