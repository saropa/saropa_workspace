// The polish pass of the board page: the window title, one button style, document links,
// the In progress list, the Sittings default and the no-rule section, checked on the page.

import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { BoardStrings, renderBoard, renderSkeleton } from "../../board/boardHtml";
import { STYLE, script } from "../../board/boardHtmlAssets";
import { kebab, optsMenu, rowMenu, undoBar, viewMenu } from "../../board/boardHtmlMenus";
import { PROJECTS_STYLE } from "../../board/boardHtmlProjects";
import { buildBoard } from "../../board/boardModel";
import { evaluateHealth } from "../../board/health";
import { pathToGo } from "../../board/pathToGo";
import { readFacts } from "../../board/docFacts";
import { ScanSnapshot } from "../../board/scanner";
import { BoardConfig, BoardStatus, Classified, emptyCounts } from "../../board/types";
import { POLISH_KEYS, PROJECT_LABEL_KEYS, strings } from "../../views/boardStrings";
import { buildFuture } from "../../board/futureList";
import { futurePanel } from "../../board/boardHtmlFuture";
import { sinceBox, unnamedBox } from "../../board/boardHtmlBoxes";
import { asTimeBox } from "../../board/sittings";
import en from "../../i18n/locales/en.json";

const t: BoardStrings = new Proxy({} as BoardStrings, { get: (_o, k: string) => (k === "more" ? "+ {count} more" : k === "blocked" ? "{count} blocked" : `[${k}]`) });

const cfg: BoardConfig = {
  version: 1,
  ignore: [],
  ruleSets: {},
  projects: [{ id: "app", name: "App", path: "app", roots: ["docs"], ruleSets: [] }],
};

const row = (path: string, status: BoardStatus, note = ""): Classified => ({ project: "app", path, status, kind: "", note });

function snapshot(files: Record<string, string>, grey: Record<string, number> = {}): ScanSnapshot {
  const facts = Object.fromEntries(Object.entries(files).map(([p, text]) => [p, { size: text.length, mtimeMs: 1, facts: readFacts(text, p) }]));
  const cached = Object.fromEntries(Object.keys(files).map((p) => [p, { size: 1, mtimeMs: 1, word: "" }]));
  return { version: 1, takenAt: 1, projects: { app: { counts: emptyCounts(), folders: {}, ruleCounts: {}, greyFolders: grey, files: cached, facts } } };
}

const many = (n: number, status: BoardStatus): Classified[] => Array.from({ length: n }, (_x, i) => row(`docs/${status}${i}.md`, status));

test("the window and the panel are titled Saropa Release Board", () => {
  assert.equal(en["releaseBoard.panel.title"], "Saropa Release Board");
  const s = strings();
  assert.equal(s.title, "Saropa Release Board");
  const m = buildBoard(cfg, [], undefined, true);
  assert.ok(renderBoard(m, s, "n").includes("<title>Saropa Release Board</title>"));
  assert.ok(renderSkeleton(s, "n").includes("<title>Saropa Release Board</title>"));
});

test("the page keeps its heading for screen readers but draws no visible heading", () => {
  const m = buildBoard(cfg, [], undefined, true);
  for (const html of [renderBoard(m, t, "n"), renderSkeleton(t, "n")]) {
    assert.equal(html.match(/<h1/g)?.length, 1);
    assert.ok(html.includes('<h1 class="vh" title="[title]">[title]</h1>'));
  }
  assert.ok(STYLE.includes(".vh{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)"), "the heading is clipped off screen, not removed");
  assert.equal(STYLE.includes("h1{"), true);
});

test("buttons use the editor's button colors, one font size and a secondary look", () => {
  assert.ok(STYLE.includes("button{font:inherit;"));
  assert.ok(STYLE.includes("background:var(--vscode-button-background,#0e639c);color:var(--vscode-button-foreground,#fff)"));
  assert.ok(STYLE.includes("button:hover:not(:disabled){background:var(--vscode-button-hoverBackground,#1177bb)}"));
  assert.ok(STYLE.includes("button.sec{background:var(--vscode-button-secondaryBackground,#3a3d41);color:var(--vscode-button-secondaryForeground,#fff)}"));
  assert.ok(STYLE.includes("button.sec:hover:not(:disabled){background:var(--vscode-button-secondaryHoverBackground,#45494e)}"));
  assert.ok(STYLE.includes(".vscode-high-contrast button"), "high contrast themes get a visible border");
  assert.ok(STYLE.includes("outline:1px solid var(--vscode-focusBorder"), "focus is visible");
  assert.equal(/\bbutton[^{]*\{[^}]*font-size/.test(STYLE.replace(/\.fn[^}]*\}/g, "")), false, "no button sets its own font size");
});

