import type { BoardItem, BoardModel } from "./boardModel";
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
}

// The change to save, or why nothing is saved: the text key of the notice and its values.
export type DropPlan =
  | { ok: true; kind: "status"; item: BoardItem; category: RuleCategory }
  | { ok: true; kind: "group"; item: BoardItem; name: string | undefined }
  | { ok: true; kind: "waits"; from: BoardItem; onto: BoardItem; target: string }
  | { ok: false; key: string; vars: Record<string, string> };

const no = (key: string, vars: Record<string, string> = {}): DropPlan => ({ ok: false, key, vars });

// The row at an id the page sent, only when it is exactly the row the model holds at that id.
function itemAt(model: BoardModel, id: unknown): BoardItem | undefined {
  const item = typeof id === "number" && Number.isInteger(id) ? model.items[id] : undefined;
  return item && item.id === id ? item : undefined;
}

// A row dropped on a status band (`to` is the status), on a group (`to` is the group id, empty for
// the documents in no group) or on another row's Waits on slot (`to` is that row's id: the other
// row then waits on the dragged one).
export function planDrop(m: { zone?: unknown; id?: unknown; to?: unknown }, model: BoardModel, ctx: DropContext): DropPlan {
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
