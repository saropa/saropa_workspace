// The pop-up menus of the board page (row, scope, options, the setting pills, the undo bar and the kebab buttons)
// parsed into the fake DOM and checked as a user's browser and a screen reader would see them: valid ARIA roles and
// the attributes each role requires, ids that exist, interpolated values as text rather than markup, and the
// states (checked, pressed, hidden) the page script and the host rely on. The existing menu tests assert on
// substrings of the markup; these read the parsed tree, so a broken tag or a leaked attribute shows up.
// Clicking a menu entry posts through the main page script, which is not run here; the entry's data-act is what
// that script reads, so the tests pin the data-act values and the host side lives in the board panel tests.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { BoardItem, BoardModel, BoardProject } from "../../board/boardModel";
import { GROUP_KEYS, TIME_LABELS, item, kebab, optsMenu, pillMenuLabel, pillMenus, rowData, rowMenu, scopeMenu, scopeTotal, undoBar, type RowStatus } from "../../board/boardHtmlMenus";
import { pl } from "../../board/boardHtmlUtil";
import { SEVERITY_LEVELS } from "../../board/ruleAssign";
import { GROUP_BYS } from "../../board/types";
import type { FakeElement, Page } from "../_stub/fakeDom";
import { EVIL, ariaProblems, openBoardPage, t } from "./boardWebviewFixture";

const STATUSES: RowStatus[] = [{ label: EVIL, status: "red", kind: "bug" }, { label: "Done", status: "green" }];
const PROJECTS = [{ id: "app", name: EVIL, items: [{ blocks: true }, { blocks: false }], blockedStopping: 1 }] as unknown as BoardProject[];
const MODEL = {
  profile: "deliberate",
  projects: [{ answered: true }, { answered: false }],
  skipped: [{}, {}, {}],
  hidden: 4,
  sittings: { timeBox: "30", have: ["c1"], contexts: [{ id: "c1", label: "Phone" }, { id: "c2", label: EVIL }] },
} as unknown as BoardModel;

/** Every menu of the page in one document, as the board paints them, so cross-menu id clashes show up. */
function allMenus(): Page {
  return openBoardPage([
    kebab(t, "row", 3, EVIL), kebab(t, "opts"), kebab(t, "scope", "project:0", EVIL),
    rowMenu(t, "deliberate", PROJECTS, STATUSES), scopeMenu(t), optsMenu(t, true, true), pillMenus(t, MODEL, "all", "group"), undoBar(t, EVIL),
  ].join(""));
}

const itemsOf = (page: Page, menu: string): FakeElement[] => page.all(`#${menu} .mi`);
const acts = (page: Page, menu: string): Array<string | undefined> => itemsOf(page, menu).map((b) => b.dataset.act);

test("every menu entry sits inside a role=menu container and is a typed button with an action and a tooltip", () => {
  const page = allMenus();
  const entries = page.all("[role=menuitem], [role=menuitemradio], [role=menuitemcheckbox]");
  assert.ok(entries.length > 30, "the page has the menus' entries");
  for (const e of entries) {
    assert.ok(e.closest("[role=menu]"), `${e.dataset.act} has no menu above it`);
    assert.equal(e.tag, "button");
    assert.equal(e.getAttribute("type"), "button");
    assert.ok((e.dataset.act ?? "").length > 0, "an entry without data-act does nothing");
    assert.ok((e.getAttribute("title") ?? "").length > 0, `${e.dataset.act} has no tooltip`);
  }
});

test("radio and checkbox entries state their checked value; plain entries state none", () => {
  const page = allMenus();
  for (const e of page.all("[role=menuitemradio], [role=menuitemcheckbox]")) {
    assert.ok(["true", "false"].includes(e.getAttribute("aria-checked") ?? ""), `${e.dataset.act} needs aria-checked`);
  }
  for (const e of page.all("[role=menuitem]")) {
    assert.equal(e.hasAttribute("aria-checked"), false, `${e.dataset.act} is a plain entry`);
  }
});

test("each menu is a named, closed menu with a unique id, and no ARIA reference dangles", () => {
  const page = allMenus();
  const menus = page.all("[role=menu]");
  assert.deepEqual(menus.map((m) => m.id), ["menu-row", "menu-scope", "menu-opts", "menu-pscope", "menu-pgroup", "menu-ptime", "menu-phave"]);
  for (const m of menus) {
    assert.equal(m.hasAttribute("hidden"), true, `${m.id} starts closed`);
    assert.ok((m.getAttribute("aria-label") ?? "").length > 0, `${m.id} needs a name`);
  }
  assert.deepEqual(ariaProblems(page), []);
});

