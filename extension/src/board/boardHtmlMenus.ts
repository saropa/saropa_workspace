import type { BoardItem, BoardModel, BoardProject } from "./boardModel";
import { SEVERITY_LEVELS } from "./ruleAssign";
import { asProfile, stops } from "./severity";
import { BoardStrings, escapeHtml, pl, tip } from "./boardHtmlUtil";
import { label } from "./boardHtmlProjects";
import { hl } from "./boardHtmlHandoff";
import { GROUP_BYS, GroupBy } from "./types";
import { readsNeeds } from "./docFacts";

// The pop-up menus of the board: one for the actions on a document row and one for the board
// options. Each is drawn once per page; the small kebab button on a row or in the top bar opens
// it and the page script moves it next to that button. A row's kebab carries only the item's
// index. Pure.

// The kebab button of a row (`id` is the item's index), of a project or group heading (`id` is
// "project:<index>" or "group:<first item>", `title` its name) or of the top bar (no id): "view"
// holds the view options, "opts" the project actions.
export function kebab(t: BoardStrings, menu: "row" | "fut" | "opts" | "view" | "scope", id?: number | string, title = "", extra = ""): string {
  const text = menu === "row" ? pl(t, "rowMenu", { title }) : menu === "fut" ? pl(t, "futureMenu", { title }) : menu === "scope" ? hl(t, "scopeMenu").replace("{name}", () => title) : pl(t, menu === "view" ? "viewMenu" : "optsMenu");
  const at = (id === undefined ? "" : ` data-id="${id}"`) + extra;
  return `<button type="button" class="kb sec" data-menu="${menu}"${at} aria-haspopup="menu" aria-expanded="false" aria-controls="menu-${menu}" title="${escapeHtml(text)}" aria-label="${escapeHtml(text)}">${menu === "view" ? "\u2630" : "\u22EE"}</button>`;
}

export const item = (act: string, text: string, tipText: string, extra = "", role = "menuitem"): string => `<button type="button" class="mi" role="${role}" data-act="${escapeHtml(act)}"${extra} title="${escapeHtml(tipText)}">${escapeHtml(text)}</button>`;

// A status the row menu offers: the words of a category of the existing rules and its color.
export interface RowStatus {
  label: string;
  status: string;
  kind?: string;
}

// The string key of each Group by choice; its tooltip is the key plus "Tip".
export const GROUP_KEYS: Record<GroupBy, string> = { project: "groupProject", group: "groupGroup", status: "groupStatus", severity: "groupSeverity", none: "groupNone" };

const SHAPES: Record<string, string> = { red: "●", amber: "◆", purple: "◐", blue: "◇", green: "■", reference: "○" };

// What the page script needs to fill the row menu for one document: its status and severity, whether
// either was set by hand, whether it is pinned, and its project. Only values, never markup.
export function rowData(i: BoardItem): string {
  return ` data-st="${escapeHtml(i.status)}" data-sev="${escapeHtml(i.severity ?? "")}" data-by="${i.severityByUser || i.statusByUser ? 1 : 0}" data-pin="${i.pinned ? 1 : 0}" data-pj="${escapeHtml(i.project)}" data-kd="${escapeHtml(i.kind)}"${readsNeeds(i.path) ? "" : ' data-nd="1"'}`;
}