test("an item step is a link to its document, a lint step stays plain text with its button", () => {
  const files = { "docs/BUG_a.md": "# Crash\n\nSeverity: critical\n" };
  const m = buildBoard(cfg, [row("docs/BUG_a.md", "red")], undefined, true, snapshot(files), undefined, { app: evaluateHealth(undefined, undefined, undefined, 1) });
  const p = pathToGo(m, m.projects[0], { maxSteps: 8, canRun: () => true });
  const tp = new Proxy({} as BoardStrings, { get: (_o, k: string) => (k.startsWith("ptgItem") ? `{title} [${k}]` : `[${k}]`) });
  const html = renderBoard(m, tp, "n", 1, {}, [p]);
  const ol = html.slice(html.indexOf('<ol class="ptg"'), html.indexOf("</ol>"));
  const items = ol.split("<li ").slice(1);
  const item = items.find((x) => x.includes("data-k=\"item:"));
  const lint = items.find((x) => x.includes('data-k="lint"'));
  assert.ok(item && lint);
  assert.ok(item.includes('<a class="doc" href="#" data-id="0" title="docs/BUG_a.md">Crash</a>'), "the document is a link with its path as tooltip");
  assert.equal(item.includes("<button class=\"ptgb\""), false, "the link replaces the Open button");
  assert.equal(lint.includes("<a "), false, "a step that is not a document has no link");
  assert.ok(lint.includes('<button class="ptgb"'), "and keeps its action button");
  assert.ok(lint.includes('<span class="st">[ptgLintMissing]</span>'));
});

test("the rules step is plain text: the rules file opens only from the menus", () => {
  const m = buildBoard(cfg, [row("docs/loose/a.md", "grey")], undefined, true, snapshot({}, { "docs/loose": 3 }));
  const p = pathToGo(m, m.projects[0], { maxSteps: 8, canRun: () => false });
  const html = renderBoard(m, t, "n", 1, {}, [p]);
  assert.ok(html.includes("ptgRules"), "the step is still listed");
  assert.equal(html.includes("ptgl"), false);
  assert.equal(html.includes("data-rules"), false);
  const opens = html.match(/data-act="rules"/g) ?? [];
  assert.equal(opens.length, 2, "one entry in the row menu and one in the options menu");
});

test("In progress lists the documents being edited first, cut at the limit with an N more line", () => {
  const rows = [...many(20, "red"), row("docs/marked.md", "purple")];
  const edited = Array.from({ length: 20 }, (_x, i) => `app/docs/red${i}.md`);
  const m = buildBoard(cfg, rows, undefined, true, undefined, undefined, undefined, { inProgress: { edited, max: 15 } });
  assert.deepEqual(m.inProgress, { ids: Array.from({ length: 15 }, (_x, i) => i), more: 6, editing: 15 });
  const html = renderBoard(m, t, "n");
  const box = html.slice(html.indexOf("<h2", html.indexOf("[inProgress]") - 120), html.indexOf("</section>", html.indexOf("[inProgress]")));
  assert.equal(box.match(/class="row"/g)?.length, 15);
  assert.ok(box.includes('<p class="note" title="+ 6 more">+ <span class="pill" title="pillTip">6</span> more</p>'));
  assert.ok(box.includes('<span class="pill" title="count">21</span>'), "the heading counts all of them");
  assert.ok(box.includes('<p class="note">inProgressNote</p>'));
});

test("In progress off lists every document marked in progress, as before", () => {
  const m = buildBoard(cfg, [row("docs/a.md", "purple"), row("docs/b.md", "red")], undefined, true, undefined, undefined, undefined, { inProgress: undefined });
  assert.equal(m.inProgress, undefined);
  const html = renderBoard(m, t, "n");
  const box = html.slice(html.indexOf("[inProgress]"), html.indexOf("</section>", html.indexOf("[inProgress]")));
  assert.equal(box.match(/class="row"/g)?.length, 1);
  assert.ok(box.includes(">a</a>") || box.includes('title="docs/a.md"'));
});