test("a kebab button announces a menu, starts collapsed and points at a menu that exists", () => {
  const page = allMenus();
  for (const k of page.all(".kb")) {
    assert.equal(k.getAttribute("aria-haspopup"), "menu");
    assert.equal(k.getAttribute("aria-expanded"), "false");
    assert.equal(k.getAttribute("type"), "button");
    assert.ok(page.byId(k.getAttribute("aria-controls") ?? ""), "the controlled menu is on the page");
    assert.equal(k.getAttribute("aria-label"), k.getAttribute("title"));
  }
  assert.equal(page.one('.kb[data-menu="row"]').dataset.id, "3");
  assert.equal(page.one('.kb[data-menu="row"]').getAttribute("aria-label"), pl(t, "rowMenu", { title: EVIL }));
  assert.equal(page.one('.kb[data-menu="opts"]').hasAttribute("data-id"), false, "the options button names no item");
});

test("the future-row kebab names its row and points at its own menu id", () => {
  const page = openBoardPage(kebab(t, "fut", 2, EVIL, ' data-x="1"'));
  const k = page.one(".kb");
  assert.equal(k.getAttribute("aria-controls"), "menu-fut");
  assert.equal(k.getAttribute("aria-label"), pl(t, "futureMenu", { title: EVIL }));
  assert.equal(k.dataset.x, "1");
  assert.equal(page.all("img").length, 0);
});

test("no value interpolated into any menu becomes an element: names, labels and project names stay text", () => {
  const page = allMenus();
  assert.equal(page.all("img").length, 0);
  assert.equal(page.all("script").length, 0);
  assert.ok(page.all("[role=menuitemradio]").some((r) => r.textContent.includes(EVIL)), "the status label is shown as text");
  assert.ok(page.all("[role=menuitemcheckbox]").some((r) => r.textContent === EVIL), "the context label is shown as text");
  assert.equal(page.one("#undo span").textContent, EVIL);
});

test("the row menu offers one radio per status the rules can set, each carrying its status and kind", () => {
  const page = allMenus();
  const radios = itemsOf(page, "menu-row").filter((b) => (b.dataset.act ?? "").startsWith("status:"));
  assert.deepEqual(radios.map((r) => r.dataset.act), ["status:0", "status:1"]);
  assert.equal(radios[0].dataset.st, "red");
  assert.equal(radios[0].dataset.kd, "bug");
  assert.equal(radios[1].dataset.kd, "", "a category with no kind carries an empty one");
  assert.equal(radios.every((r) => r.getAttribute("role") === "menuitemradio" && r.getAttribute("aria-checked") === "false"), true, "none starts chosen; the page ticks the row's own");
});

test("without statuses the row menu leaves the status group out, and the severity group still lists every level", () => {
  const page = openBoardPage(rowMenu(t));
  assert.equal(page.all("#mh-menuStatus").length, 0);
  const levels = itemsOf(page, "menu-row").filter((b) => (b.dataset.act ?? "").startsWith("sev:")).map((b) => b.dataset.lv);
  assert.deepEqual(levels, [...SEVERITY_LEVELS]);
  assert.ok(acts(page, "menu-row").includes("raise") && acts(page, "menu-row").includes("lower") && acts(page, "menu-row").includes("auto"));
});

test("each menu group is a role=group named by its own heading, and the heading is presentational", () => {
  const page = openBoardPage(rowMenu(t, "deliberate", PROJECTS, STATUSES));
  for (const head of page.all(".mh")) {
    assert.equal(head.getAttribute("role"), "presentation");
    const group = page.one(`[role=group][aria-labelledby="${head.id}"]`);
    assert.ok(group, `${head.id} labels a group`);
  }
  assert.ok(page.one("#eff").getAttribute("aria-live"), "the effect line is a live region");
});

test("the row menu carries the data the page needs as JSON that parses, with the project names as data only", () => {
  const menu = openBoardPage(rowMenu(t, "rush", PROJECTS, STATUSES)).one("#menu-row");
  const proj = JSON.parse(menu.dataset.proj ?? "") as Record<string, [string, number]>;
  assert.deepEqual(proj.app, [EVIL, 2], "one blocking item plus the stopping count");
  assert.ok(Array.isArray(JSON.parse(menu.dataset.stops ?? "")));
  assert.equal(typeof JSON.parse(menu.dataset.eff ?? ""), "object");
  assert.equal(menu.dataset.pname, t.profileRush);
});

