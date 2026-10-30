import type { BoardItem, BoardModel, GroupView } from "./boardModel";
import { SEVERITY_LEVELS } from "./ruleAssign";
import { BoardStrings, escapeHtml, pillify, pl, tip } from "./boardHtmlUtil";
import { blocksNow, kebab } from "./boardHtmlMenus";
import { SHOWN_ROWS, groupLabel, groupStripe, groupTip, itemCounts, row } from "./boardHtmlRows";
import { Layout, openGroups } from "./org/layout";
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
  // Every document of the card, sub-groups included (the counts and the colour of the square count them all).
  items: BoardItem[];
  // The documents drawn as rows of this card itself (not in a sub-group).
  direct: BoardItem[];
  // Sub-groups, drawn inside the card and closed until opened.
  subs?: Card[];
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
  const subs = new Map<string, Map<string, Card>>();
  const put = (id: string, name: string, i: BoardItem, extra: Partial<Card> = {}, sub?: GroupView): void => {
    const c = cards.get(id) ?? { id, name, items: [], direct: [], ...extra };
    c.items.push(i);
    if (sub) {
      const m = subs.get(id) ?? subs.set(id, new Map()).get(id)!;
      const s = m.get(sub.id) ?? m.set(sub.id, { id: sub.id, name: sub.name, items: [], direct: [], byUser: sub.byUser === true, handoff: i.id, group: sub }).get(sub.id)!;
      s.items.push(i);
      s.direct.push(i);
    } else {
      c.direct.push(i);
    }
    cards.set(id, c);
  };
  for (const i of model.items) {
    if (by === "group") {
      const g = i.group;
      const top = g?.parentView ?? g;
      g && top ? put(top.id, top.name, i, { byUser: top.byUser === true, handoff: i.id, group: top }, top === g ? undefined : g) : put("", pl(t, "groupNoGroup"), i);
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
    const order = (a: Card, b: Card): number => rank(a) - rank(b) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
    for (const c of all) {
      const list = subs.get(c.id);
      if (list) {
        c.subs = [...list.values()].sort(order);
        // A group whose members all sit in sub-groups names the hand-off by its first direct document, else its first document.
        c.handoff = c.direct[0]?.id ?? c.handoff;
      }
    }
    return all.sort(order);
  }
  const order: string[] = by === "status" ? ["red", "purple", "amber"] : [...SEVERITY_LEVELS, ""];
  return all.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
}

// The one layout of the board: every project shown counts together, so a card never follows another project's rules.
function scopeLayout(model: BoardModel): Layout | undefined {
  return model.orgLayouts ? Object.values(model.orgLayouts)[0] : undefined;
}

// The group cards that start open. The groups with the most blockers open, up to the layout's cap across the whole
// board (the documents in no group count as one group); every other layout opens a card that holds a blocker.
// Sub-groups never take a slot: they start closed.
function openCards(model: BoardModel, cards: Card[]): Set<string> {
  const layout = scopeLayout(model);
  const groups = cards.filter((c) => c.group || c.id === "");
  const open = new Set<string>(cards.filter((c) => !c.group && c.id !== "" && c.items.some(blocksNow)).map((c) => c.id));
  const ids = layout ? openGroups(layout, groups.map((c) => ({ id: c.id, blockers: c.items.filter(blocksNow).length }))) : new Set(groups.filter((c) => c.items.some(blocksNow)).map((c) => c.id));
  ids.forEach((id) => open.add(id));
  return open;
}

// Rows of a card shown before "Show more".
function limitOf(model: BoardModel, by: GroupBy): number {
  return by === "group" ? (scopeLayout(model)?.rowLimit ?? Infinity) : SHOWN_ROWS;
}

const rowsOf = (c: Card, from: number, to: number, names: Map<string, string>, t: BoardStrings): string => c.direct.slice(from, to).map((i) => row(i, names.get(i.project) ?? i.project, t, false)).join("");

// The empty place a closed card's rows are sent to when it is opened.
const lazyBox = (c: Card, by: GroupBy): string => `<div data-lid="${escapeHtml(c.id)}" data-kind="lazy" data-by="${by}"></div>`;

