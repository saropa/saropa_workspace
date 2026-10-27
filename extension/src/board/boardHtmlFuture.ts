import { EFFORTS, Importance, IMPORTANCES, MAX_FREE_TEXT, REACHES, RESEARCH_STATES, RISKS } from "./futureBlock";
import { FUTURE_SORTS, FutureGroup, FutureItem, FutureOutside, FutureSort, groupItems, scoreOf } from "./futureList";
import { researchCounts, researchQueue } from "./futureResearch";
import { BoardStrings, collapsible, docLink, escapeHtml, pill, pillify, tip, titleAttr } from "./boardHtmlUtil";

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
  // Most documents handed to a chat at once (the setting, already checked).
  researchParallel: number;
  // False when Hand to chat is turned off: the hand-off button stays but cannot be used.
  handEnabled: boolean;
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
  const tabLabel = ft(t, "tab").replace("{count}", () => String(view.items.length));
  return `<div class="tabs" role="tablist" ${tip(t, "tabs")}><button role="tab" id="tb-board" data-tab="board" aria-selected="true" aria-controls="tab-board" ${tip(t, "tabBoard")}>${escapeHtml(ft(t, "tabBoard"))}</button><button role="tab" id="tb-future" data-tab="future" aria-selected="false" aria-controls="tab-future" ${tip(t, "tabFuture")}>${pillify(t, escapeHtml(tabLabel))}</button></div>`;
}

function options(values: readonly string[], current: string, label: (v: string) => string): string {
  return values.map((v) => `<option value="${escapeHtml(v)}"${v === current ? " selected" : ""}>${escapeHtml(label(v))}</option>`).join("");
}

function control(t: BoardStrings, i: number, field: string, values: readonly string[], current: string, guessed: boolean, off: string, label: (v: string) => string): string {
  const name = ft(t, field);
  const named = guessed ? `${name}: ${ft(t, "guessedTip")}` : name;
  return `<label class="fcl"><span class="k" ${tip(t, "futureLabelTip", { name: named })}>${escapeHtml(name)}</span><select data-ff="${field}" data-fi="${i}" class="${guessed ? "guess" : ""}" title="${escapeHtml(named)}" aria-label="${escapeHtml(named)}"${off}>${options(values, current, label)}</select></label>`;
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
  return `<label class="fcl"><span class="k" ${tip(t, "futureLabelTip", { name })}>${escapeHtml(name)}</span><select data-ff="importance" data-fi="${i}" class="${item.importance === undefined ? "guess" : ""}" title="${escapeHtml(name)}" aria-label="${escapeHtml(name)}"${off}>${opts}</select></label>${propose}`;
}

// The research controls of one item: the "Research needed" toggle, the state, the question
// and, when the research is ready, the label and the review button. The toggle only moves
// between "none" and "needed"; the other states are set by the hand-off, the chat and the
// review, or by the state control.
function researchRow(item: FutureItem, i: number, t: BoardStrings, off: string): string {
  const toggleOff = item.research === "none" || item.research === "needed" ? off : " disabled";
  const toggle = `<label class="fcl" ${tip(t, "researchToggle")}><input type="checkbox" data-frt="${i}"${item.research === "needed" ? " checked" : ""}${toggleOff} ${tip(t, "researchToggle")}> <span>${escapeHtml(ft(t, "researchNeeded"))}</span></label>`;
  const state = control(t, i, "research", RESEARCH_STATES, item.research, false, off, (v) => ft(t, "research." + v));
  const q = ft(t, "question");
  const question = `<label class="fcl"><span class="k" ${tip(t, "futureLabelTip", { name: q })}>${escapeHtml(q)}</span><input type="text" class="fq" data-fq="${i}" maxlength="${MAX_FREE_TEXT}" value="${escapeHtml(item.researchQuestion ?? "")}" placeholder="${escapeHtml(ft(t, "questionHint"))}" title="${escapeHtml(ft(t, "questionHint"))}" aria-label="${escapeHtml(q)}"${off}></label>`;
  const ready =
    item.research === "ready"
      ? `<span class="tag" title="${escapeHtml(ft(t, "readyTip"))}">${escapeHtml(ft(t, "readyNotReviewed"))}</span><button data-frev="${i}"${off} ${tip(t, "markReviewed")}>${escapeHtml(ft(t, "markReviewed"))}</button>`
      : "";
  return `<div class="fc fr">${toggle}${state}${question}${ready}</div>`;
}