test("the row data an item gives the menu is values only, escaped, with the needs flag on documents that read none", () => {
  const base = { status: "red", severity: "high", severityByUser: false, statusByUser: true, pinned: true, answered: true, project: EVIL, kind: "bug", path: "a.md", makeDep: true } as unknown as BoardItem;
  const md = openBoardPage(`<div id="r"${rowData(base)}></div>`);
  const row = md.one("#r");
  assert.equal(row.dataset.pj, EVIL);
  assert.equal(row.dataset.st, "red");
  assert.equal(row.dataset.sev, "high");
  assert.equal(row.dataset.by, "1", "a status set by hand counts");
  assert.equal(row.dataset.pin, "1");
  assert.equal(row.dataset.ab, "1");
  assert.equal(row.dataset.oa, "1");
  assert.equal(row.hasAttribute("data-nd"), false);
  assert.equal(md.all("img").length, 0);
  const sql = openBoardPage(`<div id="r"${rowData({ ...base, path: "q.sql", makeDep: false, answered: false, pinned: false, severity: undefined, statusByUser: false } as unknown as BoardItem)}></div>`).one("#r");
  assert.equal(sql.hasAttribute("data-nd"), true);
  assert.equal(sql.hasAttribute("data-oa"), false);
  assert.equal(sql.hasAttribute("data-ab"), false);
  assert.equal(sql.dataset.sev, "");
  assert.equal(sql.dataset.by, "0");
  assert.equal(sql.dataset.pin, "0");
});

test("the entry builder escapes its action, text and tooltip, and falls back to a hollow shape for an unknown one", () => {
  const page = openBoardPage(item(EVIL, EVIL, EVIL, "", "menuitemradio", "nope"));
  const b = page.one("button");
  assert.equal(b.dataset.act, EVIL);
  assert.equal(b.getAttribute("title"), EVIL);
  assert.equal(b.textContent.endsWith(EVIL), true);
  assert.equal(page.one(".sg").textContent, "○");
  assert.equal(page.one(".sg").getAttribute("aria-hidden"), "true", "the shape is decoration; the words carry the meaning");
  assert.equal(page.all("img").length, 0);
});

test("the scope menu lists the heading actions in order, with the hand-off first", () => {
  const page = openBoardPage(scopeMenu(t));
  assert.deepEqual(acts(page, "menu-scope"), ["hand", "tags", "gRename", "gEmoji", "gColour", "gMerge", "gTag", "gAuto", "ask", "order"]);
});

test("the options menu leads with the hint entry only while the hint is up, and marks the start-up choice", () => {
  const plain = openBoardPage(optsMenu(t));
  assert.equal(acts(plain, "menu-opts")[0], "handBoard");
  assert.equal(acts(plain, "menu-opts").includes("startup"), false, "an unknown start-up state leaves the entry out");
  const on = openBoardPage(optsMenu(t, true, true));
  assert.equal(acts(on, "menu-opts")[0], "hintDismiss");
  const boot = on.one('[data-act="startup"]');
  assert.equal(boot.dataset.on, "1");
  assert.equal(boot.textContent.startsWith("✓"), true);
  const off = openBoardPage(optsMenu(t, false)).one('[data-act="startup"]');
  assert.equal(off.dataset.on, "0");
  assert.equal(off.textContent.startsWith("✓"), false);
});

test("the options menu leaves the keyword editor out when it is switched off and the tags entry out when it has no label", () => {
  const off = { ...t, keywordLabels: { ...t.keywordLabels, edit: "" }, projectLabels: { ...t.projectLabels, tagsRules: "" } };
  const acts1 = acts(openBoardPage(optsMenu(off)), "menu-opts");
  assert.equal(acts1.includes("keywords"), false);
  assert.equal(acts1.includes("tagsRules"), false);
  const withBoth = acts(openBoardPage(optsMenu(t)), "menu-opts");
  assert.equal(withBoth.includes("settings"), true);
});

test("the pill menus tick the current scope, mode and grouping, one each", () => {
  const page = openBoardPage(pillMenus(t, MODEL, "openOnly", "status"));
  const ticked = (menu: string): Array<string | undefined> => page.all(`#${menu} [aria-checked=true]`).map((b) => b.dataset.act);
  assert.deepEqual(ticked("menu-pscope"), ["scope:openOnly", "profile:deliberate"]);
  assert.deepEqual(ticked("menu-pgroup"), ["group:status"]);
  assert.deepEqual(ticked("menu-ptime"), ["box:30"]);
  assert.deepEqual(page.all("#menu-pgroup .mi").map((b) => b.dataset.act), GROUP_BYS.map((g) => "group:" + g));
  assert.deepEqual(page.all("#menu-ptime .mi").map((b) => b.dataset.act), TIME_LABELS.map(([n]) => "box:" + n));
});