// The row menu: open the document, pick its status, change its severity (raise, lower, one of the
// five levels, back to automatic) with a line that says what the choice does to the release, pick
// what it waits on or blocks (left out for a document whose Needs lines the board does not read),
// add a rule for its folder, hand it off, open the rules file. A choice is saved at once. Status and
// severity entries need the rules' categories and the board's projects; without them (a plain
// layout check) they are left out.
export function rowMenu(t: BoardStrings, profile = "deliberate", projects: BoardProject[] = [], statuses: RowStatus[] = []): string {
  const hand = item("hand", hl(t, "menuItem"), hl(t, "menuItemTip"));
  const radio = (act: string, text: string, tipText: string, extra = ""): string => item(act, text, tipText, extra, "menuitemradio");
  const group = (key: string, body: string): string => `<div class="mh" role="presentation" id="mh-${key}" ${tip(t, key + "Tip")}>${escapeHtml(pl(t, key))}</div><div role="group" aria-labelledby="mh-${key}" ${tip(t, key + "Tip")}>${body}</div>`;
  const status = statuses.length === 0 ? "" : group("menuStatus", statuses.map((s, n) => radio("status:" + n, `${SHAPES[s.status] ?? "○"} ${s.label}`, pl(t, "menuStatusTip"), ` data-st="${escapeHtml(s.status)}" data-kd="${escapeHtml(s.kind ?? "")}" aria-checked="false"`)).join(""));
  const severity = group(
    "menuSeverity",
    item("raise", "▲ " + pl(t, "menuRaise"), pl(t, "menuRaiseTip")) + item("lower", "▼ " + pl(t, "menuLower"), pl(t, "menuLowerTip")) +
      SEVERITY_LEVELS.map((l) => radio("sev:" + l, pl(t, "sev." + l), pl(t, "menuSeverityTip"), ` data-lv="${l}" aria-checked="false"`)).join("") +
      item("auto", pl(t, "menuAuto"), pl(t, "menuAutoTip"))
  );
  const effect = { stops: pl(t, "effStops"), clears: pl(t, "effClears"), fixed: pl(t, "effFixed"), others: pl(t, "effOthers"), none: pl(t, "effNone"), sOn: pl(t, "effStatusOn"), sOff: pl(t, "effStatusOff"), sSame: pl(t, "effStatusSame"), lGo: pl(t, "effLightGo"), lNoGo: pl(t, "effLightNoGo") };
  const lists = ` data-stops="${escapeHtml(JSON.stringify(SEVERITY_LEVELS.filter((l) => stops(asProfile(profile), l))))}" data-pname="${escapeHtml(profile === "rush" ? t.profileRush : profile === "zero" ? t.profileZero : t.profileDeliberate)}" data-eff="${escapeHtml(JSON.stringify(effect))}" data-proj="${escapeHtml(JSON.stringify(Object.fromEntries(projects.map((p) => [p.id, [p.name, p.items.filter(blocksNow).length + p.blockedStopping]]))))}"`;
  const live = `<div role="group" aria-label="${escapeHtml(pl(t, "effLabel"))}" ${tip(t, "effLabel")}><div class="eff" id="eff" aria-live="polite" ${tip(t, "effLabel")}></div></div>`;
  return `<div class="menu" id="menu-row" role="menu" hidden${lists} aria-label="${escapeHtml(pl(t, "rowMenuList"))}" title="${escapeHtml(pl(t, "rowMenuList"))}">${item("open", pl(t, "menuOpen"), pl(t, "menuOpenTip"))}${status}${severity}${live}${item("waits", pl(t, "menuWaits"), pl(t, "menuWaitsTip"))}${item("blocks", pl(t, "menuBlocks"), pl(t, "menuBlocksTip"))}${item("group", pl(t, "menuGroup"), pl(t, "menuGroupTip"))}${item("assign", pl(t, "menuAssign"), pl(t, "menuAssignTip"))}${item("tags", pl(t, "menuTags"), pl(t, "menuTagsTip"))}${hand}${item("rules", t.ptgOpenRules, pl(t, "menuRulesTip"))}</div>`;
}

// True when an open document blocks the release now: a red folder or a stopping severity or pin.
export const blocksNow = (i: BoardItem): boolean => i.status === "red" || i.stopping;

// The bar shown after a save: what changed and Undo. It stays until the host takes it away
// (ten seconds after the write; never while an Undo has left files un-restored), a newer change, or Dismiss.
export function undoBar(t: BoardStrings, text: string | undefined): string {
  return text === undefined ? "" : `<div id="undo" role="status"><span>${escapeHtml(text)}</span><button type="button" class="sec" data-undo title="${escapeHtml(pl(t, "undoTip"))}">${escapeHtml(pl(t, "undo"))}</button><button type="button" class="sec" data-undo-x aria-label="${escapeHtml(pl(t, "undoDismiss"))}" title="${escapeHtml(pl(t, "undoDismiss"))}">\u00d7</button></div>`;
}

// The menu of a project or group heading: hand that scope off, or edit the tags that matched in it.
export function scopeMenu(t: BoardStrings): string {
  return `<div class="menu" id="menu-scope" role="menu" hidden aria-label="${escapeHtml(hl(t, "menuItem"))}" title="${escapeHtml(hl(t, "menuItem"))}">${item("hand", hl(t, "menuItem"), hl(t, "menuItemTip"))}${item("tags", pl(t, "menuTags"), pl(t, "menuTagsTip"))}</div>`;
}

// Names of the time boxes the Steps filter offers, with the minutes each means.
export const TIME_LABELS: Array<[string, string]> = [["any", "timeAny"], ["15", "time15"], ["30", "time30"], ["60", "timeHour"], ["240", "timeHalfDay"]];

// The menu behind each setting pill of the top line. Each holds radio (or, for devices, checkbox)
// entries with the current choice ticked. They sit in one wrapper that carries the Steps
// selection as JSON: the page script changes one choice and sends the whole selection.
export function scopeTotal(model: BoardModel, scope: "all" | "openOnly"): number {
  return model.projects.length + (scope === "all" ? (model.skipped?.length ?? 0) : (model.hidden ?? 0));
}

