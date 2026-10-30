import type { BoardModel } from "./boardModel";
import type { SinceView } from "./sinceLast";
import { BoardStrings, escapeHtml, pill, pl, tip } from "./boardHtmlUtil";
import { kebab } from "./boardHtmlMenus";
import { label } from "./boardHtmlProjects";
import { pollPill } from "./boardHtmlChats";

// The header of the board page: the scope switch, the view tabs and the two kebab menus on
// one line, and under it the line of applied filters. Pure.

export type Scope = "all" | "openOnly";

// The two scope buttons. "All projects" carries the count of projects the board would show
// with it. Left out when the scope is unknown (a plain-browser layout check).
export function scopeSwitch(model: BoardModel, scope: Scope | undefined, t: BoardStrings): string {
  if (scope === undefined) {
    return "";
  }
  const hidden = model.hidden ?? 0;
  const total = model.projects.length + (scope === "all" ? (model.skipped?.length ?? 0) : hidden);
  const hiddenNote = hidden > 0 ? " " + label(t, "hidden").replace("{count}", String(hidden)) : "";
  const btn = (value: Scope, text: string, tipText: string, count = ""): string =>
    `<button class="sec" data-scope="${value}" aria-pressed="${scope === value}" title="${escapeHtml(tipText)}">${escapeHtml(text)}${count}</button>`;
  return `<span class="seg" role="group" aria-label="${escapeHtml(pl(t, "scopeGroup"))}" ${tip(t, "scopeGroup")}>${btn("openOnly", pl(t, "scopeThis"), pl(t, "scopeThisTip") + hiddenNote)} ${btn("all", pl(t, "scopeAll"), pl(t, "scopeAllTip", { count: total }), " " + pill(t, total))}</span>`;
}

// The scope and the release mode as one pill, "All 5 · Deliberate". Its tooltip
// carries the detail: which projects are shown, what the mode blocks, and that red folders and
// failing checks block in every mode. Left out when the scope is unknown.
export function explainPill(model: BoardModel, scope: Scope | undefined, t: BoardStrings): string {
  if (scope === undefined) {
    return "";
  }
  const names = model.projects.map((p) => p.name).join(", ");
  const count = model.projects.length;
  const mode = model.profile === "rush" ? t.profileRush : model.profile === "zero" ? t.profileZero : t.profileDeliberate;
  const shown = scope === "all" ? pl(t, "explainShownAll", { count, names }) : pl(t, "explainShownOne", { names });
  const tipText = pl(t, "explainTip", { shown, mode, rule: pl(t, "modeRule." + model.profile), count });
  return `<span class="fp" title="${escapeHtml(tipText)}">\u2699 ${escapeHtml(pl(t, "explain", { scope: scope === "all" ? pl(t, "explainAll", { count }) : pl(t, "scopeThis"), mode }))}</span>`;
}

// The header entry to the change log: "Changes N", shown only while something changed since the
// last look. A click opens the "Since you last looked" box (it stays until dismissed).
export function sinceLink(since: SinceView | undefined, t: BoardStrings): string {
  if (!since || since.lines.length === 0) {
    return "";
  }
  return `<button class="sec" data-since-go ${tip(t, "sinceGoTip")}>${escapeHtml(pl(t, "sinceGo"))} ${pill(t, since.lines.length)}</button>`;
}

// The top line: scope switch, the view tabs (already built), the chat poll pill (when `paused` is given) and the two kebabs. The intro
// sentence is the tooltip of the whole line, not text on the page.
export function topBar(model: BoardModel, t: BoardStrings, scope: Scope | undefined, tabs: string, since?: SinceView, paused?: boolean): string {
  return `<div class="top" title="${escapeHtml(t.intro)}" aria-label="${escapeHtml(t.intro)}"><h1 class="vh" title="${escapeHtml(t.title)}">${escapeHtml(t.title)}</h1>${scopeSwitch(model, scope, t)}${explainPill(model, scope, t)}${tabs}${pollPill(paused, t)}<span class="sp"></span><span class="tr">${sinceLink(since, t)}${kebab(t, "view")}${kebab(t, "opts")}</span></div>`;
}

// One removable pill per applied filter, hidden when none is applied; "Clear all" once there are
// two. A pill carries only the kind of filter; the page script clicks the matching control of
// the Sittings box, which sends the usual message.
export function filterLine(model: BoardModel, t: BoardStrings): string {
  const v = model.sittings;
  if (!v) {
    return "";
  }
  const timeKey = ["any", "time15", "time30", "timeHour", "timeHalfDay"][["any", "15", "30", "60", "240"].indexOf(v.timeBox)];
  const pills: string[] = [];
  const add = (kind: string, name: string): void => {
    pills.push(`<span class="fp" ${tip(t, "fpRemove", { name })}>${escapeHtml(name)}<button class="fx sec" data-fclear="${kind}" ${tip(t, "fpRemove", { name })} aria-label="${escapeHtml(pl(t, "fpRemove", { name }))}">✕</button></span>`);
  };
  if (v.timeBox !== "any" && timeKey) {
    add("time", pl(t, "fpTime", { value: pl(t, timeKey) }));
  }
  if (v.have.length < v.contexts.length) {
    add("have", pl(t, "fpHave", { count: v.have.length, total: v.contexts.length }));
  }
  if (pills.length === 0) {
    return "";
  }
  const clear = pills.length > 1 ? `<button class="fx sec" data-fclear="all" ${tip(t, "fpClearTip")}>${escapeHtml(pl(t, "fpClear"))}</button>` : "";
  return `<div class="fline" role="group" aria-label="${escapeHtml(pl(t, "filterLine"))}" ${tip(t, "filterLine")}>${pills.join("")}${clear}</div>`;
}
