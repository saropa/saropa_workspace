// The header of the board page: scope switch, tabs and two kebabs on one line, the line of
// applied filters, and the calm rules (no brackets around counts, tinted NO-GO light).

import { test } from "node:test";
import assert from "node:assert/strict";
import { renderBoard } from "../../board/boardHtml";
import { filterLine, settingPills, sinceLink, topBar } from "../../board/boardHtmlHeader";
import { pillMenus } from "../../board/boardHtmlMenus";
import { STYLE } from "../../board/boardHtmlAssets";
import { buildBoard } from "../../board/boardModel";
import { BoardConfig } from "../../board/types";
import { verdict } from "../../board/boardHtmlRows";
import { strings } from "../../views/boardStrings";
import en from "../../i18n/locales/en.json";

const cfg: BoardConfig = { version: 1, ignore: [], ruleSets: {}, projects: [{ id: "app", name: "App", path: "app", roots: ["docs"], ruleSets: [] }] };
const t = strings();

test("the scope pill shows the current scope and the project count, and opens a two-item radio menu", () => {
  const m = buildBoard(cfg, [], undefined, true);
  const all = settingPills(m, "all", t);
  assert.match(all, /data-menu="pscope"[^>]*aria-haspopup="menu" aria-expanded="false" aria-controls="menu-pscope"[^>]*>All \d+</);
  assert.ok(all.includes('class="fp pm sec"'));
  assert.ok(settingPills(m, "openOnly", t).includes(">This project</button>"));
  assert.equal(settingPills(m, undefined, t).includes("pscope"), false, "left out when the scope is unknown");
  const menu = pillMenus(t, m, "all");
  assert.ok(menu.includes('id="menu-pscope" role="menu"'));
  assert.ok(menu.includes('role="menuitemradio" data-act="scope:openOnly" aria-checked="false"'));
  assert.ok(menu.includes('role="menuitemradio" data-act="scope:all" aria-checked="true"'));
});

test("the mode pill carries the detail in its tooltip and opens the three profile entries", () => {
  const m = buildBoard(cfg, [], undefined, true);
  const html = settingPills(m, "all", t);
  assert.match(html, /data-menu="pmode"[^>]*>Deliberate</);
  assert.ok(html.includes("Red folders and failing lint, tests or build block in every mode"));
  assert.ok(html.includes("extreme, critical and high items block"));
  const menu = pillMenus(t, m);
  for (const v of ["rush", "deliberate", "zero"]) {
    assert.ok(menu.includes(`data-act="profile:${v}"`), v);
  }
});

test("the group, time and devices pills appear only when their data is known", () => {
  const bare = buildBoard(cfg, [], undefined, true);
  const none = settingPills(bare, "all", t);
  assert.equal(/pgroup|ptime|phave/.test(none), false);
  assert.ok(settingPills(bare, "all", t, "status").includes('data-menu="pgroup"'));
  const sit = buildBoard(cfg, [], undefined, true, undefined, undefined, undefined, { sittings: { selection: { timeBox: "30", maxSteps: 10 }, onlyOwner: false } });
  const html = settingPills(sit, "all", t);
  assert.ok(html.includes('data-menu="ptime"') && html.includes(">30 min</button>"));
  const v = sit.sittings;
  assert.ok(v);
  assert.equal(html.includes("phave"), v.contexts.length > 0);
  if (v.contexts.length > 0) {
    assert.ok(html.includes(`>Have: ${v.have.length} of ${v.contexts.length}</button>`));
    assert.ok(pillMenus(t, sit).includes('role="menuitemcheckbox" data-act="haveall"'));
  }
});

test("the top line holds the pills, the tabs and the kebabs; the view kebab shows only with its entry", () => {
  const m = buildBoard(cfg, [], undefined, true);
  const html = topBar(m, t, "openOnly", "<TABS>", undefined, undefined, "project");
  assert.ok(html.indexOf('data-menu="pscope"') < html.indexOf('data-menu="pmode"') && html.indexOf('data-menu="pgroup"') < html.indexOf("<TABS>"));
  assert.ok(html.indexOf("<TABS>") < html.indexOf('data-menu="opts"'));
  assert.equal(html.includes("data-scope"), false, "the two-button switch is gone");
  const withEntry = topBar(m, { ...t, projectLabels: { ...t.projectLabels, tagsRules: "x" } } as typeof t, "openOnly", "<TABS>");
  assert.ok(withEntry.includes('data-menu="view"'));
});