export function pillMenus(t: BoardStrings, model: BoardModel, scope?: "all" | "openOnly", groupBy?: GroupBy): string {
  const { profile, sittings } = model;
  const menu = (id: string, aria: string, body: string): string => `<div class="menu" id="menu-${id}" role="menu" hidden aria-label="${escapeHtml(aria)}" title="${escapeHtml(aria)}">${body}</div>`;
  const radio = (act: string, text: string, tipText: string, on: boolean): string => item(act, text, tipText, ` aria-checked="${on}"`, "menuitemradio");
  const out: string[] = [];
  if (scope !== undefined) {
    out.push(menu("pscope", pl(t, "scopeGroup"), radio("scope:openOnly", pl(t, "scopeThis"), pl(t, "scopeThisTip"), scope === "openOnly") + radio("scope:all", pl(t, "scopeAll"), pl(t, "scopeAllTip", { count: scopeTotal(model, scope) }), scope === "all")));
  }
  const opts: Array<[string, string]> = [["rush", t.profileRush], ["deliberate", t.profileDeliberate], ["zero", t.profileZero]];
  out.push(menu("pmode", t.profileLabel, opts.map(([v, text]) => radio("profile:" + v, text, pl(t, "profile." + v), profile === v)).join("")));
  if (groupBy !== undefined) {
    out.push(menu("pgroup", pl(t, "groupBy"), GROUP_BYS.map((g) => radio("group:" + g, pl(t, GROUP_KEYS[g]), pl(t, GROUP_KEYS[g] + "Tip"), groupBy === g)).join("")));
  }
  if (sittings) {
    out.push(menu("ptime", pl(t, "timeLabel"), TIME_LABELS.map(([n, key]) => radio("box:" + n, pl(t, key), pl(t, n === "any" ? "timeAnyTip" : "timeTip", { label: pl(t, key) }), sittings.timeBox === n)).join("")));
    if (sittings.contexts.length > 0) {
      const check = (act: string, text: string, tipText: string, on: boolean): string => item(act, text, tipText, ` aria-checked="${on}"`, "menuitemcheckbox");
      out.push(menu("phave", pl(t, "haveLabel"), check("haveall", pl(t, "haveAll"), pl(t, "chipAll"), sittings.have.length === sittings.contexts.length) + sittings.contexts.map((c) => check("have:" + c.id, c.label, pl(t, "chip", { name: c.label }), sittings.have.includes(c.id))).join("")));
    }
  }
  const sit = sittings ? ` data-sit="${escapeHtml(JSON.stringify({ have: sittings.have, box: sittings.timeBox, all: sittings.contexts.map((c) => c.id) }))}"` : "";
  return `<div id="pill-menus"${sit}>${out.join("")}</div>`;
}

// The view menu now holds only the tags and rules entry; empty (and its kebab left out) without it.
export function viewMenu(t: BoardStrings): string {
  if (!t.projectLabels?.tagsRules) {
    return "";
  }
  return `<div class="menu" id="menu-view" role="menu" hidden aria-label="${escapeHtml(pl(t, "viewMenuList"))}" title="${escapeHtml(pl(t, "viewMenuList"))}">${item("tagsRules", label(t, "tagsRules"), label(t, "tagsRulesTip"))}</div>`;
}

// The project actions menu: scan again, the rules file, projects, keywords, settings and the
// start-up choice (left out when its state is unknown, as in a plain-browser layout check). While the
// hint is up, the menu leads with the entry that hides the hint.
export function optsMenu(t: BoardStrings, startup?: boolean, hint?: boolean): string {
  const kw = t.keywordLabels?.edit ? item("keywords", t.keywordLabels.menu, t.keywordLabels.menuTip) : "";
  const boot = startup === undefined ? "" : item("startup", (startup ? "\u2713 " : "") + label(t, "startup"), label(t, "startupTip"), ` data-on="${startup ? 1 : 0}"`);
  const add = hint ? item("hintDismiss", label(t, "hintDismissTip"), label(t, "hintDismissTip")) : "";
  return `<div class="menu" id="menu-opts" role="menu" hidden aria-label="${escapeHtml(pl(t, "optsMenuList"))}" title="${escapeHtml(pl(t, "optsMenuList"))}">${add}${item("handBoard", hl(t, "menuBoard"), hl(t, "menuBoardTip"))}${item("organize", hl(t, "menuOrganize"), hl(t, "menuOrganizeTip"))}${item("bringBack", hl(t, "menuBack"), hl(t, "menuBackTip"))}${item("refresh", t.refresh, pl(t, "refresh"))}${item("rules", t.ptgOpenRules, pl(t, "menuRulesTip"))}${item("projects", label(t, "projects"), label(t, "projectsTip"))}${kw}${item("settings", label(t, "settings"), label(t, "settingsTip"))}${boot}</div>`;
}
