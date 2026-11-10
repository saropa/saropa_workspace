import type { BoardItem, BoardModel, Light } from "./boardModelParts";
import { applyOrder } from "./boardOrder";
import { NO_FOLDER } from "./orderAsk";
import { Link } from "./links";
import { layoutFor } from "./org/layout";
import type { GanttLayout } from "./types";
import { SinceView, sinceKey } from "./sinceLast";

// The Gantt view's model: the open items and the finished ones they needed, grouped by project
// and laid out on a coarse work-order axis. The axis is dependency order, never days. Pure.

// Most finished documents kept as history, per project.
export const MAX_FINISHED = 20;
// Most changed rows that get the outline; the tooltip still says "changed" on every one.
export const MAX_OUTLINED = 10;
// Step minutes assumed for a bar whose minutes are not known.
const STANDARD = 30;
// The shortest bar, as a share of the standard step, so a short step stays visible.
const MIN_SHARE = 0.35;

// A finished document that open work waited on, kept as a dimmed history row.
export interface FinishedDoc {
  project: string;
  path: string;
  title: string;
}

// The finished targets of the Needs links, once each, in link order, at most MAX_FINISHED per
// project. Reference documents are never history.
export function finishedTargets(links: Link[], titleOf: (project: string, path: string) => string, isReference: (project: string, path: string) => boolean = () => false): FinishedDoc[] {
  const seen = new Set<string>();
  const perProject = new Map<string, number>();
  const out: FinishedDoc[] = [];
  for (const l of links) {
    if (l.state !== "done" || !l.toProject || !l.toPath || (perProject.get(l.toProject) ?? 0) >= MAX_FINISHED || isReference(l.toProject, l.toPath)) {
      continue;
    }
    const k = l.toProject + "\t" + l.toPath;
    if (!seen.has(k)) {
      seen.add(k);
      perProject.set(l.toProject, (perProject.get(l.toProject) ?? 0) + 1);
      out.push({ project: l.toProject, path: l.toPath, title: titleOf(l.toProject, l.toPath) });
    }
  }
  return out;
}

export type GanttStatus = "red" | "amber" | "purple" | "green";

// One row: an open item (with its id) or a finished document (no id).
export interface GanttRow {
  id?: number;
  title: string;
  path: string;
  status: GanttStatus;
  // Position and width on the axis, in percent.
  start: number;
  width: number;
  // Minutes of all the document's open steps; 0 (no estimate) draws a dashed edge.
  minutes: number;
  // Ids of the open items this row waits on.
  after: number[];
  // Titles of those items, for the tooltip.
  waits: string[];
  // Titles of the items this row is after only because of the owner's answers (the "you said" lines).
  askedNames: string[];
  // Titles of the items this row follows only through others' answers; their presence draws the dotted chain mark.
  inferred: string[];
  // Changed since the last look.
  changed: boolean;
  // Drawn with the changed outline: at most MAX_OUTLINED rows, so a big change does not outline the whole page.
  outlined?: boolean;
  // A red-folder item the owner did not mark as blocking: amber, with the word "Address now".
  serious?: true;
  // The automatic folder group the row sits in (split layout only; absent for a flat project or an ungrouped row).
  sub?: { id: string; name: string };
  // The row is also in the Up next list.
  up?: true;
  // Name of the project, set only in the unified layout where the section no longer says it.
  project?: string;
}

export interface GanttGroup {
  id: string;
  name: string;
  light: Light;
  open: number;
  // Open rows that block the release (the red count a closed header always shows).
  blocks: number;
  // Finished rows left out of `rows` by the board-size layout.
  finishedCut: number;
  // Finished rows, then the open rows without a group, then each group's rows together.
  rows: GanttRow[];
}

