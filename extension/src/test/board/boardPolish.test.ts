// The polish pass of the board page: the window title, one button style, document links,
// the In progress list, the Sittings default and the no-rule section, checked on the page.

import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { BoardStrings, renderBoard, renderSkeleton } from "../../board/boardHtml";
import { STYLE } from "../../board/boardHtmlAssets";
import { buildBoard } from "../../board/boardModel";
import { evaluateHealth } from "../../board/health";
import { pathToGo } from "../../board/pathToGo";
import { readFacts } from "../../board/docFacts";
import { ScanSnapshot } from "../../board/scanner";
import { BoardConfig, BoardStatus, Classified, emptyCounts } from "../../board/types";
import { POLISH_KEYS, strings } from "../../views/boardStrings";
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
  assert.equal(/\.hb\{[^}]*(font-size|padding)/.test(STYLE), false, "Hand to chat is the same size as other buttons");
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

test("the rules step links to the rules file with its path as the tooltip", () => {
  const m = buildBoard(cfg, [row("docs/loose/a.md", "grey")], undefined, true, snapshot({}, { "docs/loose": 3 }));
  const p = pathToGo(m, m.projects[0], { maxSteps: 8, canRun: () => false });
  const html = renderBoard(m, t, "n", 1, {}, [p]);
  assert.ok(html.includes('<a class="doc ptgl" href="#" data-p="0" data-s="'));
  assert.ok(html.includes('title=".saropa/release-board.json">[ptgOpenRules]</a>'));
});

test("In progress lists the documents being edited first, cut at the limit with an N more line", () => {
  const rows = [...many(20, "red"), row("docs/marked.md", "purple")];
  const edited = Array.from({ length: 20 }, (_x, i) => `app/docs/red${i}.md`);
  const m = buildBoard(cfg, rows, undefined, true, undefined, undefined, undefined, { inProgress: { edited, max: 15 } });
  assert.deepEqual(m.inProgress, { ids: Array.from({ length: 15 }, (_x, i) => i), more: 6, editing: 15 });
  const html = renderBoard(m, t, "n");
  const box = html.slice(html.indexOf("<h2", html.indexOf("[inProgress]") - 40), html.indexOf("</section>", html.indexOf("[inProgress]")));
  assert.equal(box.match(/class="row"/g)?.length, 15);
  assert.ok(box.includes('<p class="note" title="+ 6 more">+ 6 more</p>'));
  assert.ok(box.includes('<span class="n" title="count">21</span>'), "the heading counts all of them");
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
  const labels = [...html.matchAll(/<button class="chip sec" data-box="(\w+)" aria-pressed="(\w+)" title="[^"]*">([^<]*)<\/button>/g)].map((x) => [x[1], x[2], x[3]]);
  assert.deepEqual(labels, [["any", "false", "Any"], ["15", "false", "15 min"], ["30", "false", "30 min"], ["60", "false", "1 hour"], ["240", "true", "Half a day"]]);
  assert.ok(html.includes("Time I have:") && html.includes("I have:"));
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
  for (const k of ["profile.rush", "profile.deliberate", "profile.zero", "square.red", "square.amber", "square.purple", "light.go", "light.noGo", "light.unverified", "time15", "time30", "timeHour", "timeHalfDay", "timeAny", "ptgAccept", "ptgRunLint", "ptgRunTests", "ptgEnable", "severity", "severityStops", "outsideLink", "outsideItem", "timeAnyTip", "timeTip", "list"]) {
    assert.ok(known.has(k), k);
  }
});
