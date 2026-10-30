import { BoardStrings, escapeHtml, pl } from "./boardHtmlUtil";
import { label } from "./boardHtmlProjects";
import { hl } from "./boardHtmlHandoff";

// The pop-up menus of the board: one for the actions on a document row and one for the board
// options. Each is drawn once per page; the small kebab button on a row or in the top bar opens
// it and the page script moves it next to that button. A row's kebab carries only the item's
// index. Pure.

// The kebab button of a row (`id` is the item's index), of a project or group heading (`id` is
// "project:<index>" or "group:<first item>", `title` its name) or of the top bar (no id).
export function kebab(t: BoardStrings, menu: "row" | "opts" | "scope", id?: number | string, title = ""): string {
  const text = menu === "row" ? pl(t, "rowMenu", { title }) : menu === "scope" ? hl(t, "scopeMenu").replace("{name}", () => title) : pl(t, "optsMenu");
  const at = id === undefined ? "" : ` data-id="${id}"`;
  return `<button type="button" class="kb sec" data-menu="${menu}"${at} aria-haspopup="menu" aria-expanded="false" aria-controls="menu-${menu}" title="${escapeHtml(text)}" aria-label="${escapeHtml(text)}">⋮</button>`;
}

const item = (act: string, text: string, tipText: string): string => `<button type="button" class="mi" role="menuitem" data-act="${act}" title="${escapeHtml(tipText)}">${escapeHtml(text)}</button>`;

// The row menu: open the document, change its status or severity, set both back to automatic, add a rule for its folder, hand it off to an AI,
// open the rules file.
export function rowMenu(t: BoardStrings): string {
  return `<div class="menu" id="menu-row" role="menu" hidden aria-label="${escapeHtml(pl(t, "rowMenuList"))}" title="${escapeHtml(pl(t, "rowMenuList"))}">${item("open", pl(t, "menuOpen"), pl(t, "menuOpenTip"))}${item("status", pl(t, "menuStatus"), pl(t, "menuStatusTip"))}${item("severity", pl(t, "menuSeverity"), pl(t, "menuSeverityTip"))}${item("auto", pl(t, "menuAuto"), pl(t, "menuAutoTip"))}${item("assign", pl(t, "menuAssign"), pl(t, "menuAssignTip"))}${item("hand", hl(t, "menuItem"), hl(t, "menuItemTip"))}${item("rules", t.ptgOpenRules, pl(t, "menuRulesTip"))}</div>`;
}

// The menu of a project or group heading: one entry that hands that scope off.
export function scopeMenu(t: BoardStrings): string {
  return `<div class="menu" id="menu-scope" role="menu" hidden aria-label="${escapeHtml(hl(t, "menuItem"))}" title="${escapeHtml(hl(t, "menuItem"))}">${item("hand", hl(t, "menuItem"), hl(t, "menuItemTip"))}</div>`;
}

// The board options menu: the rules file is opened only from here and from the row menu.
export function optsMenu(t: BoardStrings): string {
  const kw = t.keywordLabels?.edit ? item("keywords", t.keywordLabels.menu, t.keywordLabels.menuTip) : "";
  return `<div class="menu" id="menu-opts" role="menu" hidden aria-label="${escapeHtml(pl(t, "optsMenuList"))}" title="${escapeHtml(pl(t, "optsMenuList"))}">${item("handBoard", hl(t, "menuBoard"), hl(t, "menuBoardTip"))}${item("rules", t.ptgOpenRules, pl(t, "menuRulesTip"))}${item("projects", label(t, "projects"), label(t, "projectsTip"))}${kw}${item("settings", label(t, "settings"), label(t, "settingsTip"))}</div>`;
}

