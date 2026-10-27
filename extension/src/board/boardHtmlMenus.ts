import { BoardStrings, escapeHtml, pl } from "./boardHtmlUtil";
import { label } from "./boardHtmlProjects";

// The pop-up menus of the board: one for the actions on a document row and one for the board
// options. Each is drawn once per page; the small kebab button on a row or in the top bar opens
// it and the page script moves it next to that button. A row's kebab carries only the item's
// index. Pure.

// The kebab button of a row (`id` is the item's index) or of the top bar (no id).
export function kebab(t: BoardStrings, menu: "row" | "opts", id?: number, title = ""): string {
  const text = menu === "row" ? pl(t, "rowMenu", { title }) : pl(t, "optsMenu");
  const at = id === undefined ? "" : ` data-id="${id}"`;
  return `<button type="button" class="kb sec" data-menu="${menu}"${at} aria-haspopup="menu" aria-expanded="false" aria-controls="menu-${menu}" title="${escapeHtml(text)}" aria-label="${escapeHtml(text)}">⋮</button>`;
}

const item = (act: string, text: string, tipText: string): string => `<button type="button" class="mi" role="menuitem" data-act="${act}" title="${escapeHtml(tipText)}">${escapeHtml(text)}</button>`;

// The row menu: open the document, change its status, add a rule for its folder, hand it to chat,
// open the rules file. The Hand to chat entry is left out when that feature is off.
export function rowMenu(t: BoardStrings): string {
  const hand = t.handToChat ? item("hand", t.handToChat, t.handToChatTip) : "";
  return `<div class="menu" id="menu-row" role="menu" hidden aria-label="${escapeHtml(pl(t, "rowMenuList"))}" title="${escapeHtml(pl(t, "rowMenuList"))}">${item("open", pl(t, "menuOpen"), pl(t, "menuOpenTip"))}${item("status", pl(t, "menuStatus"), pl(t, "menuStatusTip"))}${item("assign", pl(t, "menuAssign"), pl(t, "menuAssignTip"))}${hand}${item("rules", t.ptgOpenRules, pl(t, "menuRulesTip"))}</div>`;
}

// The board options menu: the rules file is opened only from here and from the row menu.
export function optsMenu(t: BoardStrings): string {
  return `<div class="menu" id="menu-opts" role="menu" hidden aria-label="${escapeHtml(pl(t, "optsMenuList"))}" title="${escapeHtml(pl(t, "optsMenuList"))}">${item("rules", t.ptgOpenRules, pl(t, "menuRulesTip"))}${item("projects", label(t, "projects"), label(t, "projectsTip"))}${item("settings", label(t, "settings"), label(t, "settingsTip"))}</div>`;
}

