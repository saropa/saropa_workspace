// Projects view, step 1: readable Gantt titles, blockers first in Unified, bar minutes from all
// open steps, and the Future tab's "200+". Everything goes through the real entry points
// (buildBoard, renderBoard, ganttPanel, viewTabs, futurePanel).

import { test } from "node:test";
import assert from "node:assert/strict";
import { strings } from "../../views/boardStrings";
import { renderBoard } from "../../board/boardHtml";
import { GANTT_STYLE, ganttPanel } from "../../board/boardHtmlGantt";
import { FutureView, futurePanel, viewTabs } from "../../board/boardHtmlFuture";
import { buildFuture } from "../../board/futureList";
import { buildGantt } from "../../board/ganttModel";
import { buildBoard } from "../../board/boardModel";
import { readFacts } from "../../board/docFacts";
import { ScanSnapshot } from "../../board/scanner";
import { BoardConfig, BoardStatus, Classified, emptyCounts } from "../../board/types";

const t = strings();
const cfg: BoardConfig = { version: 1, ignore: [], ruleSets: {}, projects: [{ id: "app", name: "App", path: "app", roots: [], ruleSets: [] }, { id: "lib", name: "Lib", path: "lib", roots: [], ruleSets: [] }] };
const row = (project: string, path: string, status: BoardStatus): Classified => ({ project, path, status, kind: "", note: "" });

function snapshotOf(byProject: Record<string, Record<string, string>>): ScanSnapshot {
  const projects: ScanSnapshot["projects"] = {};
  for (const [id, files] of Object.entries(byProject)) {
    const facts = Object.fromEntries(Object.entries(files).map(([p, text]) => [p, { size: text.length, mtimeMs: 1, facts: readFacts(text, p) }]));
    projects[id] = { counts: emptyCounts(), folders: {}, ruleCounts: {}, greyFolders: {}, files: {}, facts };
  }
  return { version: 1, takenAt: 1, projects };
}

test("unified lists a later project's blocker above an earlier project's amber rows", () => {
  const rows = [row("app", "a.md", "amber"), row("app", "b.md", "amber"), row("lib", "y.md", "red")];
  const m = buildBoard(cfg, rows, undefined, true, snapshotOf({ app: { "a.md": "# Alpha\n", "b.md": "# Beta\n" }, lib: { "y.md": "# Why\n" } }));
  const [u] = buildGantt(m, undefined, "unified", "All projects");
  const titles = u.rows.map((r) => r.title);
  assert.equal(titles[0], "Why");
  assert.ok(titles.indexOf("Why") < titles.indexOf("Alpha"));
});

test("a bar's minutes come from all open steps of the document, whatever the Steps filter shows", () => {
  const files = { "a.md": "# Alpha\n\n- [ ] one (10 min)\n- [ ] two (20 min)\n- [ ] three (1 hour)\n- [x] done (99 min)\n", "b.md": "# Beta\n" };
  const m = buildBoard(cfg, [row("app", "a.md", "amber"), row("app", "b.md", "amber")], undefined, true, snapshotOf({ app: files }));
  assert.equal(m.sittings, undefined, "no Steps data at all");
  const [g] = buildGantt(m);
  assert.equal(g.rows.find((r) => r.title === "Alpha")!.minutes, 90);
  assert.equal(g.rows.find((r) => r.title === "Beta")!.minutes, 0, "no steps: no estimate, an empty bar");
  assert.ok(ganttPanel(m, t).includes('<span class="m">1h 30m</span>'));
});

test("the Gantt gives titles two lines and the title column room; the unused chain slot takes no width; the tooltip keeps the whole title", () => {
  const long = "A very long document title that no column could ever show on one line";
  const m = buildBoard(cfg, [row("app", "l.md", "amber")], undefined, true, snapshotOf({ app: { "l.md": `# ${long}\n` } }));
  const html = ganttPanel(m, t);
  assert.ok(GANTT_STYLE.includes("grid-template-columns:var(--gcol,minmax(200px,45%)) 1fr"));
  assert.ok(GANTT_STYLE.includes("-webkit-line-clamp:2"));
  assert.ok(html.includes(long) && !html.includes(long.slice(0, 20) + "…"), "full text in the page and its tooltips");
  assert.match(html, /title="[^"]*A very long document title that no column could ever show on one line/);
  const page = renderBoard(m, t, "n", 1, { scope: "all" });
  assert.match(page, /\.gslot\{position:absolute[^}]*visibility:hidden/, "out of the row's flow, so it takes no width and nothing shifts on hover");
  assert.match(page, /\.gr:hover \.gslot[^{]*\{visibility:visible\}/);
});

const doc = (i: number) => ({ project: "app", projectName: "App", path: `plans/deferred/d${i}.md`, text: `# D${i}\n\nImportance: nice-to-have\n\nBody\n` });
const view = (over: Partial<FutureView> = {}): FutureView => ({ items: buildFuture(Array.from({ length: 200 }, (_v, i) => doc(i))), outside: [], sort: "score", canEdit: true, researchParallel: 3, ...over });

test("when more documents exist than are listed, the Future tab says 200+ and a note says so", () => {
  const cut = view({ cut: true });
  assert.equal(cut.items.length, 200);
  assert.ok(viewTabs(cut, t).includes("200+"));
  assert.ok(futurePanel(cut, t).includes("More exist and are not listed."));
  const whole = view();
  assert.ok(viewTabs(whole, t).includes("200") && !viewTabs(whole, t).includes("200+"));
  assert.ok(!futurePanel(whole, t).includes("are not listed"));
});
