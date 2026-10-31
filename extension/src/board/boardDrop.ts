import type { BoardItem, BoardModel } from "./boardModel";
import { MAX_ORDER, applyOrder } from "./boardOrder";
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
  | { ok: true; kind: "order"; item: BoardItem; paths: string[] }
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
  if (to !== undefined && (typeof to !== "string" || !model.items.some((i) => i.group?.id === to))) {
    return no("releaseBoard.drop.gone");
  }
  if (!group) {
    return no("releaseBoard.reorder.noGroup", { title: item.title });
  }
  if (to !== undefined && group.id !== to) {
    return no("releaseBoard.reorder.otherGroup", { title: item.title });
  }
  // Only a group listed by hand has a stored name; the name on the page can be clipped or made unique, so matching uses the stored one.
  if (!group.byUser || group.stored === undefined) {
    return no("releaseBoard.reorder.autoGroup", { title: item.title, name: group.name });
  }
  const rows = applyOrder(model.items.filter((i) => i.group?.id === group.id), model.order);
  if (new Set(rows.map((i) => i.project)).size > 1) {
    return no("releaseBoard.reorder.mixed", { name: group.name });
  }
  const key = item.project + "/" + item.path;
  const name = tidyGroupName(group.stored);
  const wild = (ctx.groups ?? []).some((g) => tidyGroupName(g.name) === name && g.match.some((m) => /[*?[{]/.test(m) && globToRegExp(m).test(key)));
  if (wild) {
    return no("releaseBoard.reorder.claimed", { title: item.title, name: group.name });
  }
  const from = rows.indexOf(item);
  const gap = step === undefined ? at : from + (step < 0 ? -1 : 2);
  if (gap === undefined || !Number.isInteger(gap) || gap < 0 || gap > rows.length) {
    // The first or last row pressed further out: said aloud, not saved.
    return step === undefined || gap === undefined || !Number.isInteger(gap) ? no("releaseBoard.drop.gone") : no(step < 0 ? "releaseBoard.reorder.firstSay" : "releaseBoard.reorder.lastSay", { title: item.title });
  }
  const place = gap > from ? gap - 1 : gap;
  if (place === from) {
    return no("");
  }
  if (rows.length > MAX_ORDER) {
    return no("releaseBoard.reorder.full");
  }
  const next = rows.filter((i) => i !== item);
  next.splice(place, 0, item);
  return { ok: true, kind: "order", item, paths: next.map((i) => i.path) };
}

// The rows of the item's group in the order the page draws them, or the text key of why the group has no such order.
function groupRows(item: BoardItem, model: BoardModel): BoardItem[] | string {
  const group = item.group;
  if (!group) {
    return "releaseBoard.reorder.noGroup";
  }
  if (!group.byUser || group.stored === undefined) {
    return "releaseBoard.reorder.autoGroup";
  }
  const rows = applyOrder(model.items.filter((i) => i.group?.id === group.id), model.order);
  return new Set(rows.map((i) => i.project)).size > 1 ? "releaseBoard.reorder.mixed" : rows;
}

// `from` (the row that lists the Needs) comes to wait on `onto`.
function planWaits(from: BoardItem, onto: BoardItem, model: BoardModel, ctx: DropContext): DropPlan {
  if (from.id === onto.id) {
    return no("releaseBoard.drop.self");
  }
  if (!readsNeeds(from.path)) {
    return no("releaseBoard.drop.noNeeds", { title: from.title });
  }
  if (model.links.some((l) => l.fromProject === from.project && l.fromPath === from.path && l.toProject === onto.project && l.toPath === onto.path)) {
    return no("releaseBoard.drop.already", { from: from.title, to: onto.title });
  }
  if (wouldCircle(model.links, from, onto)) {
    return no("releaseBoard.needs.circle", { from: from.title, to: onto.title });
  }
  const target = needTarget(ctx.rows, ctx.projects, from, onto);
  return target === undefined ? no("releaseBoard.needs.unnamed", { to: onto.title }) : { ok: true, kind: "waits", from, onto, target };
}

// A row dropped on a status band (`to` is the status), on a group (`to` is the group id, empty for
// the documents in no group) or on another row's Waits on slot (`to` is that row's id: the other
// row then waits on the dragged one), or in a gap between the rows of a group (`to` is the group id,
// `at` the gap) or moved a place by the keyboard (`to` is -1 or 1), or chained with the row above it
// (zone `chain`: `to` 1 makes the row wait on the row above, -1 makes the row above wait on it).
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
    // The name written is the stored one: the name on the page can be clipped or made unique.
    return group.byUser && group.stored !== undefined ? { ok: true, kind: "group", item, name: group.stored } : no("releaseBoard.drop.autoGroup", { title: item.title, name: group.name });
  }
  if (m.zone === "gap" && typeof m.at === "number") {
    return planReorder(item, model, ctx, m.to, m.at, undefined);
  }
  if (m.zone === "move" && (m.to === -1 || m.to === 1)) {
    return planReorder(item, model, ctx, undefined, undefined, m.to);
  }
  if (m.zone === "waits") {
    const from = itemAt(model, m.to);
    return from ? planWaits(from, item, model, ctx) : no("releaseBoard.drop.gone");
  }
  if (m.zone === "chain" && (m.to === -1 || m.to === 1)) {
    // The row above is read here from the order the move arrows use; the page names the row only.
    const rows = groupRows(item, model);
    if (typeof rows === "string") {
      return no(rows, { title: item.title, name: item.group?.name ?? "" });
    }
    const above = rows[rows.indexOf(item) - 1];
    if (!above) {
      return no("releaseBoard.reorder.firstSay", { title: item.title });
    }
    // Right: this row waits on the row above. Left: the row above waits on this row.
    return m.to === 1 ? planWaits(item, above, model, ctx) : planWaits(above, item, model, ctx);
  }
  return no("releaseBoard.drop.gone");
}
