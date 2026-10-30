import type { BoardModel } from "./boardModel";
import { BoardStrings, escapeHtml, pl, tip } from "./boardHtmlUtil";
import { label } from "./boardHtmlProjects";

// The pop-up menus of the board: one for the actions on a document row and one for the board
// options. Each is drawn once per page; the small kebab button on a row or in the top bar opens
// it and the page script moves it next to that button. A row's kebab carries only the item's
// index. Pure.

// The kebab button of a row (`id` is the item's index) or of the top bar (no id): "view" holds
// the view options, "opts" the project actions.
export function kebab(t: BoardStrings, menu: "row" | "opts" | "view", id?: number, title = ""): string {
  const text = menu === "row" ? pl(t, "rowMenu", { title }) : pl(t, menu === "view" ? "viewMenu" : "optsMenu");
  const at = id === undefined ? "" : ` data-id="${id}"`;
  return `<button type="button" class="kb sec" data-menu="${menu}"${at} aria-haspopup="menu" aria-expanded="false" aria-controls="menu-${menu}" title="${escapeHtml(text)}" aria-label="${escapeHtml(text)}">⋮</button>`;
}

const item = (act: string, text: string, tipText: string, extra = "", role = "menuitem"): string => `<button type="button" class="mi" role="${role}" data-act="${escapeHtml(act)}"${extra} title="${escapeHtml(tipText)}">${escapeHtml(text)}</button>`;

// The row menu: open the document, change its status or severity, set both back to automatic, add a rule for its folder, hand it to chat,
// open the rules file. The Hand to chat entry is left out when that feature is off.
export function rowMenu(t: BoardStrings): string {
  const hand = t.handToChat ? item("hand", t.handToChat, t.handToChatTip) : "";
  return `<div class="menu" id="menu-row" role="menu" hidden aria-label="${escapeHtml(pl(t, "rowMenuList"))}" title="${escapeHtml(pl(t, "rowMenuList"))}">${item("open", pl(t, "menuOpen"), pl(t, "menuOpenTip"))}${item("status", pl(t, "menuStatus"), pl(t, "menuStatusTip"))}${item("severity", pl(t, "menuSeverity"), pl(t, "menuSeverityTip"))}${item("auto", pl(t, "menuAuto"), pl(t, "menuAutoTip"))}${item("assign", pl(t, "menuAssign"), pl(t, "menuAssignTip"))}${hand}${item("rules", t.ptgOpenRules, pl(t, "menuRulesTip"))}</div>`;
}

// Names of the time boxes the Steps filter offers, with the minutes each means.
const TIME_LABELS: Array<[string, string]> = [["any", "timeAny"], ["15", "time15"], ["30", "time30"], ["60", "timeHour"], ["240", "timeHalfDay"]];

// The view options menu: the release mode, one entry per profile, then (with the Steps box) the
// time I have and the devices in hand. The current choice is ticked. The mode applies to every
// project on the board. The Steps choices travel as JSON on the menu: the page script changes
// one and sends the whole selection, the same message the old chips sent.
export function viewMenu(t: BoardStrings, profile: string, sittings?: BoardModel["sittings"]): string {
  const opts: Array<[string, string]> = [["rush", t.profileRush], ["deliberate", t.profileDeliberate], ["zero", t.profileZero]];
  const tick = (on: boolean): string => (on ? "\u2713 " : "");
  const head = (key: string): string => `<div class="mh" role="presentation" ${tip(t, key + "Tip")}>${escapeHtml(pl(t, key))}</div>`;
  const steps = sittings
    ? `${head("timeLabel")}${TIME_LABELS.map(([n, key]) => item("box:" + n, tick(sittings.timeBox === n) + pl(t, key), pl(t, n === "any" ? "timeAnyTip" : "timeTip", { label: pl(t, key) }), ` aria-checked="${sittings.timeBox === n}"`, "menuitemradio")).join("")}`
      + (sittings.contexts.length > 0
        ? `${head("haveLabel")}${item("haveall", tick(sittings.have.length === sittings.contexts.length) + pl(t, "haveAll"), pl(t, "chipAll"), ` aria-checked="${sittings.have.length === sittings.contexts.length}"`, "menuitemcheckbox")}${sittings.contexts.map((c) => item("have:" + c.id, tick(sittings.have.includes(c.id)) + c.label, pl(t, "chip", { name: c.label }), ` aria-checked="${sittings.have.includes(c.id)}"`, "menuitemcheckbox")).join("")}`
        : "")
    : "";
  const sit = sittings ? ` data-sit="${escapeHtml(JSON.stringify({ have: sittings.have, box: sittings.timeBox, all: sittings.contexts.map((c) => c.id) }))}"` : "";
  return `<div class="menu" id="menu-view" role="menu" hidden${sit} aria-label="${escapeHtml(pl(t, "viewMenuList"))}" title="${escapeHtml(t.profileLabel)}">${opts.map(([v, text]) => item("profile:" + v, tick(profile === v) + text, pl(t, "profile." + v), ` aria-checked="${profile === v}"`, "menuitemradio")).join("")}${steps}</div>`;
}

// The project actions menu: scan again, the rules file, projects, keywords, settings and the
// start-up choice (left out when its state is unknown, as in a plain-browser layout check).
export function optsMenu(t: BoardStrings, startup?: boolean): string {
  const kw = t.keywordLabels?.edit ? item("keywords", t.keywordLabels.menu, t.keywordLabels.menuTip) : "";
  const boot = startup === undefined ? "" : item("startup", (startup ? "\u2713 " : "") + label(t, "startup"), label(t, "startupTip"), ` data-on="${startup ? 1 : 0}"`);
  return `<div class="menu" id="menu-opts" role="menu" hidden aria-label="${escapeHtml(pl(t, "optsMenuList"))}" title="${escapeHtml(pl(t, "optsMenuList"))}">${item("refresh", t.refresh, pl(t, "refresh"))}${item("rules", t.ptgOpenRules, pl(t, "menuRulesTip"))}${item("projects", label(t, "projects"), label(t, "projectsTip"))}${kw}${item("settings", label(t, "settings"), label(t, "settingsTip"))}${boot}</div>`;
}
