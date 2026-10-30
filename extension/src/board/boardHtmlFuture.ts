import { EFFORTS, Importance, IMPORTANCES, MAX_FREE_TEXT, REACHES, RESEARCH_STATES, RISKS } from "./futureBlock";
import { FUTURE_SORTS, FutureGroup, FutureItem, FutureOutside, FutureSort, groupItems, scoreOf } from "./futureList";
import { researchCounts, researchQueue } from "./futureResearch";
import { BoardStrings, collapsible, docLink, sectionIcon, escapeHtml, fillT, pill, pillify, pl, tip, titleAttr } from "./boardHtmlUtil";
import { item, kebab } from "./boardHtmlMenus";
import { ganttTab } from "./boardHtmlGantt";

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
  // Most documents handed off at once (the setting, already checked).
  researchParallel: number;
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

// The tab buttons: Gantt first (the default view), Board, and Future when it has something to list.
export function viewTabs(view: FutureView | undefined, t: BoardStrings): string {
  const future = hasFuture(view)
    ? `<button role="tab" id="tb-future" data-tab="future" aria-selected="false" aria-controls="tab-future" ${tip(t, "tabFuture")}>${pillify(t, escapeHtml(ft(t, "tab").replace("{count}", () => String(view.items.length))))}</button>`
    : "";
  return `<div class="tabs" role="tablist" ${tip(t, "tabs")}>${ganttTab(true, t)}<button role="tab" id="tb-board" data-tab="board" aria-selected="false" aria-controls="tab-board" ${tip(t, "tabBoard")}>${escapeHtml(ft(t, "tabBoard"))}</button>${future}</div>`;
}

function options(values: readonly string[], current: string, label: (v: string) => string): string {
  return values.map((v) => `<option value="${escapeHtml(v)}"${v === current ? " selected" : ""}>${escapeHtml(label(v))}</option>`).join("");
}

// The pill that shows an item's importance flag, and the value the menu ticks for it. An item with
// no written flag shows the flag its folder implies, marked as a guess.
function importanceOf(item: FutureItem): string {
  return item.importance === undefined && item.group === "unflagged" ? "" : (item.importance ?? item.group);
}

function importancePill(t: BoardStrings, item: FutureItem): string {
  const name = ft(t, "importance");
  const text = ft(t, "flag." + (importanceOf(item) || "unflagged"));
  const guess = item.importance === undefined;
  const tipText = `${name}: ${text}${guess ? ` (${ft(t, "guessedTip")})` : ""}`;
  return `<span class="imp${guess ? " guess" : ""}" title="${escapeHtml(tipText)}">${escapeHtml(text)}</span>`;
}

// The one menu of the tab: a radio group per characteristic, ticked by the page script from the
// values on the kebab that opened it. The empty importance and the proposal appear only for an item
// with no written flag.
export function futureMenu(view: FutureView | undefined, t: BoardStrings): string {
  if (!hasFuture(view)) {
    return "";
  }
  const group = (field: string, values: readonly string[], label: (v: string) => string, icon = ""): string => {
    const name = ft(t, field);
    const rows = values.map((v) => item(`ff:${field}:${v}`, label(v), `${name}: ${label(v)}`, ` data-ffield="${field}" data-fval="${escapeHtml(v)}" aria-checked="false"${v === "" ? " hidden disabled" : ""}`, "menuitemradio")).join("");
    return `<div class="mh" role="presentation" id="mh-f${field}" ${tip(t, "futureGroupTip", { name })}>${icon ? `<span aria-hidden="true">${icon}</span> ` : ""}${escapeHtml(name)}</div><div role="group" aria-labelledby="mh-f${field}" ${tip(t, "futureGroupTip", { name })}>${rows}</div>`;
  };
  const flag = (v: string): string => ft(t, "flag." + (v || "unflagged"));
  const propose = item("fpropose", "", ft(t, "acceptTip"), " hidden disabled");
  const body = group("importance", ["", ...IMPORTANCES], flag) + propose + group("wow", ["1", "2", "3", "4", "5"], (v) => v, "\u2728") + group("reach", REACHES, (v) => ft(t, "reach." + v), "\u{1F465}") + group("effort", EFFORTS, (v) => v, "\u23F1\uFE0F") + group("risk", RISKS, (v) => ft(t, "risk." + v), "\u26A0\uFE0F") + group("research", RESEARCH_STATES, (v) => ft(t, "research." + v));
  const list = pl(t, "futureMenuList");
  return `<div class="menu" id="menu-fut" role="menu" hidden aria-label="${escapeHtml(list)}" title="${escapeHtml(list)}">${body}</div>`;
}

// The kebab of one item. It carries the item's current values for the page script to tick.
function futureKebab(t: BoardStrings, i: number, it: FutureItem, canEdit: boolean): string {
  const g = (f: string): boolean => it.guessed.includes(f as never);
  const attrs = [
    `data-importance="${escapeHtml(importanceOf(it))}"`,
    `data-wow="${it.wow}"`,
    `data-reach="${escapeHtml(it.reach)}"`,
    `data-effort="${escapeHtml(it.effort)}"`,
    `data-risk="${escapeHtml(it.risk)}"`,
    `data-research="${escapeHtml(it.research)}"`,
    `data-gs="${["wow", "reach", "effort", "risk"].filter(g).join(",")}${it.importance === undefined ? ",importance" : ""}"`,
  ];
  if (it.importance === undefined) {
    attrs.push(`data-pv="${escapeHtml(it.proposed)}"`, `data-pl="${escapeHtml(ft(t, "proposed").replace("{flag}", () => ft(t, "flag." + it.proposed)))}"`);
  }
  return kebab(t, "fut", i, it.title, ` ${attrs.join(" ")}${canEdit ? "" : " disabled"}`);
}

