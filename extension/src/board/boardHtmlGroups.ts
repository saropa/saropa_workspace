import type { BoardItem, BoardModel, GroupView } from "./boardModel";
import { SEVERITY_LEVELS } from "./ruleAssign";
import { BoardStrings, escapeHtml, pillify, pl, tip } from "./boardHtmlUtil";
import { blocksNow, kebab } from "./boardHtmlMenus";
import { SHOWN_ROWS, groupLabel, groupStripe, groupTip, itemCounts, row } from "./boardHtmlRows";
import { openGroups } from "./org/layout";
import { groupZone } from "./boardHtmlDrag";
import type { GroupBy } from "./types";

// The board laid out as cards of groups, of statuses or of severities (the Group by menu).
// Each card holds the open documents it names and starts folded unless one of them blocks the
// release. Pure.

// The layouts drawn here, as cards of documents across every project.
export const CARD_GROUP_BYS: readonly GroupBy[] = ["group", "status", "severity"];

export interface Card {
  // Tells the card apart from the others of the same layout.
  id: string;
  name: string;
  items: BoardItem[];
  // The group is listed by hand (true), found by the board (false), or the card is not a group (undefined).
  byUser?: boolean;
  // A group card: the id of its first document, which names the group for the hand-off menu.
  handoff?: number;
  // The group as drawn (emoji, stripe colour, reasons); absent for the other layouts and for the documents in no group.
  group?: GroupView;
}

// The documents of a model under the cards of one layout, in the order they are drawn.
export function cardsFor(model: BoardModel, by: GroupBy, t: BoardStrings): Card[] {
  const cards = new Map<string, Card>();
  const put = (id: string, name: string, i: BoardItem, extra: Partial<Card> = {}): void => {
    const c = cards.get(id) ?? { id, name, items: [], ...extra };
    c.items.push(i);
    cards.set(id, c);
  };
  for (const i of model.items) {
    if (by === "group") {
      i.group ? put(i.group.id, i.group.name, i, { byUser: i.group.byUser === true, handoff: i.id, group: i.group }) : put("", pl(t, "groupNoGroup"), i);
    } else if (by === "status") {
      put(i.status, i.status === "red" ? t.resolveNow : i.status === "purple" ? t.inProgress : t.workOn, i);
    } else {
      put(i.severity ?? "", i.severity ? pl(t, "sev." + i.severity) : pl(t, "groupNoSeverity"), i);
    }
  }
  const all = [...cards.values()];
  if (by === "group") {
    // Groups with a blocker first, then by name; the documents in no group last.
    const rank = (c: Card): number => (c.id === "" ? 2 : c.items.some(blocksNow) ? 0 : 1);
    return all.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  }
  const order: string[] = by === "status" ? ["red", "purple", "amber"] : [...SEVERITY_LEVELS, ""];
  return all.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
}

// The group cards that start open. A project with many documents opens only the groups with the most
// blockers (its layout); every other card opens when it holds a blocker.
function openCards(model: BoardModel, cards: Card[]): Set<string> {
  const open = new Set<string>();
  const byProject = new Map<string, Card[]>();
  for (const c of cards) {
    if (c.group) {
      const p = c.items[0].project;
      (byProject.get(p) ?? byProject.set(p, []).get(p)!).push(c);
    } else if (c.items.some(blocksNow)) {
      open.add(c.id);
    }
  }
  for (const [p, list] of byProject) {
    const layout = model.orgLayouts?.[p];
    const ids = layout ? openGroups(layout, list.map((c) => ({ id: c.id, blockers: c.items.filter(blocksNow).length }))) : new Set(list.filter((c) => c.items.some(blocksNow)).map((c) => c.id));
    ids.forEach((id) => open.add(id));
  }
  return open;
}

function card(c: Card, by: GroupBy, names: Map<string, string>, t: BoardStrings, multi: boolean, open: boolean, limit: number): string {
  const worst = c.items.some(blocksNow) ? "red" : c.items.some((i) => i.status === "purple") ? "purple" : "amber";
  const tag = c.byUser === undefined ? "" : `<span class="tag" ${tip(t, c.byUser ? "groupByYouTip" : "groupAutoTip")}>${escapeHtml(pl(t, c.byUser ? "groupByYou" : "groupAuto"))}</span>`;
  const menu = c.handoff === undefined ? "" : kebab(t, "scope", `group:${c.handoff}`, c.name);
  const line = pl(t, "groupCard", { name: c.name, count: c.items.length });
  const head = c.group ? groupTip(c.group, line, !open) : tip(t, "groupCard", { name: c.name, count: c.items.length });
  const stripe = c.group ? groupStripe(c.group) : "";
  // A group listed by hand, or the documents in no group, takes a dropped row.
  const zone = by === "group" && (c.byUser === true || c.id === "") ? groupZone(t, c.id, c.name) : "";
  const parts = c.items.map((i) => row(i, names.get(i.project) ?? i.project, t, false));
  // Rows past the limit wait behind a button; the page script reveals them.
  const rest = parts.length - limit;
  const rows = rest > 0 ? `${parts.slice(0, limit).join("")}<button type="button" class="sec" data-show-more ${tip(t, "showMoreTip")}>${pillify(t, escapeHtml(pl(t, "showMore", { count: rest })))}</button><div hidden>${parts.slice(limit).join("")}</div>` : parts.join("");
  // With several projects shown, a card says which project(s) it holds, so same-named cards differ.
  const projects = multi ? [...new Set(c.items.map((i) => names.get(i.project) ?? i.project))].sort() : [];
  const where = projects.length > 0 ? `<span class="tag">${escapeHtml(projects.join(", "))}</span>` : "";
  const label = c.group ? groupLabel(c.group) : escapeHtml(c.name);
  // The fold is remembered per card and per open state, so a new blocker opens the card again.
  return `<details class="box pcard" data-sec="${escapeHtml(`card:${by}:${c.id}:${open ? 1 : 0}`)}"${open ? " open" : ""}><summary class="sh"${stripe} ${head}${zone}><b class="pn" ${head}><i class="sq ${worst}" aria-hidden="true"></i> ${label}</b>${where}${tag}${itemCounts(c.items, c.name, t)}${menu}</summary>${rows}</details>`;
}

// The cards of a layout, or nothing when no document is open.
export function groupCards(model: BoardModel, by: GroupBy, names: Map<string, string>, t: BoardStrings): string {
  const multi = new Set(model.items.map((i) => i.project)).size > 1;
  const cards = cardsFor(model, by, t);
  const group = by === "group";
  const open = group ? openCards(model, cards) : undefined;
  return cards
    .map((c) => {
      const layout = group && c.group ? model.orgLayouts?.[c.items[0].project] : undefined;
      return card(c, by, names, t, multi, open ? open.has(c.id) : c.items.some(blocksNow), layout ? (layout.rowLimit ?? Infinity) : SHOWN_ROWS);
    })
    .join("");
}