function itemRow(item: FutureItem, i: number, t: BoardStrings, canEdit: boolean): string {
  const off = canEdit ? "" : " disabled";
  const g = (f: string): boolean => item.guessed.includes(f as never);
  const score = ft(t, "scoreTip").replace("{score}", () => String(scoreOf(item)));
  const blocker =
    item.group === "not-feasible"
      ? `<div class="fb" ${tip(t, "blockerRow")}><span class="k" ${tip(t, "blockerRow")}>${escapeHtml(ft(t, "blocker"))}</span> <span>${escapeHtml(item.blocker ?? ft(t, "noBlocker"))}</span> <button class="sec" data-fblock="${i}"${off} ${tip(t, "editBlocker")}>${escapeHtml(ft(t, "editBlocker"))}</button></div>`
      : "";
  const controls = [
    importanceControl(t, i, item, off),
    control(t, i, "wow", ["1", "2", "3", "4", "5"], String(item.wow), g("wow"), off, (v) => v),
    control(t, i, "reach", REACHES, item.reach, g("reach"), off, (v) => ft(t, "reach." + v)),
    control(t, i, "effort", EFFORTS, item.effort, g("effort"), off, (v) => v),
    control(t, i, "risk", RISKS, item.risk, g("risk"), off, (v) => ft(t, "risk." + v)),
  ].join("");
  return `<div class="fut" data-fut="${i}" ${tip(t, "futureRow")}><div class="fl"><span class="tag" ${tip(t, "project", { name: item.projectName })}>${escapeHtml(item.projectName)}</span><span class="f">${docLink(item.title, item.path, `data-fopen="${i}"`)}</span><span class="pill" title="${escapeHtml(score)}">${escapeHtml(String(scoreOf(item)))}</span></div><div class="fc">${controls}</div>${researchRow(item, i, t, off)}${blocker}</div>`;
}

// The research summary and the hand-off button; empty when no document has a research state.
function researchBar(view: FutureView, t: BoardStrings): string {
  const c = researchCounts(view.items);
  if (c.needed + c.inProgress + c.readyUnreviewed === 0) {
    return "";
  }
  const num = (key: string, n: number): string => ft(t, key).replace("{count}", () => String(n));
  const parts = [c.needed > 0 ? num("waiting", c.needed) : "", c.inProgress > 0 ? num("inProgressCount", c.inProgress) : "", c.readyUnreviewed > 0 ? num("readyCount", c.readyUnreviewed) : ""].filter((x) => x !== "");
  let button = "";
  if (c.needed > 0) {
    const { batch, queued } = researchQueue(view.items, view.sort, view.researchParallel);
    const label = queued > 0 ? ft(t, "handBatch").replace("{batch}", () => String(batch.length)).replace("{queued}", () => String(queued)) : num("handAll", batch.length);
    const off = view.canEdit && view.handEnabled ? "" : " disabled";
    const handTip = view.handEnabled ? ft(t, "handTip") : ft(t, "handOffTip");
    button = ` <button data-fhand title="${escapeHtml(handTip)}"${off}>${pillify(t, escapeHtml(label))}</button>`;
  }
  return `<div class="fresearch"><span ${tip(t, "researchCounts")}>${pillify(t, escapeHtml(parts.join(" \u00b7 ")))}</span>${button}</div>`;
}

function outsideBox(view: FutureView, t: BoardStrings): string {
  if (view.outside.length === 0) {
    return "";
  }
  const rows = view.outside
    .map((o, j) => {
      const src = ft(t, "outsideSource").replace("{path}", () => o.path).replace("{line}", () => String(o.line)).replace("{why}", () => ft(t, "why." + o.why));
      return `<div class="fut ro" ${tip(t, "futureOutsideRow")}><div class="fl"><span class="tag" ${tip(t, "project", { name: o.projectName })}>${escapeHtml(o.projectName)}</span><span class="f">${docLink(o.title, o.path, `data-fopen-o="${j}"`)}</span><span class="k" ${titleAttr(src)}>${pillify(t, escapeHtml(src))}</span></div></div>`;
    })
    .join("");
  return `<details class="box" data-sec="future:outside"${view.outside.length <= 10 ? " open" : ""}><summary ${tip(t, "futureOutsideSummary")}>${pillify(t, escapeHtml(ft(t, "outsideHeading").replace("{count}", () => String(view.outside.length))))}</summary><p class="note">${escapeHtml(ft(t, "outsideNote"))}</p>${rows}</details>`;
}

// The Future tab's panel. Hidden until its tab button is chosen.
export function futurePanel(view: FutureView | undefined, t: BoardStrings): string {
  if (!hasFuture(view)) {
    return "";
  }
  const sort = `<label class="fcl"><span class="k" ${tip(t, "futureSortTip")}>${escapeHtml(ft(t, "sort"))}</span><select data-fsort title="${escapeHtml(ft(t, "sort"))}" aria-label="${escapeHtml(ft(t, "sort"))}">${options(FUTURE_SORTS, view.sort, (v) => ft(t, "sort." + v))}</select></label>`;
  const groups = groupItems(view.items, view.sort)
    .map((g) => {
      const label = (v: FutureGroup | Importance): string => ft(t, "flag." + v);
      return collapsible({ id: "future:" + g.group, cls: "fg", level: 3, tipAttr: tip(t, "futureGroup", { name: label(g.group) }), head: `${escapeHtml(label(g.group))} ${pill(t, g.entries.length, "count", { count: g.entries.length })}`, body: g.entries.map((e) => itemRow(e.item, e.i, t, view.canEdit)).join(""), open: g.entries.length <= 25 });
    })
    .join("");
  return `<section id="tab-future" role="tabpanel" aria-labelledby="tb-future" aria-label="${escapeHtml(ft(t, "tab").replace("{count}", () => String(view.items.length)))}" hidden><h2 ${tip(t, "futureHeading")}>${escapeHtml(ft(t, "heading"))}</h2><p class="note">${escapeHtml(ft(t, "note"))}</p><div class="fsort">${sort}</div>${researchBar(view, t)}${groups}${outsideBox(view, t)}</section>`;
}