// The research line of one item, only when a research state is set: the state, then (when the
// research is ready) the label and the review button, and the question on its own row. The state
// itself is set from the item's menu, by the hand-off, the chat and the review.
function researchRow(item: FutureItem, i: number, t: BoardStrings, off: string): string {
  if (item.research === "none") {
    return "";
  }
  const state = `<span class="tag" ${tip(t, "futureGroupTip", { name: ft(t, "research") })}>${escapeHtml(ft(t, "research"))}: ${escapeHtml(ft(t, "research." + item.research))}</span>`;
  const ready =
    item.research === "ready"
      ? `<span class="tag" title="${escapeHtml(ft(t, "readyTip"))}">${escapeHtml(ft(t, "readyNotReviewed"))}</span><button data-frev="${i}"${off} ${tip(t, "markReviewed")}>${escapeHtml(ft(t, "markReviewed"))}</button>`
      : "";
  const q = ft(t, "question");
  const question = `<div class="fc fqrow"><label class="fcl fqwrap"><span class="k" ${tip(t, "futureLabelTip", { name: q })}>${escapeHtml(q)}</span><textarea class="fq" rows="2" data-fq="${i}" maxlength="${MAX_FREE_TEXT}" placeholder="${escapeHtml(ft(t, "questionHint"))}" title="${escapeHtml(ft(t, "questionHint"))}" aria-label="${escapeHtml(q)}"${off}>${escapeHtml(item.researchQuestion ?? "")}</textarea></label></div>`;
  return `<div class="fc fr">${state}${ready}</div>${question}`;
}

function itemRow(item: FutureItem, i: number, t: BoardStrings, canEdit: boolean): string {
  const off = canEdit ? "" : " disabled";
  const score = ft(t, "scoreTip").replace("{score}", () => String(scoreOf(item)));
  const blocker =
    item.group === "not-feasible"
      ? `<div class="fb" ${tip(t, "blockerRow")}><span class="k" ${tip(t, "blockerRow")}>${escapeHtml(ft(t, "blocker"))}</span> <span>${escapeHtml(item.blocker ?? ft(t, "noBlocker"))}</span> <button class="sec" data-fblock="${i}"${off} ${tip(t, "editBlocker")}>${escapeHtml(ft(t, "editBlocker"))}</button></div>`
      : "";
  return `<div class="fut" data-fut="${i}" ${tip(t, "futureRow")}><div class="fl"><span class="tag" ${tip(t, "project", { name: item.projectName })}>${escapeHtml(item.projectName)}</span><span class="f">${docLink(item.title, item.path, `data-fopen="${i}"`)}</span><span class="pill" title="${escapeHtml(score)}">${escapeHtml(String(scoreOf(item)))}</span>${importancePill(t, item)}${futureKebab(t, i, item, canEdit)}</div>${researchRow(item, i, t, off)}${blocker}</div>`;
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
    const off = view.canEdit ? "" : " disabled";
    button = ` <button data-fhand title="${escapeHtml(ft(t, "handTip"))}"${off}>${pillify(t, escapeHtml(label))}</button>`;
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
      const shown = fillT(t, ft(t, "outsideSource"), { line: o.line, why: ft(t, "why." + o.why) }, { path: escapeHtml(o.path) });
      return `<div class="fut ro" ${tip(t, "futureOutsideRow")}><div class="fl"><span class="tag" ${tip(t, "project", { name: o.projectName })}>${escapeHtml(o.projectName)}</span><span class="f">${docLink(o.title, o.path, `data-fopen-o="${j}"`)}</span><span class="k" ${titleAttr(src)}>${shown}</span></div></div>`;
    })
    .join("");
  return `<details class="box" data-sec="future:outside"${view.outside.length <= 10 ? " open" : ""}><summary class="sh" ${tip(t, "futureOutsideSummary")}>${sectionIcon(t, "future:outside")}${pillify(t, escapeHtml(ft(t, "outsideHeading").replace("{count}", () => String(view.outside.length))))}</summary><p class="note">${escapeHtml(ft(t, "outsideNote"))}</p>${rows}</details>`;
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
      return collapsible({ t, id: "future:" + g.group, cls: "box fg", level: 3, tipAttr: tip(t, "futureGroup", { name: label(g.group) }), head: `${escapeHtml(label(g.group))} ${pill(t, g.entries.length, "count", { count: g.entries.length })}`, body: g.entries.map((e) => itemRow(e.item, e.i, t, view.canEdit)).join(""), open: g.entries.length <= 25 });
    })
    .join("");
  return `<section id="tab-future" role="tabpanel" aria-labelledby="tb-future" aria-label="${escapeHtml(ft(t, "tab").replace("{count}", () => String(view.items.length)))}" hidden><h2 ${tip(t, "futureHeading")}>${sectionIcon(t, "future")}${escapeHtml(ft(t, "heading"))} <span class="qm" tabindex="0" role="note" aria-describedby="qm-fut" title="${escapeHtml(ft(t, "note"))}" data-tip="${escapeHtml(ft(t, "note"))}">?</span><span id="qm-fut" hidden>${escapeHtml(ft(t, "note"))}</span></h2><div class="fsort">${sort}</div>${researchBar(view, t)}${groups}${outsideBox(view, t)}</section>`;
}
