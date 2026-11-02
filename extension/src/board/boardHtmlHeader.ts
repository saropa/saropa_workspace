import type { BoardModel } from "./boardModel";
import type { SinceView } from "./sinceLast";
import { BoardStrings, escapeHtml, pill, pl, tip } from "./boardHtmlUtil";
import { GROUP_KEYS, TIME_LABELS, kebab, scopeTotal } from "./boardHtmlMenus";
import type { GroupBy } from "./types";
import { label } from "./boardHtmlProjects";
import { pollPill } from "./boardHtmlChats";

// The header of the board page: the scope-and-mode pill, the view tabs and the two kebab menus on
// one line, and under it the line of applied filters. Pure.

export type Scope = "all" | "openOnly";

// The tooltip of the scope pill: which projects the choice shows, plus the hidden-projects note.
function scopeTip(model: BoardModel, scope: Scope, t: BoardStrings): string {
  const hidden = model.hidden ?? 0;
  const hiddenNote = hidden > 0 ? " " + label(t, "hidden").replace("{count}", String(hidden)) : "";
  return scope === "all" ? pl(t, "scopeAllTip", { count: scopeTotal(model, scope) }) : pl(t, "scopeThisTip") + hiddenNote;
}

// One header pill: a button that opens the small menu `menu` (see pillMenus). It shows the
// current value; `tipText` explains it.
function pillButton(t: BoardStrings, menu: string, text: string, tipText: string, menuLabel: string): string {
  return `<button type="button" class="fp pm sec" data-menu="${menu}" aria-haspopup="menu" aria-expanded="false" aria-controls="menu-${menu}" title="${escapeHtml(tipText)}" aria-label="${escapeHtml(menuLabel + ": " + text)}">${escapeHtml(text)}</button>`;
}

// The one setting pill of the top line: the scope (left out when unknown) and the release mode,
// "All 3 \u00b7 Deliberate", opening one menu with both choices. The tooltip carries the detail: which
// projects are shown, what the mode blocks, and that red folders and failing checks block in every
// mode.
export function settingPills(model: BoardModel, scope: Scope | undefined, t: BoardStrings): string {
  const count = model.projects.length;
  const mode = model.profile === "rush" ? t.profileRush : model.profile === "zero" ? t.profileZero : t.profileDeliberate;
  const names = model.projects.map((p) => p.name).join(", ");
  const shown = scope === "all" ? pl(t, "explainShownAll", { count, names }) : pl(t, "explainShownOne", { names });
  const modeTip = pl(t, "explainTip", { shown, mode, rule: pl(t, "modeRule." + model.profile), count });
  if (scope === undefined) {
    return pillButton(t, "pscope", mode, modeTip, t.profileLabel);
  }
  const scopeText = scope === "all" ? pl(t, "explainAll", { count: scopeTotal(model, scope) }) : pl(t, "scopeThis");
  return pillButton(t, "pscope", `${scopeText} \u00b7 ${mode}`, `${scopeTip(model, scope, t)}\n${modeTip}`, `${pl(t, "scopeGroup")} / ${t.profileLabel}`);
}

// The pills that shape the Board tab only, drawn at the top of that tab: the grouping (when known), the
// time box (with the Sittings data) and the devices in hand (when there are any). The Gantt ignores all three.
export function boardPills(model: BoardModel, t: BoardStrings, groupBy?: GroupBy): string {
  const out: string[] = [];
  if (groupBy !== undefined) {
    out.push(pillButton(t, "pgroup", pl(t, GROUP_KEYS[groupBy]), pl(t, GROUP_KEYS[groupBy] + "Tip"), pl(t, "groupBy")));
  }
  const v = model.sittings;
  if (v) {
    const [, key] = TIME_LABELS.find(([n]) => n === v.timeBox) ?? TIME_LABELS[0];
    out.push(pillButton(t, "ptime", pl(t, key), pl(t, "timeLabelTip"), pl(t, "timeLabel")));
    if (v.contexts.length > 0) {
      const text = pl(t, "fpHave", { count: v.have.length, total: v.contexts.length });
      out.push(pillButton(t, "phave", text, `${pl(t, "haveLabel")} ${text}`, pl(t, "haveLabel")));
    }
  }
  return out.length === 0 ? "" : `<div class="fline" role="group" aria-label="${escapeHtml(pl(t, "filterLine"))}">${out.join(" ")}</div>`;
}

// The header entry to the change log: "Changes N", shown only while something changed since the
// last look. A click opens the "Since you last looked" box (it stays until dismissed).
export function sinceLink(since: SinceView | undefined, t: BoardStrings): string {
  if (!since || since.lines.length === 0) {
    return "";
  }
  return `<button class="sec" data-since-go ${tip(t, "sinceGoTip")}>${escapeHtml(pl(t, "sinceGo"))} ${pill(t, since.lines.length)}</button>`;
}

// The top line: the scope-and-mode pill, the view tabs (already built), the chat poll pill (when `paused` is given) and the two kebabs. The intro
// sentence is the tooltip of the whole line, not text on the page.
export function topBar(model: BoardModel, t: BoardStrings, scope: Scope | undefined, tabs: string, since?: SinceView, paused?: boolean): string {
  return `<div class="top" title="${escapeHtml(t.intro)}" aria-label="${escapeHtml(t.intro)}"><h1 class="vh" title="${escapeHtml(t.title)}">${escapeHtml(t.title)}</h1>${settingPills(model, scope, t)}${tabs}${pollPill(paused, t)}<span class="sp"></span><span class="tr">${sinceLink(since, t)}${kebab(t, "opts")}</span></div>`;
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
  const add = (kind: string, name: string, menu: string): void => {
    pills.push(`<span class="fp" ${tip(t, "fpRemove", { name })}><button type="button" class="fl sec" data-menu="${menu}" aria-haspopup="menu" aria-expanded="false" aria-controls="menu-${menu}" title="${escapeHtml(name)}">${escapeHtml(name)}</button><button class="fx sec" data-fclear="${kind}" ${tip(t, "fpRemove", { name })} aria-label="${escapeHtml(pl(t, "fpRemove", { name }))}">✕</button></span>`);
  };
  if (v.timeBox !== "any" && timeKey) {
    add("time", pl(t, "fpTime", { value: pl(t, timeKey) }), "ptime");
  }
  if (v.have.length < v.contexts.length) {
    add("have", pl(t, "fpHave", { count: v.have.length, total: v.contexts.length }), "phave");
  }
  if (pills.length === 0) {
    return "";
  }
  const clear = pills.length > 1 ? `<button class="fx sec" data-fclear="all" ${tip(t, "fpClearTip")}>${escapeHtml(pl(t, "fpClear"))}</button>` : "";
  return `<div class="fline" role="group" aria-label="${escapeHtml(pl(t, "filterLine"))}" ${tip(t, "filterLine")}>${pills.join("")}${clear}</div>`;
}