// The rank of each open item: 0 when it waits on nothing, else one past the deepest thing it
// waits on. A loop of Needs lines is cut where it closes.
function ranks(items: BoardItem[]): Map<number, number> {
  const byId = new Map(items.map((i) => [i.id, i]));
  const out = new Map<number, number>();
  const visiting = new Set<number>();
  const place = (i: BoardItem): number => {
    const known = out.get(i.id);
    if (known !== undefined) {
      return known;
    }
    visiting.add(i.id);
    let rank = 0;
    for (const w of [...i.waitsOn, ...(i.after ?? [])]) {
      const dep = byId.get(w);
      if (dep && !visiting.has(w)) {
        rank = Math.max(rank, place(dep) + 1);
      }
    }
    visiting.delete(i.id);
    out.set(i.id, rank);
    return rank;
  };
  items.forEach(place);
  return out;
}

// A project's items with each group's members in the group's stored order, put back into the places the group's
// members already hold, so the other items stay where they are.
function inStoredOrder(items: BoardItem[], order: BoardModel["order"]): BoardItem[] {
  if (!order) {
    return items;
  }
  const out = [...items];
  const byGroup = new Map<string, number[]>();
  items.forEach((i, at) => i.group && byGroup.set(i.group.id, [...(byGroup.get(i.group.id) ?? []), at]));
  for (const places of byGroup.values()) {
    applyOrder(places.map((at) => items[at]), order).forEach((i, k) => {
      out[places[k]] = i;
    });
  }
  return out;
}

// The model the layout draws: Local keeps only the projects of the open workspace folders and their items.
export function shownModel(model: BoardModel, layout: GanttLayout): BoardModel {
  const hidden = new Set(model.projects.filter((p) => p.extra).map((p) => p.id));
  return layout !== "local" || hidden.size === 0 ? model : { ...model, projects: model.projects.filter((p) => !hidden.has(p.id)), items: model.items.filter((i) => !hidden.has(i.project)) };
}

// The groups of the Gantt, one per project that has a row, finished documents first and then
// the open items in work order.
export function buildGantt(model: BoardModel, since?: SinceView, layout: GanttLayout = "local", allName = "All projects"): GanttGroup[] {
  const shown = shownModel(model, layout);
  const split = buildSplit(shown, since, layout !== "unified");
  const groups = layout === "unified" && split.length > 1 ? unify(split, allName) : split;
  const up = new Set(upNext(shown).map((i) => i.id));
  for (const g of groups) {
    for (const r of g.rows) {
      if (r.id !== undefined && up.has(r.id)) {
        r.up = true;
      }
    }
  }
  // The changed rows of Up next are outlined first, then the others in display order.
  let left = MAX_OUTLINED;
  for (const first of [true, false]) {
    for (const g of groups) {
      for (const r of g.rows) {
        if (r.changed && !r.outlined && !!r.up === first && left > 0) {
          r.outlined = true;
          left--;
        }
      }
    }
  }
  return groups;
}

const STATUS_RANK: Record<GanttStatus, number> = { red: 0, purple: 1, amber: 2, green: 3 };
const LIGHT_ORDER: Light[] = ["no-go", "unverified", "go"];

// One section for every project: finished documents first, then the open rows in work order,
// each tagged with its project name. Blockers come first (red, then purple, then amber), then work order.
function withoutSub(r: GanttRow): GanttRow {
  const copy = { ...r };
  delete copy.sub;
  return copy;
}