test("the pill menus carry the selection as JSON, name the chosen contexts, and tick All only when every context is chosen", () => {
  const page = openBoardPage(pillMenus(t, MODEL, "all", "none"));
  const sit = JSON.parse(page.one("#pill-menus").dataset.sit ?? "") as { have: string[]; box: string; all: string[] };
  assert.deepEqual(sit, { have: ["c1"], box: "30", all: ["c1", "c2"] });
  assert.equal(page.one('[data-act="haveall"]').getAttribute("aria-checked"), "false");
  assert.deepEqual(page.all("#menu-phave [role=menuitemcheckbox]").map((b) => b.getAttribute("aria-checked")), ["false", "true", "false"]);
  const all = openBoardPage(pillMenus(t, { ...MODEL, sittings: { ...MODEL.sittings!, have: ["c1", "c2"] } } as unknown as BoardModel, "all"));
  assert.equal(all.one('[data-act="haveall"]').getAttribute("aria-checked"), "true");
});

test("without a scope, a grouping or sittings the pill menus leave those parts out and name the mode alone", () => {
  const page = openBoardPage(pillMenus(t, { ...MODEL, sittings: undefined } as unknown as BoardModel));
  assert.deepEqual(page.all("[role=menu]").map((m) => m.id), ["menu-pscope"]);
  assert.equal(page.one("#menu-pscope").getAttribute("aria-label"), t.profileLabel);
  assert.equal(page.one("#pill-menus").hasAttribute("data-sit"), false);
  // The fake selector engine has no prefix operator, so the actions are listed and filtered here.
  assert.equal(page.all("[data-act]").filter((b) => (b.dataset.act ?? "").startsWith("scope:")).length, 0);
});

test("the mode menu says how many answered projects keep their marks, only when there are some", () => {
  const withMarks = openBoardPage(pillMenus(t, MODEL, "all"));
  assert.equal(withMarks.one("#menu-pscope .note").textContent, pl(t, "profileMarks", { count: 1 }));
  const none = openBoardPage(pillMenus(t, { ...MODEL, projects: [{ answered: false }] } as unknown as BoardModel, "all"));
  assert.equal(none.all(".note").length, 0);
});

test("a context-less sittings model offers the time menu but no have menu", () => {
  const page = openBoardPage(pillMenus(t, { ...MODEL, sittings: { timeBox: "any", have: [], contexts: [] } } as unknown as BoardModel));
  assert.deepEqual(page.all("[role=menu]").map((m) => m.id), ["menu-pscope", "menu-ptime"]);
});

test("the scope total counts open projects plus, by scope, the unreadable ones or the hidden ones", () => {
  assert.equal(scopeTotal(MODEL, "all"), 2 + 3);
  assert.equal(scopeTotal(MODEL, "openOnly"), 2 + 4);
  assert.equal(scopeTotal({ projects: [] } as unknown as BoardModel, "all"), 0, "a model with neither list counts zero");
  assert.equal(scopeTotal({ projects: [] } as unknown as BoardModel, "openOnly"), 0);
});

test("the mode menu is named for both choices when a scope is known, else for the mode alone", () => {
  assert.equal(pillMenuLabel(t, true), `${pl(t, "scopeGroup")} / ${t.profileLabel}`);
  assert.equal(pillMenuLabel(t, false), t.profileLabel);
});

test("every grouping choice has a label key, so the group menu never shows a raw key", () => {
  for (const g of GROUP_BYS) {
    assert.ok(GROUP_KEYS[g], g);
    assert.notEqual(pl(t, GROUP_KEYS[g]), GROUP_KEYS[g], `${g} has text in the table`);
  }
});

test("the undo bar is a status region with Undo and Dismiss as real buttons, and is absent with no text", () => {
  assert.equal(undoBar(t, undefined), "");
  const page = openBoardPage(undoBar(t, EVIL));
  assert.equal(page.one("#undo").getAttribute("role"), "status");
  const buttons = page.all("#undo button");
  assert.equal(buttons.length, 2);
  assert.equal(buttons.every((b) => b.getAttribute("type") === "button"), true);
  assert.ok(page.one("[data-undo]").textContent.length > 0, "Undo has visible text");
  assert.ok((page.one("[data-undo-x]").getAttribute("aria-label") ?? "").length > 0, "the icon-only Dismiss button has a name");
  assert.equal(page.all("img").length, 0);
});
