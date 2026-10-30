import type { BoardItem, BoardModel } from "./boardModel";
import { SEVERITY_LEVELS } from "./ruleAssign";
import { BoardStrings, escapeHtml, pillify, pl, tip, titleAttr } from "./boardHtmlUtil";
import { blocksNow, kebab } from "./boardHtmlMenus";
import { LIST_CAP, itemCounts, row } from "./boardHtmlRows";
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
      i.group ? put(i.group.id, i.group.name, i, { byUser: i.group.byUser === true, handoff: i.id }) : put("", pl(t, "groupNoGroup"), i);
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
    return all.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  }
  const order: string[] = by === "status" ? ["red", "purple", "amber"] : [...SEVERITY_LEVELS, ""];
  return all.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
}

function card(c: Card, by: GroupBy, names: Map<string, string>, t: BoardStrings): string {
  const open = c.items.some(blocksNow);
  const worst = open ? "red" : c.items.some((i) => i.status === "purple") ? "purple" : "amber";
  const tag = c.byUser === undefined ? "" : `<span class="tag" ${tip(t, c.byUser ? "groupByYouTip" : "groupAutoTip")}>${escapeHtml(pl(t, c.byUser ? "groupByYou" : "groupAuto"))}</span>`;
  const menu = c.handoff === undefined ? "" : kebab(t, "scope", `group:${c.handoff}`, c.name);
  const head = tip(t, "groupCard", { name: c.name, count: c.items.length });
  const rows = c.items.slice(0, LIST_CAP).map((i) => row(i, names.get(i.project) ?? i.project, t, false)).join("");
  const left = c.items.length - LIST_CAP;
  const more = left > 0 ? `<p class="note" ${titleAttr(t.more.replace("{count}", String(left)))}>${pillify(t, escapeHtml(t.more.replace("{count}", String(left))))}</p>` : "";
  // The fold is remembered per card and per blocker state, so a new blocker opens the card again.
  return `<details class="box pcard" data-sec="${escapeHtml(`card:${by}:${c.id}:${open ? 1 : 0}`)}"${open ? " open" : ""}><summary class="sh" ${head}><b class="pn" ${head}><i class="sq ${worst}" aria-hidden="true"></i> ${escapeHtml(c.name)}</b>${tag}${itemCounts(c.items, c.name, t)}${menu}</summary>${rows}${more}</details>`;
}

// The cards of a layout, or nothing when no document is open.
export function groupCards(model: BoardModel, by: GroupBy, names: Map<string, string>, t: BoardStrings): string {
  return cardsFor(model, by, t).map((c) => card(c, by, names, t)).join("");
}
