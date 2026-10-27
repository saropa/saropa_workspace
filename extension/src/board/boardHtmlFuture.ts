import { EFFORTS, Importance, IMPORTANCES, REACHES, RISKS } from "./futureBlock";
import { FUTURE_SORTS, FutureGroup, FutureItem, FutureOutside, FutureSort, groupItems, scoreOf } from "./futureList";
import { BoardStrings, escapeHtml } from "./boardHtmlUtil";

// The Future tab of the board page: deferred and blocked documents under their flag, with
// the characteristics and the controls that set them. Every control carries only an index;
// the host resolves it against the list it rendered and writes the document's header block.

// What the tab shows.
export interface FutureView {
  items: FutureItem[];
  outside: FutureOutside[];
  sort: FutureSort;
  // False while a scan is running or the stored result is on screen: the controls are off.
  canEdit: boolean;
}

// One word of the tab's text table; the key itself when the table has no entry.
export function ft(t: BoardStrings, key: string): string {
  const table = t.futureLabels as Record<string, string> | undefined;
  return table && typeof table === "object" ? (table[key] ?? key) : key;
}

// True when the tab has something to list. Outside items alone do not make a tab.
export function hasFuture(view: FutureView | undefined): view is FutureView {
  return view !== undefined && view.items.length > 0;
}

// The two tab buttons; empty when the Future tab has nothing to list.
export function futureTabs(view: FutureView | undefined, t: BoardStrings): string {
  if (!hasFuture(view)) {
    return "";
  }
  const label = ft(t, "tab").replace("{count}", () => String(view.items.length));
  return `<div class="tabs" role="tablist"><button role="tab" id="tb-board" data-tab="board" aria-selected="true" aria-controls="tab-board">${escapeHtml(ft(t, "tabBoard"))}</button><button role="tab" id="tb-future" data-tab="future" aria-selected="false" aria-controls="tab-future">${escapeHtml(label)}</button></div>`;
}

function options(values: readonly string[], current: string, label: (v: string) => string): string {
  return values.map((v) => `<option value="${escapeHtml(v)}"${v === current ? " selected" : ""}>${escapeHtml(label(v))}</option>`).join("");
}

function control(t: BoardStrings, i: number, field: string, values: readonly string[], current: string, guessed: boolean, off: string, label: (v: string) => string): string {
  const name = ft(t, field);
  const tip = guessed ? `${name}: ${ft(t, "guessedTip")}` : name;
  return `<label class="fcl"><span class="k">${escapeHtml(name)}</span><select data-ff="${field}" data-fi="${i}" class="${guessed ? "guess" : ""}" title="${escapeHtml(tip)}" aria-label="${escapeHtml(tip)}"${off}>${options(values, current, label)}</select></label>`;
}

function importanceControl(t: BoardStrings, i: number, item: FutureItem, off: string): string {
  const name = ft(t, "importance");
  const flag = (v: string): string => ft(t, "flag." + v);
  const none = item.importance === undefined && item.group === "unflagged";
  const opts = `${none ? `<option value="" selected>${escapeHtml(flag("unflagged"))}</option>` : ""}${options(IMPORTANCES, none ? "" : (item.importance ?? item.group), flag)}`;
  const propose =
    item.importance === undefined
      ? `<button data-faccept="${i}" data-fv="${item.proposed}"${off} title="${escapeHtml(ft(t, "acceptTip"))}">${escapeHtml(ft(t, "proposed").replace("{flag}", () => flag(item.proposed)))}</button>`
      : "";
  return `<label class="fcl"><span class="k">${escapeHtml(name)}</span><select data-ff="importance" data-fi="${i}" class="${item.importance === undefined ? "guess" : ""}" aria-label="${escapeHtml(name)}"${off}>${opts}</select></label>${propose}`;
}

function itemRow(item: FutureItem, i: number, t: BoardStrings, canEdit: boolean): string {
  const off = canEdit ? "" : " disabled";
  const g = (f: string): boolean => item.guessed.includes(f as never);
  const score = ft(t, "scoreTip").replace("{score}", () => String(scoreOf(item)));
  const blocker =
    item.group === "not-feasible"
      ? `<div class="fb"><span class="k">${escapeHtml(ft(t, "blocker"))}</span> <span>${escapeHtml(item.blocker ?? ft(t, "noBlocker"))}</span> <button data-fblock="${i}"${off}>${escapeHtml(ft(t, "editBlocker"))}</button></div>`
      : "";
  const controls = [
    importanceControl(t, i, item, off),
    control(t, i, "wow", ["1", "2", "3", "4", "5"], String(item.wow), g("wow"), off, (v) => v),
    control(t, i, "reach", REACHES, item.reach, g("reach"), off, (v) => ft(t, "reach." + v)),
    control(t, i, "effort", EFFORTS, item.effort, g("effort"), off, (v) => v),
    control(t, i, "risk", RISKS, item.risk, g("risk"), off, (v) => ft(t, "risk." + v)),
  ].join("");
  return `<div class="fut" data-fut="${i}"><div class="fl"><span class="tag">${escapeHtml(item.projectName)}</span><span class="f click-f" tabindex="0" role="button" data-fopen="${i}" title="${escapeHtml(item.path)}">${escapeHtml(item.title)}</span><span class="k" title="${escapeHtml(score)}">${escapeHtml(String(scoreOf(item)))}</span></div><div class="fc">${controls}</div>${blocker}</div>`;
}

function outsideBox(view: FutureView, t: BoardStrings): string {
  if (view.outside.length === 0) {
    return "";
  }
  const rows = view.outside
    .map((o, j) => {
      const src = ft(t, "outsideSource").replace("{path}", () => o.path).replace("{line}", () => String(o.line)).replace("{why}", () => ft(t, "why." + o.why));
      return `<div class="fut ro"><div class="fl"><span class="tag">${escapeHtml(o.projectName)}</span><span class="f click-f" tabindex="0" role="button" data-fopen-o="${j}" title="${escapeHtml(src)}">${escapeHtml(o.title)}</span><span class="k">${escapeHtml(src)}</span></div></div>`;
    })
    .join("");
  return `<details class="box"><summary>${escapeHtml(ft(t, "outsideHeading").replace("{count}", () => String(view.outside.length)))}</summary><p class="note">${escapeHtml(ft(t, "outsideNote"))}</p>${rows}</details>`;
}

// The Future tab's panel. Hidden until its tab button is chosen.
export function futurePanel(view: FutureView | undefined, t: BoardStrings): string {
  if (!hasFuture(view)) {
    return "";
  }
  const sort = `<label class="fcl"><span class="k">${escapeHtml(ft(t, "sort"))}</span><select data-fsort aria-label="${escapeHtml(ft(t, "sort"))}">${options(FUTURE_SORTS, view.sort, (v) => ft(t, "sort." + v))}</select></label>`;
  const groups = groupItems(view.items, view.sort)
    .map((g) => {
      const label = (v: FutureGroup | Importance): string => ft(t, "flag." + v);
      return `<section class="fg"><h3>${escapeHtml(label(g.group))} <span class="n">${g.entries.length}</span></h3>${g.entries.map((e) => itemRow(e.item, e.i, t, view.canEdit)).join("")}</section>`;
    })
    .join("");
  return `<section id="tab-future" role="tabpanel" aria-labelledby="tb-future" hidden><h2>${escapeHtml(ft(t, "heading"))}</h2><p class="note">${escapeHtml(ft(t, "note"))}</p><div class="fsort">${sort}</div>${groups}${outsideBox(view, t)}</section>`;
}