// Lays the open rows (those with an id) end to end: each bar starts where the previous open bar ends, and never before
// the end of a row it waits on. Rows are placed in display order, but a row's unplaced dependencies are placed just before it, so a
// dependency shown later than its waiter still ends first; the rows keep their display order. Width follows the open
// minutes (STANDARD when unknown, never below the minimum), and the whole queue is scaled to fit 0 to 100. Finished rows
// are left as they are.
export function placeQueue(rows: GanttRow[]): void {
  const floor = STANDARD * MIN_SHARE;
  const byId = new Map(rows.filter((r) => r.id !== undefined).map((r) => [r.id!, r]));
  const ends = new Map<number, number>();
  const spans = new Map<GanttRow, { start: number; end: number }>();
  const visiting = new Set<GanttRow>();
  let cursor = 0;
  // Display order; before a row is placed, the rows it waits on that are not placed yet go first (cycles are cut).
  const place = (r: GanttRow): void => {
    if (spans.has(r) || visiting.has(r)) {
      return;
    }
    visiting.add(r);
    for (const a of r.after) {
      const dep = byId.get(a);
      if (dep) {
        place(dep);
      }
    }
    visiting.delete(r);
    const start = Math.max(cursor, ...r.after.map((a) => ends.get(a) ?? 0));
    cursor = start + Math.max(floor, r.minutes || STANDARD);
    ends.set(r.id!, cursor);
    spans.set(r, { start, end: cursor });
  };
  rows.filter((r) => r.id !== undefined).forEach(place);
  const k = cursor > 0 ? 100 / cursor : 0;
  rows.forEach((r) => {
    const span = spans.get(r);
    if (span) {
      r.start = Math.min(99.9, Math.round(span.start * k * 10) / 10);
      r.width = Math.min(100 - r.start, Math.max(0.1, Math.round(span.end * k * 10) / 10 - r.start));
    }
  });
}

function unify(groups: GanttGroup[], allName: string): GanttGroup[] {
  const tagged = groups.flatMap((g) => g.rows.map((r) => ({ ...withoutSub(r), project: g.name })));
  const done = tagged.filter((r) => r.id === undefined);
  const open = tagged.filter((r) => r.id !== undefined).sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status]);
  const light = LIGHT_ORDER.find((l) => groups.some((g) => g.light === l)) ?? "unverified";
  placeQueue(open);
  return [{ id: "all", name: allName, light, open: open.length, blocks: open.filter((r) => r.status === "red").length, finishedCut: groups.reduce((n, g) => n + g.finishedCut, 0), rows: [...done, ...open] }];
}

// `model` is already what the layout draws (see shownModel), so the bar scale counts only its items.
function buildSplit(model: BoardModel, since: SinceView | undefined, perProject: boolean): GanttGroup[] {
  const rank = ranks(model.items);
  const boardSlots = Math.max(0, ...rank.values()) + 1;
  const marked = new Set(since?.marked ?? []);
  const titles = new Map(model.items.map((i) => [i.id, i.title]));
  const groups: GanttGroup[] = [];
  const keepDone = layoutFor(model.items.length).finished;
  for (const p of model.projects) {
    // The slot is only the width of a finished row; open rows are placed as a work queue below.
    const slots = perProject ? Math.max(0, ...p.items.map((i) => rank.get(i.id) ?? 0)) + 1 : boardSlots;
    const slot = Math.round(1000 / slots) / 10;
    const allDone: GanttRow[] = (model.finished ?? [])
      .filter((f) => f.project === p.id)
      .map((f): GanttRow => ({ title: f.title, path: f.path, status: "green", start: 0, width: slot, minutes: 0, after: [], waits: [], askedNames: [], inferred: [], changed: false }));
    // A big board keeps fewer finished rows: the last two, or only a count.
    const done = keepDone === "all" ? allDone : keepDone === "last2" ? allDone.slice(-2) : [];
    // Work order first; then a group with a stored order takes that order inside the places its members hold.
    const open: GanttRow[] = inStoredOrder(
      p.items
        .map((i) => ({ i, rank: rank.get(i.id) ?? 0 }))
        .sort((a, b) => a.rank - b.rank || priorOrder(a.i, b.i))
        .map((x) => x.i),
      model.order,
    )
      .map((i): GanttRow => {
        const known = i.openMinutes ?? 0;
        return {
          id: i.id,
          title: i.title,
          path: i.path,
          status: i.blocks ? "red" : i.status === "red" ? "amber" : i.status,
          start: 0,
          width: 0,
          minutes: known,
          after: [...i.waitsOn, ...(i.after ?? [])],
          waits: i.waitsOn.map((w) => titles.get(w)).filter((n): n is string => n !== undefined),
          askedNames: (i.after ?? []).map((w) => titles.get(w)).filter((n): n is string => n !== undefined),
          inferred: (i.inferred ?? []).map((w) => titles.get(w)).filter((n): n is string => n !== undefined),
          changed: marked.has(sinceKey(i)),
          ...(i.status === "red" && !i.blocks ? { serious: true as const } : {}),
          ...(i.group && !i.group.flat ? { sub: { id: i.group.id, name: i.group.name } } : {}),
        };
      });
    if (allDone.length + open.length > 0) {
      const ordered = gathered(open, p.folderRank);
      placeQueue(ordered);
      groups.push({ id: p.id, name: p.name, light: p.light, open: open.length, blocks: open.filter((r) => r.status === "red").length, finishedCut: allDone.length - done.length, rows: [...done, ...ordered] });
    }
  }
  return groups;
}

