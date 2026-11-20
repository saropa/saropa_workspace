import type { BoardItem, BoardProject } from "./boardModelParts";
import { Link, wouldCircle } from "./links";
import { readsNeeds } from "./docFacts";
import { NO_FOLDER, OrderEntry, OrderItem, Pair, afterOf, emptyOrder, folderOrder, pendingCount, settle } from "./orderAsk";

// Puts the owner's order answers onto the built board: `after` and `inferred` on the items, the folder ranks and
// the "which comes first" strip on the projects. An answer is an order preference only: `waitsOn` is untouched.

const SEV: Record<string, number> = { extreme: 0, critical: 1, high: 2, medium: 3, low: 4 };

// The folder an item counts in for ordering: its group, or NO_FOLDER when it has none.
export const folderOf = (i: BoardItem): string => i.group?.id ?? NO_FOLDER;

// The flagged (blocking) open items of a project, as the question logic reads them.
export const orderItemsOf = (items: readonly BoardItem[]): OrderItem[] => items.filter((i) => i.blocks).map((i) => ({ path: i.path, folder: folderOf(i), sev: SEV[i.severity ?? "medium"] ?? 3, blocksCount: i.blocksCount }));

// The Needs links among a project's items as order edges: the target comes before the waiting document.
export function hardEdges(all: readonly BoardItem[], items: readonly BoardItem[]): Pair[] {
  return items.flatMap((i) => i.waitsOn.flatMap((w) => (all[w] && all[w].project === i.project ? [[all[w].path, i.path] as Pair] : [])));
}

// Reads every answered project's order answers onto the board. Projects with nothing to read are skipped.
export function attachOrder(projects: readonly BoardProject[], all: readonly BoardItem[], order: Record<string, OrderEntry> = {}): void {
  for (const p of projects) {
    const e = order[p.id];
    const flagged = p.answered ? orderItemsOf(p.items) : [];
    if (!e && flagged.length < 2) {
      continue;
    }
    const entry = e ?? emptyOrder();
    const hard = hardEdges(all, p.items);
    if (e && e.pairs.length > 0) {
      const byPath = new Map(p.items.map((i) => [i.path, i]));
      const ids = (paths: string[]): number[] => paths.flatMap((x) => (byPath.has(x) ? [byPath.get(x)!.id] : []));
      for (const [path, placed] of afterOf(settle(e.pairs, hard).kept, new Set(byPath.keys()))) {
        const it = byPath.get(path)!;
        const after = ids(placed.after).filter((id) => !it.waitsOn.includes(id));
        if (after.length > 0) {
          it.after = after;
        }
        if (placed.inferred.length > 0) {
          it.inferred = ids(placed.inferred);
        }
      }
    }
    if (e && e.folders.length > 0 && new Set(flagged.map((f) => f.folder)).size > 1) {
      p.folderRank = Object.fromEntries(folderOrder(flagged, entry).map((f, k) => [f, k]));
    }
    // One strip at a time: the blockers strip comes first.
    if (!p.ask && flagged.length >= 2) {
      const count = pendingCount(flagged, entry, hard);
      if (count > 0) {
        p.orderAsk = { count };
      }
    }
  }
}

// The asked answers of a row that can become a Needs: line: the document's Needs lines are read, the line is not there yet,
// and it would not make a circle. `all` is the model's item list (ids are indexes).
export function answerOptions(links: readonly Link[], all: readonly BoardItem[], item: BoardItem): BoardItem[] {
  if (!readsNeeds(item.path)) {
    return [];
  }
  const held = new Set(links.filter((l) => l.fromProject === item.project && l.fromPath === item.path && !l.markOnly).map((l) => l.toProject + "\t" + l.toPath));
  return (item.after ?? [])
    .map((id) => all[id])
    .filter((o): o is BoardItem => o !== undefined && o.id !== item.id && !held.has(o.project + "\t" + o.path) && !wouldCircle([...links], item, o));
}
