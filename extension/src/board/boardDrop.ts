import type { BoardItem, BoardModel } from "./boardModel";
import { applyOrder } from "./boardOrder";
import { globToRegExp } from "./glob";
import { tidyGroupName } from "./groups";
import { needTarget, wouldCircle } from "./links";
import { readsNeeds } from "./docFacts";
import type { RuleCategory } from "./ruleAssign";
import type { Classified, ProjectDef } from "./types";

// Drag and drop on the board: what a dropped row means. The page names the dragged row by its
// item id and the drop zone by a group id, a status or another row's id; every id is resolved
// here against the model the page was painted from, so a stale or invented id changes nothing.
// Pure.

// What the host needs besides the model: the scanned rows and projects (to name a Needs target)
// and the status categories of the rules.
export interface DropContext {
  rows: Classified[];
  projects: ProjectDef[];
  categories: RuleCategory[];
  // The groups listed by hand in the rules file.
  groups?: Array<{ name: string; match: string[] }>;
}

// The change to save, or why nothing is saved: the text key of the notice and its values. An empty
// key is a refusal with no notice (a row dropped where it already is).
export type DropPlan =
  | { ok: true; kind: "status"; item: BoardItem; category: RuleCategory }
  | { ok: true; kind: "group"; item: BoardItem; name: string | undefined }
  | { ok: true; kind: "waits"; from: BoardItem; onto: BoardItem; target: string }
  | { ok: true; kind: "order"; item: BoardItem; paths: string[]; known: Set<string> }
  | { ok: false; key: string; vars: Record<string, string> };

const no = (key: string, vars: Record<string, string> = {}): DropPlan => ({ ok: false, key, vars });

// The row at an id the page sent, only when it is exactly the row the model holds at that id.
function itemAt(model: BoardModel, id: unknown): BoardItem | undefined {
  const item = typeof id === "number" && Number.isInteger(id) ? model.items[id] : undefined;
  return item && item.id === id ? item : undefined;
}

// A row moved to a place in its group: `at` is the gap it was dropped in (0 is before the first row,
// the row count is after the last), or `step` is -1 or 1 for one place up or down. Rows keep their
// order inside a group listed by hand, in one project, that no pattern claims.
function planReorder(item: BoardItem, model: BoardModel, ctx: DropContext, to: unknown, at: number | undefined, step: number | undefined): DropPlan {
  const group = item.group;
  if (typeof to === "string" && !model.items.some((i) => i.group?.id === to)) {
    return no("releaseBoard.drop.gone");
  }
  if (!group || (typeof to === "string" && group.id !== to)) {
    return no("releaseBoard.reorder.noGroup", { title: item.title });
  }
  if (!group.byUser) {
    return no("releaseBoard.reorder.autoGroup", { title: item.title, name: group.name });
  }
  const rows = applyOrder(model.items.filter((i) => i.group?.id === group.id), model.order);
  if (new Set(rows.map((i) => i.project)).size > 1) {
    return no("releaseBoard.reorder.mixed", { name: group.name });
  }
  const key = item.project + "/" + item.path;
  const name = tidyGroupName(group.name);
  const wild = (ctx.groups ?? []).some((g) => tidyGroupName(g.name) === name && g.match.some((m) => /[*?[{]/.test(m) && globToRegExp(m).test(key)));
  if (wild) {
    return no("releaseBoard.reorder.claimed", { title: item.title, name: group.name });
  }
  const from = rows.indexOf(item);
  const gap = step === undefined ? at : from + (step < 0 ? -1 : 2);
  if (gap === undefined || !Number.isInteger(gap) || gap < 0 || gap > rows.length) {
    return step === undefined ? no("releaseBoard.drop.gone") : no("");
  }
  const place = gap > from ? gap - 1 : gap;
  if (place === from) {
    return no("");
  }
  const next = rows.filter((i) => i !== item);
  next.splice(place, 0, item);
  return { ok: true, kind: "order", item, paths: next.map((i) => i.path), known: new Set(ctx.rows.filter((r) => r.project === item.project).map((r) => r.path)) };
}

// A row dropped on a status band (`to` is the status), on a group (`to` is the group id, empty for
// the documents in no group) or on another row's Waits on slot (`to` is that row's id: the other
// row then waits on the dragged one), or in a gap between the rows of a group (`to` is the group id,
// `at` the gap) or moved a place by the keyboard (`to` is -1 or 1).
export function planDrop(m: { zone?: unknown; id?: unknown; to?: unknown; at?: unknown }, model: BoardModel, ctx: DropContext): DropPlan {
  const item = itemAt(model, m.id);
  if (!item) {
    return no("releaseBoard.drop.gone");
  }
  if (m.zone === "band" && typeof m.to === "string") {
    if (item.status === m.to) {
      return no("releaseBoard.drop.same", { title: item.title });
    }
    // The plainest category of that status: one without a kind or note when the rules have it.
    const options = ctx.categories.filter((c) => c.status === m.to);
    const category = options.find((c) => c.kind === undefined && c.note === undefined) ?? options[0];
    return category ? { ok: true, kind: "status", item, category } : no("releaseBoard.drop.noStatus", { title: item.title });
  }
  if (m.zone === "group" && typeof m.to === "string") {
    if (m.to === "") {
      return item.group === undefined ? no("releaseBoard.drop.sameGroup", { title: item.title }) : { ok: true, kind: "group", item, name: undefined };
    }
    const group = model.items.find((i) => i.group?.id === m.to)?.group;
    if (!group) {
      return no("releaseBoard.drop.gone");
    }
    if (item.group?.id === m.to) {
      return no("releaseBoard.drop.sameGroup", { title: item.title });
    }
    // Only a group listed by hand takes a document: a found group is not a name the rules file holds.
    return group.byUser ? { ok: true, kind: "group", item, name: group.name } : no("releaseBoard.drop.autoGroup", { title: item.title, name: group.name });
  }
  if (m.zone === "gap" && typeof m.at === "number") {
    return planReorder(item, model, ctx, m.to, m.at, undefined);
  }
  if (m.zone === "move" && (m.to === -1 || m.to === 1)) {
    return planReorder(item, model, ctx, undefined, undefined, m.to);
  }
  if (m.zone === "waits") {
    const from = itemAt(model, m.to);
    if (!from) {
      return no("releaseBoard.drop.gone");
    }
    if (from.id === item.id) {
      return no("releaseBoard.drop.self");
    }
    if (!readsNeeds(from.path)) {
      return no("releaseBoard.drop.noNeeds", { title: from.title });
    }
    if (model.links.some((l) => l.fromProject === from.project && l.fromPath === from.path && l.toProject === item.project && l.toPath === item.path)) {
      return no("releaseBoard.drop.already", { from: from.title, to: item.title });
    }
    if (wouldCircle(model.links, from, item)) {
      return no("releaseBoard.needs.circle", { from: from.title, to: item.title });
    }
    const target = needTarget(ctx.rows, ctx.projects, from, item);
    return target === undefined ? no("releaseBoard.needs.unnamed", { to: item.title }) : { ok: true, kind: "waits", from, onto: item, target };
  }
  return no("releaseBoard.drop.gone");
}