// The open rows with the groups that hold a blocker first, then the ungrouped ones, then each other group's rows together (groups with a blocker first,
// then in order of first appearance), so a group can fold under one sub-header. Order inside each part is kept.
function gathered(open: GanttRow[], folderRank?: Record<string, number>): GanttRow[] {
  const order: string[] = [];
  const red = new Set<string>();
  for (const r of open) {
    if (r.sub) {
      if (!order.includes(r.sub.id)) {
        order.push(r.sub.id);
      }
      if (r.status === "red") {
        red.add(r.sub.id);
      }
    }
  }
  // The owner's folder answers order the sections; folders they did not rank keep their order of appearance.
  const rank = (id: string): number => (red.has(id) ? 0 : 1000) + (folderRank?.[id] ?? 500) + order.indexOf(id) / 1000;
  const hot = (r: GanttRow): boolean => red.has(r.sub!.id);
  const grouped = open.filter((r) => r.sub).sort((a, b) => rank(a.sub!.id) - rank(b.sub!.id));
  return [...grouped.filter(hot), ...open.filter((r) => !r.sub), ...grouped.filter((r) => !hot(r))];
}

// In an answered project two blockers of one rank are drawn most severe first, then the one more items wait on.
function priorOrder(a: BoardItem, b: BoardItem): number {
  return a.answered && b.answered && a.blocks && b.blocks ? (SEV_ORDER[a.severity ?? "medium"] ?? 3) - (SEV_ORDER[b.severity ?? "medium"] ?? 3) || b.blocksCount - a.blocksCount : 0;
}

const SEV_ORDER: Record<string, number> = { extreme: 0, critical: 1, high: 2, medium: 3, low: 4 };
// Most rows in Up next.
export const UP_NEXT = 5;

// The few items to work on first: what is in progress, then the blockers that wait on nothing; each part with what
// unblocks most first, then severity, then the shortest. An item appears once; nothing is padded in.
export function upNext(model: BoardModel, n = UP_NEXT): BoardItem[] {
  const folderRanks = new Map(model.projects.filter((p) => p.folderRank).map((p) => [p.id, p.folderRank!]));
  const folder = (i: BoardItem): number => folderRanks.get(i.project)?.[i.group?.id ?? NO_FOLDER] ?? 0;
  const cmp = (a: BoardItem, b: BoardItem): number =>
    folder(a) - folder(b) ||
    b.blocksCount - a.blocksCount ||
    (SEV_ORDER[a.severity ?? "medium"] ?? 3) - (SEV_ORDER[b.severity ?? "medium"] ?? 3) ||
    (a.openMinutes || STANDARD) - (b.openMinutes || STANDARD) ||
    a.project.localeCompare(b.project) ||
    a.path.localeCompare(b.path);
  const going = model.items.filter((i) => i.status === "purple").sort(cmp);
  const free = model.items.filter((i) => i.status !== "purple" && i.blocks && i.waitsOn.length === 0 && (i.after ?? []).length === 0).sort(cmp);
  return [...going, ...free].slice(0, n);
}

// How many items are in progress on the whole board.
export const inProgressCount = (model: BoardModel): number => model.items.filter((i) => i.status === "purple").length;
