import type { BoardItem, BoardModel, Light } from "./boardModelParts";
import { applyOrder } from "./boardOrder";
import { Link } from "./links";
import type { GanttLayout } from "./types";
import { SinceView, sinceKey } from "./sinceLast";

// The Gantt view's model: the open items and the finished ones they needed, grouped by project
// and laid out on a coarse work-order axis. The axis is dependency order, never days. Pure.

// Most finished documents kept as history, per project.
export const MAX_FINISHED = 20;
// Step minutes assumed for a bar whose minutes are not known.
const STANDARD = 30;
// The shortest bar, as a share of its slot, so a short step stays visible.
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
  // Step minutes known for the row; 0 draws a dashed edge.
  minutes: number;
  // Ids of the open items this row waits on.
  after: number[];
  // Titles of those items, for the tooltip.
  waits: string[];
  // Changed since the last look.
  changed: boolean;
  // Name of the project, set only in the unified layout where the section no longer says it.
  project?: string;
}

export interface GanttGroup {
  id: string;
  name: string;
  light: Light;
  open: number;
  rows: GanttRow[];
}

// Step minutes per document from the Sittings data, keyed by project and path.
function minutesByDoc(model: BoardModel): Map<string, number> {
  const m = new Map<string, number>();
  for (const l of model.sittings?.lines ?? []) {
    const k = l.project + "\t" + l.path;
    m.set(k, (m.get(k) ?? 0) + l.minutes);
  }
  return m;
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
    for (const w of i.waitsOn) {
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

// The groups of the Gantt, one per project that has a row, finished documents first and then
// the open items in work order.
export function buildGantt(model: BoardModel, since?: SinceView, layout: GanttLayout = "split", allName = "All projects"): GanttGroup[] {
  const split = buildSplit(model, since);
  return layout === "unified" && split.length > 1 ? unify(split, allName) : split;
}

const LIGHT_ORDER: Light[] = ["no-go", "unverified", "go"];

// One section for every project: finished documents first, then the open rows in work order,
// each tagged with its project name.
function unify(groups: GanttGroup[], allName: string): GanttGroup[] {
  const tagged = groups.flatMap((g) => g.rows.map((r) => ({ ...r, project: g.name })));
  const done = tagged.filter((r) => r.id === undefined);
  const open = tagged.filter((r) => r.id !== undefined).sort((a, b) => a.start - b.start);
  const light = LIGHT_ORDER.find((l) => groups.some((g) => g.light === l)) ?? "unverified";
  return [{ id: "all", name: allName, light, open: open.length, rows: [...done, ...open] }];
}

function buildSplit(model: BoardModel, since?: SinceView): GanttGroup[] {
  const minutes = minutesByDoc(model);
  const rank = ranks(model.items);
  // One slot per rank: a bar stays inside its slot, so what waits always starts after what it
  // waits on has ended, however long the chain.
  const slots = Math.max(0, ...rank.values()) + 1;
  const slot = Math.round(1000 / slots) / 10;
  const longest = Math.max(STANDARD, ...model.items.map((i) => minutes.get(i.project + "\t" + i.path) ?? 0));
  const marked = new Set(since?.marked ?? []);
  const titles = new Map(model.items.map((i) => [i.id, i.title]));
  const groups: GanttGroup[] = [];
  for (const p of model.projects) {
    const done: GanttRow[] = (model.finished ?? [])
      .filter((f) => f.project === p.id)
      .map((f): GanttRow => ({ title: f.title, path: f.path, status: "green", start: 0, width: slot, minutes: 0, after: [], waits: [], changed: false }));
    // Work order first; then a group with a stored order takes that order inside the places its members hold.
    const open: GanttRow[] = inStoredOrder(
      p.items
        .map((i) => ({ i, rank: rank.get(i.id) ?? 0 }))
        .sort((a, b) => a.rank - b.rank)
        .map((x) => x.i),
      model.order,
    )
      .map((i) => ({ i, rank: rank.get(i.id) ?? 0 }))
      .map(({ i, rank: r }): GanttRow => {
        const known = minutes.get(i.project + "\t" + i.path) ?? 0;
        const share = Math.min(1, Math.max(MIN_SHARE, (known || STANDARD) / longest));
        return {
          id: i.id,
          title: i.title,
          path: i.path,
          status: i.status === "red" || i.stopping ? "red" : i.status,
          start: Math.round(r * slot * 10) / 10,
          width: Math.round(slot * share * 10) / 10,
          minutes: known,
          after: i.waitsOn,
          waits: i.waitsOn.map((w) => titles.get(w)).filter((n): n is string => n !== undefined),
          changed: marked.has(sinceKey(i)),
        };
      });
    if (done.length + open.length > 0) {
      groups.push({ id: p.id, name: p.name, light: p.light, open: open.length, rows: [...done, ...open] });
    }
  }
  return groups;
}
