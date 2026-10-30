import type { BoardItem, BoardModel, Light } from "./boardModelParts";
import { Link } from "./links";
import { SinceView, sinceKey } from "./sinceLast";

// The Gantt view's model: the open items and the finished ones they needed, grouped by project
// and laid out on a coarse work-order axis. The axis is dependency order, never days. Pure.

// Most finished documents kept as history.
export const MAX_FINISHED = 20;
// Width, in axis units, of a bar whose step minutes are not known.
const STANDARD = 30;
// The narrowest bar, in percent of the axis, so a short step stays visible.
const MIN_WIDTH = 4;

// A finished document that open work waited on, kept as a dimmed history row.
export interface FinishedDoc {
  project: string;
  path: string;
  title: string;
}

// The finished targets of the Needs links, once each, in link order.
export function finishedTargets(links: Link[], titleOf: (project: string, path: string) => string): FinishedDoc[] {
  const seen = new Set<string>();
  const out: FinishedDoc[] = [];
  for (const l of links) {
    if (l.state !== "done" || !l.toProject || !l.toPath || out.length >= MAX_FINISHED) {
      continue;
    }
    const k = l.toProject + "\t" + l.toPath;
    if (!seen.has(k)) {
      seen.add(k);
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

// Where each open item sits: it starts when everything it waits on has ended. A loop of
// Needs lines is cut where it closes.
function layout(items: BoardItem[], minutes: Map<string, number>): Map<number, { start: number; end: number }> {
  const byId = new Map(items.map((i) => [i.id, i]));
  const spans = new Map<number, { start: number; end: number }>();
  const visiting = new Set<number>();
  const place = (i: BoardItem): { start: number; end: number } => {
    const known = spans.get(i.id);
    if (known) {
      return known;
    }
    visiting.add(i.id);
    let start = 0;
    for (const w of i.waitsOn) {
      const dep = byId.get(w);
      if (dep && !visiting.has(w)) {
        start = Math.max(start, place(dep).end);
      }
    }
    visiting.delete(i.id);
    const span = { start, end: start + (minutes.get(i.project + "\t" + i.path) || STANDARD) };
    spans.set(i.id, span);
    return span;
  };
  items.forEach(place);
  return spans;
}

// The groups of the Gantt, one per project that has a row, finished documents first and then
// the open items in work order.
export function buildGantt(model: BoardModel, since?: SinceView): GanttGroup[] {
  const minutes = minutesByDoc(model);
  const spans = layout(model.items, minutes);
  const total = Math.max(STANDARD, ...[...spans.values()].map((s) => s.end));
  const marked = new Set(since?.marked ?? []);
  const pct = (n: number): number => Math.round((n / total) * 1000) / 10;
  const titles = new Map(model.items.map((i) => [i.id, i.title]));
  const groups: GanttGroup[] = [];
  for (const p of model.projects) {
    const done: GanttRow[] = (model.finished ?? [])
      .filter((f) => f.project === p.id)
      .map((f): GanttRow => ({ title: f.title, path: f.path, status: "green", start: 0, width: pct(STANDARD), minutes: 0, after: [], waits: [], changed: false }));
    const open: GanttRow[] = p.items
      .map((i) => ({ i, span: spans.get(i.id) ?? { start: 0, end: STANDARD } }))
      .sort((a, b) => a.span.start - b.span.start)
      .map(({ i, span }): GanttRow => {
        const width = Math.max(MIN_WIDTH, pct(span.end - span.start));
        return {
          id: i.id,
          title: i.title,
          path: i.path,
          status: i.status === "red" || i.stopping ? "red" : i.status,
          start: Math.min(pct(span.start), 100 - width),
          width,
          minutes: minutes.get(i.project + "\t" + i.path) ?? 0,
          after: i.waitsOn,
          waits: i.waitsOn.map((w) => titles.get(w) ?? ""),
          changed: marked.has(sinceKey(i)),
        };
      });
    if (done.length + open.length > 0) {
      groups.push({ id: p.id, name: p.name, light: p.light, open: open.length, rows: [...done, ...open] });
    }
  }
  return groups;
}