test("the page keeps the view menu only when it has an entry, and the scope message is posted from the pill menu", () => {
  const html = renderBoard(buildBoard(cfg, [], undefined, true), t, "n", 1, { scope: "all" });
  assert.equal(html.includes('id="menu-view"'), Boolean(t.projectLabels?.tagsRules));
  assert.ok(html.includes("{type:'scope',value:act.slice(6),rev:REV}"));
  assert.ok(html.includes("(m.id==='menu-ptime'||m.id==='menu-phave')&&/^(box:|have:|haveall)/.test(act)"));
  assert.ok(html.includes("document.getElementById('pill-menus')"));
});

test("the filter line is hidden with no filter, and shows a removable pill per applied filter with Clear all from two", () => {
  const base = buildBoard(cfg, [], undefined, true, undefined, undefined, undefined, { sittings: { selection: { timeBox: "any", maxSteps: 10 }, onlyOwner: false } });
  assert.equal(filterLine(base, t), "");
  const timed = buildBoard(cfg, [], undefined, true, undefined, undefined, undefined, { sittings: { selection: { timeBox: "30", maxSteps: 10 }, onlyOwner: false } });
  const one = filterLine(timed, t);
  assert.ok(one.includes("Time: 30 min") && one.includes('data-fclear="time"'));
  assert.equal(one.includes('data-fclear="all"'), false);
  assert.ok(one.includes('data-menu="ptime"') && one.includes('aria-controls="menu-ptime"'), "the label opens the time menu");
  const m = renderBoard(timed, t, "n");
  assert.ok(m.includes('class="fline"'));
  assert.equal(renderBoard(base, t, "n").includes('class="fline"'), false);
});

test("the page script clears a filter pill by sending the Sittings selection", () => {
  const html = renderBoard(buildBoard(cfg, [], undefined, true), t, "n");
  assert.ok(html.includes("data-fclear"), "the handler is in the script");
  assert.ok(html.includes("sitSend({...(k!=='have'?{box:'any'}:{}),...(k!=='time'?{have:SIT.all}:{})})"));
});

test("the header link to the change log shows only while something changed", () => {
  assert.equal(sinceLink(undefined, t), "");
  assert.equal(sinceLink({ heading: "h", marked: [], lines: [] }, t), "");
  const html = sinceLink({ heading: "h", marked: [], lines: [{ text: "x", details: [] }] }, t);
  assert.ok(html.includes("data-since-go") && html.includes('<span class="pill"'));
});

test("a NO-GO light is a tinted pill, not a solid red block, and the flame is never red", () => {
  assert.ok(STYLE.includes(".go.no-go{background:color-mix(in srgb,var(--red) 14%,transparent);color:color-mix(in srgb,var(--red) 55%,var(--fg));border:1px solid var(--red)}"));
  assert.equal(STYLE.includes(".flame.hot"), false);
  assert.ok(STYLE.includes(".link.flag{border-color:var(--amber)"));
  assert.ok(STYLE.includes("--vscode-charts-red,#e5484d"), "colors follow the theme with today's values as fallback");
});

test("no board count is wrapped in brackets", () => {
  const cat = en as Record<string, string>;
  for (const k of ["releaseBoard.future.tab", "releaseBoard.future.outsideHeading", "releaseBoard.future.handAll", "releaseBoard.future.handBatch", "releaseBoard.sinceLast.heading", "releaseBoard.panel.ptgItemRed", "releaseBoard.panel.ptgItemPinned", "releaseBoard.needsRule", "releaseBoard.noRule.pick", "releaseBoard.projects.label.rollup"]) {
    assert.equal(/\([^)]*\{\w+\}[^)]*\)/.test(cat[k] ?? ""), false, `${k}: ${cat[k]}`);
  }
  assert.equal(cat["releaseBoard.future.tab"], "Future {count}");
  const rows = Array.from({ length: 3 }, (_, i) => ({ project: "app", path: `bugs/${i}.md`, status: "red" as const, kind: "", note: "" }));
  const m = buildBoard(cfg, rows, undefined, true);
  const html = verdict(m.projects[0], t, new Map([["app", m.projects[0].light], ["name:app", "App"]]));
  assert.ok(html.includes('<span class="pill"'), "the row renders a count pill");
  assert.equal(/[(\[]\s*<span class="pill"|<\/span>\s*[)\]]/.test(html), false, "a rendered count is not wrapped in brackets");
});