test("the time boxes include half a day, and an unknown value means any time", () => {
  assert.equal(asTimeBox("240"), "240");
  assert.equal(asTimeBox("60"), "60");
  assert.equal(asTimeBox("90"), "any");
  assert.equal(asTimeBox(240), "any");
});

test("the time filter has Any, 15 min, 30 min, 1 hour and Half a day with their words", () => {
  const files = { "docs/p.md": "# P\n\n- [ ] Upload the build with Xcode\n" };
  const s = strings();
  const m = buildBoard(cfg, [row("docs/p.md", "amber")], undefined, true, snapshot(files), undefined, undefined, { sittings: { selection: { timeBox: "240", maxSteps: 10 }, onlyOwner: false } });
  const html = renderBoard(m, s, "n");
  const menu = viewMenu(s, "deliberate", m.sittings);
  const labels = [...menu.matchAll(/data-act="box:(\w+)" aria-checked="(\w+)" title="[^"]*">(?:\u2713 )?([^<]*)</g)].map((x) => [x[1], x[2], x[3]]);
  assert.deepEqual(labels, [["any", "false", "Any"], ["15", "false", "15 min"], ["30", "false", "30 min"], ["60", "false", "1 hour"], ["240", "true", "Half a day"]]);
  assert.ok(menu.includes("Time I have:") && menu.includes("I have:"));
  assert.equal(html.includes("I have…"), false, "the mystery label is gone");
});

test("the tooltip table has text for every key the page can use, and no key is left over", () => {
  const catalog = en as Record<string, string>;
  for (const k of POLISH_KEYS) {
    assert.ok((catalog["releaseBoard.polish." + k] ?? "").length >= 3, `en.json has text for ${k}`);
  }
  const inCatalog = Object.keys(catalog).filter((k) => k.startsWith("releaseBoard.polish.")).map((k) => k.slice("releaseBoard.polish.".length));
  assert.deepEqual([...inCatalog].sort(), [...POLISH_KEYS].sort());
  const s = strings().polish;
  assert.equal(Object.keys(s).length, POLISH_KEYS.length);
});

test("every literal key the page code uses is in the tooltip table", () => {
  const dir = path.join(__dirname, "..", "..", "..", "src", "board");
  const known = new Set<string>(POLISH_KEYS);
  const used = new Set<string>();
  for (const f of fs.readdirSync(dir).filter((x) => /^boardHtml.*\.ts$/.test(x))) {
    const src = fs.readFileSync(path.join(dir, f), "utf8");
    for (const m of src.matchAll(/\b(?:tip|pl)\(t, "([\w.]+)"/g)) {
      used.add(m[1]);
    }
    for (const m of src.matchAll(/tip: "(list\.\w+)"/g)) {
      used.add(m[1]);
    }
  }
  assert.ok(used.size > 60, `found ${used.size} keys`);
  assert.deepEqual([...used].filter((k) => !k.endsWith(".") && !known.has(k)), []);
  // Keys built from a value at run time.
  for (const k of ["profile.rush", "profile.deliberate", "profile.zero", "st.red", "st.amber", "st.purple", "stTip.red", "stTip.amber", "stTip.purple", "cp.red", "cpTip.red", "sev.high", "why.red", "why.pinned", "light.go", "light.noGo", "light.unverified", "time15", "time30", "timeHour", "timeHalfDay", "timeAny", "ptgAccept", "ptgRunLint", "ptgRunTests", "ptgEnable", "severity", "severityStops", "outsideLink", "outsideItem", "timeAnyTip", "timeTip", "list"]) {
    assert.ok(known.has(k), k);
  }
});

// Narrow panels: the page stays usable down to about 280 pixels wide.
test("the style sheet has the narrow rules: wrapping top bar, stacked project rows, reflowing list rows, 32 pixel targets", () => {
  const narrow = /@media \(max-width:480px\)\{([\s\S]*?)\n@media/.exec(STYLE);
  assert.ok(narrow, "a max-width 480 block exists");
  const css = narrow[1];
  assert.ok(css.includes(".top{display:flex;flex-wrap:wrap"));
  assert.ok(css.includes(".vd .pn{flex:1 1 100%"), "the project name takes its own line");
  assert.ok(css.includes(".row{flex-wrap:wrap"), "list rows wrap so the buttons go under the text");
  assert.ok(css.includes(".row .f{flex:1 1 100%;white-space:normal"));
  assert.ok(/button,[^{]*select[^{]*\{min-height:32px\}/.test(css), "buttons and selects are at least 32px high");
  assert.ok(css.includes("summary{min-height:32px"));
  assert.ok(STYLE.includes("@media (max-width:320px)"), "an extra block for the narrowest panels");
  assert.ok(STYLE.includes(".pn{overflow:hidden;text-overflow:ellipsis"), "clipped project names get an ellipsis");
});

test("no layout container is given a fixed width above 280 pixels", () => {
  for (const [name, css] of [["STYLE", STYLE], ["PROJECTS_STYLE", PROJECTS_STYLE]] as const) {
    for (const m of css.matchAll(/(?:^|[;{}])\s*((?:min-|max-)?width):\s*(\d+(?:\.\d+)?)px/g)) {
      assert.ok(Number(m[2]) <= 280, `${name}: ${m[1]}:${m[2]}px is wider than 280`);
    }
  }
});

// The settings table of the README and the settings of package.json say the same.
test("every releaseBoard setting is in the README table with its default, and the table lists no other", () => {
  const root = path.join(__dirname, "..", "..", "..");
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as { contributes: { configuration: { properties: Record<string, { default?: unknown }> } | Array<{ properties: Record<string, { default?: unknown }> }> } };
  const conf = pkg.contributes.configuration;
  const props = Object.assign({}, ...(Array.isArray(conf) ? conf.map((c) => c.properties) : [conf.properties])) as Record<string, { default?: unknown }>;
  const shown = (v: unknown): string => (Array.isArray(v) ? JSON.stringify(v) : String(v));
  const expected = new Map<string, string>();
  for (const [k, v] of Object.entries(props)) {
    if (k.startsWith("saropaWorkspace.releaseBoard.")) {
      expected.set(k.slice("saropaWorkspace.".length), shown(v.default));
    }
  }
  const readme = fs.readFileSync(path.join(root, "..", "README.md"), "utf8");
  const found = new Map<string, string>();
  for (const m of readme.matchAll(/^\| `(releaseBoard\.[\w.]+)` \| (?:`([^`]*)`|(empty)) \|/gm)) {
    assert.ok(!found.has(m[1]), `${m[1]} is listed twice`);
    found.set(m[1], m[3] ? "" : m[2]);
  }
  assert.ok(expected.size >= 40);
  assert.deepEqual([...found.keys()].sort(), [...expected.keys()].sort());
  for (const [k, d] of expected) {
    assert.equal(found.get(k), d, `README default of ${k}`);
  }
});

test("the row menu has Open, the status radios, Raise, Lower, the five levels, Back to automatic, Move to group, Assign rule, Hand off and the rules file, each with a tooltip", () => {
  const html = rowMenu(t, "deliberate", [], [{ label: "Done", status: "green" }, { label: "Review next", status: "amber" }]);
  const acts = [...html.matchAll(/<button type="button" class="mi" role="(menuitem|menuitemradio)" data-act="([\w:]+)"[^>]* title="([^"]+)">([^<]+)<\/button>/g)];
  assert.deepEqual(acts.map((m) => m[2]), ["open", "status:0", "status:1", "raise", "lower", "sev:extreme", "sev:critical", "sev:high", "sev:medium", "sev:low", "auto", "group", "assign", "hand", "rules"]);
  assert.deepEqual(acts.filter((m) => m[1] === "menuitemradio").map((m) => m[2]), ["status:0", "status:1", "sev:extreme", "sev:critical", "sev:high", "sev:medium", "sev:low"]);
  assert.ok(acts.every((m) => m[3].length > 0));
  assert.ok(html.startsWith('<div class="menu" id="menu-row" role="menu" hidden data-stops='));
  assert.ok(html.includes('data-stops="[&#34;extreme&#34;,&#34;critical&#34;,&#34;high&#34;]"'), "the levels that stop under the profile");
});

test("every radio of the row menu sits in a labelled group and carries aria-checked", () => {
  const html = rowMenu(t, "zero", [], [{ label: "Done", status: "green" }]);
  assert.equal([...html.matchAll(/role="menuitemradio"[^>]*aria-checked="false"/g)].length, 6);
  assert.equal([...html.matchAll(/<div role="group" aria-labelledby="(mh-\w+)"/g)].length, 2);
  assert.ok(html.includes('id="mh-menuStatus"') && html.includes('id="mh-menuSeverity"'));
  assert.ok(html.includes('id="eff" aria-live="polite"'));
  assert.ok(html.includes('data-stops="[&#34;extreme&#34;,&#34;critical&#34;,&#34;high&#34;,&#34;medium&#34;]"'));
});

test("the row menu counts the blockers of each project for its effect line and escapes every value", () => {
  const m = buildBoard(cfg, [row("bugs/a.md", "red"), row("docs/b.md", "amber")], undefined, true);
  const html = rowMenu(t, "deliberate", m.projects, [{ label: '<b>"x"</b>', status: "red" }]);
  assert.ok(html.includes("&#34;app&#34;:[&#34;"), html.slice(0, 400));
  assert.equal(html.includes("<b>"), false);
});

test("the Undo bar escapes its text and is left out with none", () => {
  assert.equal(undoBar(t, undefined), "");
  const html = undoBar(t, '<img src=x onerror="1">');
  assert.ok(html.includes('role="status"') && html.includes("data-undo") && !html.includes("<img"));
});

test("the options menu hands off the board, opens the rules file, the project chooser and the settings", () => {
  const html = optsMenu(t);
  assert.deepEqual([...html.matchAll(/data-act="(\w+)"/g)].map((m) => m[1]), ["handBoard", "refresh", "rules", "projects", "settings"]);
  assert.ok(html.includes('id="menu-opts" role="menu" hidden'));
});

test("the kebab buttons are real buttons with a popup and expanded state, and a tooltip", () => {
  assert.equal(kebab(t, "opts"), '<button type="button" class="kb sec" data-menu="opts" aria-haspopup="menu" aria-expanded="false" aria-controls="menu-opts" title="optsMenu" aria-label="optsMenu">\u22EE</button>');
  assert.ok(kebab(t, "row", 4, "A <b>").includes('data-id="4"'));
});

test("the page draws the two kebabs in the top bar and each menu once, and the rules file is offered only in menus", () => {
  const m = buildBoard(cfg, [row("docs/a.md", "amber")], undefined, true);
  const html = renderBoard(m, t, "n", 1);
  assert.equal(html.match(/id="menu-row"/g)?.length, 1);
  assert.equal(html.match(/id="menu-opts"/g)?.length, 1);
  assert.equal(html.match(/id="menu-view"/g)?.length, 1);
  const top = html.split("\n").find((l) => l.startsWith('<div class="top"')) ?? "";
  assert.ok(/data-menu="view".*data-menu="opts"/.test(top), "view options, then project actions");
  assert.equal(top.includes("<button id="), false, "no loose buttons: scope, tabs and kebabs only");
  assert.equal(html.match(/\[ptgOpenRules\]/g)?.length, 2, "once in each menu and nowhere else");
  assert.equal(html.includes("data-rules"), false);
});

test("the script opens a menu with the button, keeps aria-expanded, and closes on Escape, Tab, outside click and resize", () => {
  const js = script(1, "x", "y");
  for (const part of ["aria-expanded", "'ArrowDown'", "'ArrowUp'", "'Escape'", "'Tab'", "'Home'", "'End'", "role=menuitem", "window.addEventListener('resize'", "type:'rowMenu',act,id:Number(id),rev:REV", "type:'optsMenu',act,rev:REV", "type:'profile',value:act.slice(8),rev:REV", "type:'refresh',rev:REV"]) {
    assert.ok(js.includes(part), `the script has ${part}`);
  }
});

test("the narrow rules move what no longer fits into the kebab: project name and all but the top icon", () => {
  assert.ok(STYLE.includes(".row .tag,.facts .mk:not(.top),.marks .mk:not(.top){display:none}"));
  assert.ok(STYLE.includes(".kb,.mi{min-height:32px;min-width:32px}"));
  assert.ok(STYLE.includes(".menu[hidden]{display:none}"));
});

const P = (n: string | number): string => `<span class="pill" title="pillTip">${n}</span>`;

test("project names, paths and file names are never cut into number pills; only the figures are", () => {
  const since = sinceBox({ heading: "H", marked: [], lines: [{ text: "Proj 7: 2 new blockers", name: "Proj 7", details: [] }] }, t);
  assert.ok(since.includes(`<li>Proj 7: ${P(2)} new blockers</li>`), since);
  const real = strings();
  const fut = futurePanel(
    { items: buildFuture([{ project: "app", projectName: "App", path: "plans/deferred/a.md", text: "# Idea\n\nBody\n" }]), outside: [{ project: "app", projectName: "App", path: "plans/2026/a1.md", title: "Later", line: 4, why: "later" }], sort: "score", canEdit: false, researchParallel: 3 },
    real
  );
  assert.ok(/plans\/2026\/a1\.md, line <span class="pill" title="[^"]+">4<\/span> \(Later\)<\/span>/.test(fut), "the path is plain text and the line number is a pill");
  const m = buildBoard(cfg, [], undefined, true, undefined, undefined, undefined, { live: { signals: { app: { "lib/v2/x3.dart": { logs: { errors: 0, warnings: 0, crashes: 2 } } } }, includeWarnings: true, fold: false, unnamedBox: true } });
  const box = unnamedBox(m, real, true);
  assert.ok(box.includes("lib/v2/x3.dart: "), "the file name is not cut");
  assert.ok(/<span class="pill" title="[^"]+">2<\/span>/.test(box), "the count is a pill");
});

test("every key the umbrella controls read is in the label table and in the catalog", () => {
  const dir = path.join(__dirname, "..", "..", "..", "src", "board");
  const src = ["boardHtmlProjects.ts", "boardHtmlHeader.ts", "boardHtmlMenus.ts"].map((f) => fs.readFileSync(path.join(dir, f), "utf8")).join("\n");
  const used = new Set([...src.matchAll(/label\(t, "(\w+)"\)/g)].map((m) => m[1]));
  assert.ok(used.size >= 10);
  for (const k of used) {
    assert.ok((PROJECT_LABEL_KEYS as readonly string[]).includes(k), `label key "${k}" is not in PROJECT_LABEL_KEYS`);
  }
  const real = strings().projectLabels ?? {};
  for (const k of PROJECT_LABEL_KEYS) {
    assert.ok(typeof real[k] === "string" && real[k] !== "", `label "${k}" has no text`);
    assert.ok(typeof (en as Record<string, string>)["releaseBoard.projects.label." + k] === "string", `label "${k}" is not in en.json`);
  }
});

test("a device id with a quote is escaped in the menu, and the all entry says whether every device is chosen", () => {
  const sit = { timeBox: "any", have: ["a"], contexts: [{ id: 'a"b', label: "A" }, { id: "a", label: "B" }], onlyOwner: false } as unknown as Parameters<typeof viewMenu>[2];
  const menu = viewMenu(strings(), "deliberate", sit);
  assert.ok(menu.includes('data-act="have:a&#34;b"'));
  assert.ok(!menu.includes('data-act="have:a"b'));
  assert.ok(menu.includes('data-act="haveall" aria-checked="false"'));
});

test("With Group by Project a project still lists its in-progress documents when another project fills the global cap", () => {
  const two: BoardConfig = { ...cfg, projects: [...cfg.projects, { id: "lib", name: "Lib", path: "lib", roots: ["docs"], ruleSets: [] }] };
  const rows: Classified[] = [...Array.from({ length: 5 }, (_x, i) => row(`docs/p${i}.md`, "purple")), { ...row("docs/mine.md", "purple"), project: "lib" }];
  const m = buildBoard(two, rows, undefined, true, undefined, undefined, undefined, { inProgress: { edited: [], max: 5 } });
  assert.ok(!m.inProgress?.ids.some((id) => m.items[id].project === "lib"), "the global cap holds only the other project");
  const html = renderBoard(m, t, "n", 0, { groupBy: "project" });
  assert.ok(html.includes("docs/mine.md") || html.includes(">mine</a>"));
});