// What a card holds when opened: its rows up to the limit, "Show more" for the rest (sent on demand), then its
// sub-groups, closed.
function cardBody(c: Card, by: GroupBy, names: Map<string, string>, t: BoardStrings, limit: number): string {
  const shown = Math.min(limit, c.direct.length);
  const rest = c.direct.length - shown;
  const more = rest > 0 ? `<button type="button" class="sec" data-more data-lid="${escapeHtml(c.id)}" data-by="${by}" data-from="${shown}" aria-expanded="false" ${tip(t, "showMoreTip")}>${pillify(t, escapeHtml(pl(t, "showMore", { count: rest })))}</button><div data-lid="${escapeHtml(c.id)}" data-by="${by}" data-kind="more"></div>` : "";
  const nested = (c.subs ?? []).map((s) => card(s, by, names, t, false, false, limit, true)).join("");
  return rowsOf(c, 0, shown, names, t) + more + nested;
}

function card(c: Card, by: GroupBy, names: Map<string, string>, t: BoardStrings, multi: boolean, open: boolean, limit: number, sub = false): string {
  const worst = c.items.some(blocksNow) ? "red" : c.items.some((i) => i.status === "purple") ? "purple" : "amber";
  const tag = c.byUser === undefined || sub ? "" : `<span class="tag" ${tip(t, c.byUser ? "groupByYouTip" : "groupAutoTip")}>${escapeHtml(pl(t, c.byUser ? "groupByYou" : "groupAuto"))}</span>`;
  const menu = c.handoff === undefined ? "" : kebab(t, "scope", `group:${c.handoff}`, c.name);
  const line = pl(t, "groupCard", { name: c.name, count: c.items.length });
  const head = c.group ? groupTip(c.group, line, !open) : tip(t, "groupCard", { name: c.name, count: c.items.length });
  const stripe = c.group ? groupStripe(c.group) : "";
  // A group listed by hand, or the documents in no group, takes a dropped row.
  const zone = by === "group" && !sub && (c.group?.stored !== undefined || c.id === "") ? groupZone(t, c.id, c.name) : "";
  // With several projects shown, a card says which project(s) it holds, so same-named cards differ.
  const projects = multi && !sub ? [...new Set(c.items.map((i) => names.get(i.project) ?? i.project))].sort() : [];
  const where = projects.length > 0 ? `<span class="tag">${escapeHtml(projects.join(", "))}</span>` : "";
  const label = c.group ? groupLabel(c.group) : escapeHtml(c.name);
  // The fold is remembered by the card's stable id alone: the user's own open or close wins over the automatic one.
  const body = open ? cardBody(c, by, names, t, limit) : lazyBox(c, by);
  return `<details class="box pcard${sub ? " sub" : ""}" data-sec="${escapeHtml(`card:${by}:${c.id}`)}"${open ? " open" : ""}><summary class="sh"${stripe} ${head}${zone}><b class="pn" ${head}><i class="sq ${worst}" aria-hidden="true"></i> ${label}</b>${where}${tag}${itemCounts(c.items, c.name, t)}${menu}</summary>${body}</details>`;
}

// The cards of a layout, or nothing when no document is open.
export function groupCards(model: BoardModel, by: GroupBy, names: Map<string, string>, t: BoardStrings): string {
  const multi = new Set(model.items.map((i) => i.project)).size > 1;
  const cards = cardsFor(model, by, t);
  const open = by === "group" ? openCards(model, cards) : undefined;
  return cards.map((c) => card(c, by, names, t, multi, open ? open.has(c.id) : c.items.some(blocksNow), limitOf(model, by))).join("");
}

// The rows of one card (or sub-group) asked for by the page: from 0, everything the card holds when opened;
// from the "Show more" position, the rest of its rows. Undefined for an id the model does not hold.
export function cardRows(model: BoardModel, by: GroupBy, id: string, from: number, names: Map<string, string>, t: BoardStrings): { html: string; count: number } | undefined {
  const cards = cardsFor(model, by, t);
  const c = cards.find((x) => x.id === id) ?? cards.flatMap((x) => x.subs ?? []).find((x) => x.id === id);
  if (!c || !Number.isInteger(from) || from < 0) {
    return undefined;
  }
  if (from === 0) {
    return { html: cardBody(c, by, names, t, limitOf(model, by)), count: c.direct.length };
  }
  return from < c.direct.length ? { html: rowsOf(c, from, c.direct.length, names, t), count: c.direct.length - from } : undefined;
}
