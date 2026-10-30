// The header of the board page: scope switch, tabs and two kebabs on one line, the line of
// applied filters, and the calm rules (no brackets around counts, tinted NO-GO light).

import { test } from "node:test";
import assert from "node:assert/strict";
import { renderBoard } from "../../board/boardHtml";
import { explainPill, filterLine, scopeSwitch, sinceLink, topBar } from "../../board/boardHtmlHeader";
import { STYLE } from "../../board/boardHtmlAssets";
import { buildBoard } from "../../board/boardModel";
import { BoardConfig } from "../../board/types";
import { verdict } from "../../board/boardHtmlRows";
import { strings } from "../../views/boardStrings";
import en from "../../i18n/locales/en.json";

const cfg: BoardConfig = { version: 1, ignore: [], ruleSets: {}, projects: [{ id: "app", name: "App", path: "app", roots: ["docs"], ruleSets: [] }] };
const t = strings();

test("the scope switch has two buttons, marks the current one, and the all button carries the project count", () => {
  const m = buildBoard(cfg, [], undefined, true);
  const html = scopeSwitch(m, "all", t);
  assert.ok(html.includes('data-scope="openOnly" aria-pressed="false"') && html.includes('data-scope="all" aria-pressed="true"'));
  assert.ok(html.includes("This project") && html.includes("All projects"));
  assert.ok(html.includes('<span class="pill"'), "the count is a pill");
  assert.equal(scopeSwitch(m, undefined, t), "", "left out when the scope is unknown");
});

test("the top line holds the scope switch, the tabs and the two kebabs, and no loose buttons", () => {
  const m = buildBoard(cfg, [], undefined, true);
  const html = topBar(m, t, "openOnly", "<TABS>");
  assert.ok(html.indexOf("data-scope") < html.indexOf("<TABS>") && html.indexOf("<TABS>") < html.indexOf('data-menu="view"'));
  assert.ok(html.indexOf('data-menu="view"') < html.indexOf('data-menu="opts"'));
  assert.equal(html.match(/<button/g)?.length, 4, "two scope buttons and two kebabs");
});

test("the filter line is hidden with no filter, and shows a removable pill per applied filter with Clear all from two", () => {
  const base = buildBoard(cfg, [], undefined, true, undefined, undefined, undefined, { sittings: { selection: { timeBox: "any", maxSteps: 10 }, onlyOwner: false } });
  assert.equal(filterLine(base, t), "");
  const timed = buildBoard(cfg, [], undefined, true, undefined, undefined, undefined, { sittings: { selection: { timeBox: "30", maxSteps: 10 }, onlyOwner: false } });
  const one = filterLine(timed, t);
  assert.ok(one.includes("Time: 30 min") && one.includes('data-fclear="time"'));
  assert.equal(one.includes('data-fclear="all"'), false);
  const m = renderBoard(timed, t, "n");
  assert.ok(m.includes('class="fline"'));
  assert.equal(renderBoard(base, t, "n").includes('class="fline"'), false);
});

test("the page script clears a filter pill by sending the Sittings selection", () => {
  const html = renderBoard(buildBoard(cfg, [], undefined, true), t, "n");
  assert.ok(html.includes("data-fclear"), "the handler is in the script");
  assert.ok(html.includes("sitSend({...(k!=='have'?{box:'any'}:{}),...(k!=='time'?{have:SIT.all}:{})})"));
});

test("the scope and mode pill carries the detail in its tooltip, and is left out with no scope", () => {
  const m = buildBoard(cfg, [], undefined, true);
  const html = explainPill(m, "all", t);
  assert.match(html, /\u2699 All \d+ \u00b7 Deliberate</);
  assert.ok(html.includes("Red folders and failing lint, tests or build block in every mode"));
  assert.ok(html.includes("extreme, critical and high items block"));
  assert.equal(explainPill(m, undefined, t), "");
  assert.ok(topBar(m, t, "all", "<TABS>").includes("Deliberate"));
});

test("the header link to the change log shows only while something changed", () => {
  assert.equal(sinceLink(undefined, t), "");
  assert.equal(sinceLink({ heading: "h", marked: [], lines: [] }, t), "");
  const html = sinceLink({ heading: "h", marked: [], lines: [{ text: "x", details: [] }] }, t);
  assert.ok(html.includes("data-since-go") && html.includes('<span class="pill"'));
});

test("a NO-GO light is a tinted pill, not a solid red block, and the flame is never red", () => {
  assert.ok(STYLE.includes(".go.no-go{background:color-mix(in srgb,var(--red) 14%,transparent);color:var(--red);border:1px solid var(--red)}"));
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
