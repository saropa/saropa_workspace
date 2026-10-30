// Project rows and item lists of the page: the light words, reasons, grouping, the cap,
// the marks, the Path to GO list and, throughout, that untrusted text is escaped and the
// page carries indexes only.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildBoard } from "../../board/boardModel";
import { BoardStrings } from "../../board/boardHtmlUtil";
import { list, pathList, projectBlock, verdict } from "../../board/boardHtmlRows";
import { PathToGo, pathToGo } from "../../board/pathToGo";
import { readFacts } from "../../board/docFacts";
import { ScanSnapshot } from "../../board/scanner";
import { BoardConfig, BoardStatus, Classified, emptyCounts } from "../../board/types";

const P = (n: number): string => `<span class="pill" title="pillTip">${n}</span>`;
const t: BoardStrings = new Proxy({} as BoardStrings, {
  get: (_o, k: string) => (k === "more" || k === "reasonGrey" || k === "ptgMore" || k === "ptgRules" || k === "ptgBlocked" ? `${k} {count}` : `[${k}]`),
});

const cfg: BoardConfig = {
  version: 1,
  ignore: [],
  ruleSets: {},
  projects: [
    { id: "app", name: "App", path: "app", roots: [], ruleSets: [], dependsOn: ["db"] },
    { id: "db", name: "Db <b>", path: "db", roots: [], ruleSets: [] },
  ],
};

const row = (project: string, path: string, status: BoardStatus, extra: Partial<Classified> = {}): Classified => ({ project, path, status, kind: "", note: "", ...extra });

function snapshotOf(files: Record<string, string>): ScanSnapshot {
  const facts = Object.fromEntries(Object.entries(files).map(([p, text]) => [p, { size: text.length, mtimeMs: 1, facts: readFacts(text, p) }]));
  return { version: 1, takenAt: 1, projects: { app: { counts: emptyCounts(), folders: {}, ruleCounts: {}, greyFolders: {}, files: {}, facts }, db: { counts: emptyCounts(), folders: {}, ruleCounts: {}, greyFolders: {}, files: {}, facts: {} } } };
}

const lights = (m: ReturnType<typeof buildBoard>): Map<string, string> => {
  const out = new Map<string, string>();
  for (const p of m.projects) {
    out.set(p.id, p.light);
    out.set("name:" + p.id, p.name);
  }
  return out;
};

test("a NO-GO project shows the NO-GO word and no reasons", () => {
  const m = buildBoard(cfg, [row("app", "bugs/a.md", "red")], undefined, true);
  const html = verdict(m.projects[0], t, lights(m));
  assert.ok(html.includes('class="go no-go"'));
  assert.ok(html.includes("[noGo]"));
  assert.ok(!html.includes('class="info"'), "reasons only explain UNVERIFIED");
});

test("an UNVERIFIED project lists its reasons in the tooltip", () => {
  const m = buildBoard(cfg, [row("db", "x.md", "grey")], undefined, false);
  const html = verdict(m.projects.find((p) => p.id === "db")!, t, lights(m));
  assert.ok(html.includes('class="go unverified"'));
  assert.ok(html.includes("[reasonBaseline] · reasonGrey 1 · [reasonHealth]"));
});

test("a project name is escaped, and only 14 squares are drawn", () => {
  const rows = Array.from({ length: 20 }, (_, i) => row("db", `bugs/${i}.md`, "red"));
  const m = buildBoard(cfg, rows, undefined, true);
  const html = verdict(m.projects.find((p) => p.id === "db")!, t, lights(m));
  assert.ok(html.includes("Db &#60;b&#62;"));
  assert.ok(!html.includes("<b>Db"));
  assert.equal(html.match(/class="sq red"/g)?.length, 14);
});

test("the dependency mark waits while a project it depends on is NO-GO", () => {
  const m = buildBoard(cfg, [row("db", "bugs/a.md", "red")], undefined, true);
  const app = m.projects.find((p) => p.id === "app")!;
  assert.ok(verdict(app, t, lights(m)).includes('class="link wait"'));
  const calm = buildBoard(cfg, [], undefined, true);
  assert.ok(verdict(calm.projects.find((p) => p.id === "app")!, t, lights(calm)).includes('class="link ok"'));
});

test("health marks show lint and tests with their detail, escaped", () => {
  const m = buildBoard(cfg, [], undefined, true, undefined, undefined, {
    app: { lint: "failing", tests: "passing", lintDetail: "3 <errors>", testsDetail: "ok", clean: false },
  });
  const html = verdict(m.projects.find((p) => p.id === "app")!, t, lights(m));
  assert.ok(html.includes('class="hl failing"'));
  assert.ok(html.includes('class="hl passing"'));
  assert.ok(html.includes("[healthLint]: 3 &#60;errors&#62;"));
});

test("a project with a path to GO becomes a toggle row", () => {
  const m = buildBoard(cfg, [row("app", "bugs/a.md", "red")], undefined, true);
  const path = pathToGo(m, m.projects[0], { maxSteps: 8, canRun: () => false });
  const html = projectBlock(m.projects[0], 0, t, lights(m), path, true);
  assert.ok(html.includes('class="pj" data-pid="app"'));
  assert.ok(html.includes('aria-expanded="false"'));
  assert.ok(html.includes('<ol class="ptg" hidden'));
  assert.equal(projectBlock(m.projects[0], 0, t, lights(m), undefined, true).includes("ptg"), false, "no path, no toggle");
});

test("the list shows an item's title and path escaped, with its index and no URL", () => {
  const m = buildBoard(cfg, [row("app", 'bugs/"><img src=x>.md', "red")], undefined, true);
  const html = list("Resolve", m.items, new Map([["app", "App"]]), t);
  assert.ok(!html.includes("<img"));
  assert.ok(html.includes('data-id="0"'));
  assert.ok(html.includes("&#60;img src=x&#62;"));
  assert.ok(!/https?:/.test(html));
});

test("the list is capped at 30 rows and says how many are left out", () => {
  const rows = Array.from({ length: 35 }, (_, i) => row("app", `bugs/B${i}.md`, "red"));
  const m = buildBoard(cfg, rows, undefined, true);
  const html = list("Resolve", m.items, new Map(), t);
  assert.equal(html.match(/class="row"/g)?.length, 30);
  assert.ok(html.includes("more 5"));
});

test("an empty list says there is nothing here", () => {
  const html = list("Resolve", [], new Map(), t);
  assert.ok(html.includes("[nothingHere]"));
  assert.ok(html.includes('<summary class="sh" title="list"><h2 title="list"><span class="si" aria-hidden="true">📋</span> Resolve <span class="pill" title="count">0</span></h2></summary>'));
});

test("related items sit under a group heading, indented", () => {
  const m = buildBoard(
    cfg,
    [row("app", "bugs/OWNER_a.md", "red"), row("app", "bugs/OWNER_b.md", "red"), row("app", "bugs/lone.md", "red")],
    undefined,
    true
  );
  const html = list("Resolve", m.items, new Map(), t);
  assert.equal(html.match(/class="grp"/g)?.length, 1);
  assert.ok(html.includes("Owner documents"));
  assert.equal(html.match(/class="row in"/g)?.length, 2);
  assert.ok(html.indexOf("Owner documents") < html.indexOf("lone.md") || html.indexOf("lone.md") < html.indexOf("Owner documents"));
});

test("marks: a ring and size bars from the facts, a pin, and a hub label", () => {
  const snap = snapshotOf({ "docs/a.md": "# A\n\n- [x] one\n- [ ] two\n\n```sql\nselect 1\n```\n" });
  const m = buildBoard({ ...cfg, pinned: ["app/docs/a.md"] }, [row("app", "docs/a.md", "amber")], undefined, true, snap);
  const html = list("Work", m.items, new Map(), t);
  assert.ok(html.includes('class="ring part"'), "one of two steps done");
  assert.ok(html.includes("<b class=\"code\" title=\"codeLang\">S</b>"), "the first code language letter");
  assert.ok(html.includes('class="pin"'));
});

test("a Needs link shows a link mark and the blocker count of the document it waits on", () => {
  const snap = snapshotOf({ "docs/a.md": "# A\nNeeds: docs/b.md\n", "docs/b.md": "# B\n" });
  const m = buildBoard(cfg, [row("app", "docs/a.md", "amber"), row("app", "docs/b.md", "amber")], undefined, true, snap);
  const html = list("Work", m.items, new Map(), t);
  assert.ok(html.includes('class="link open"'));
  assert.ok(html.includes('class="link blocks"'));
});

const pathFor = (rows: Classified[], canRun: boolean): { path: PathToGo; m: ReturnType<typeof buildBoard> } => {
  const m = buildBoard(cfg, rows, undefined, true);
  return { m, path: pathToGo(m, m.projects[0], { maxSteps: 8, canRun: () => canRun }) };
};

test("path steps carry a hidden key list and no path", () => {
  const { path } = pathFor([row("app", "bugs/a.md", "red")], true);
  const html = pathList(path, t, 3, true);
  assert.ok(html.includes('data-live="1"'));
  assert.ok(html.includes("data-all="));
  assert.ok(!html.includes("bugs/a.md"), "the title only; the path never reaches the page");
});

test("a step that can run shows a run button; one that cannot shows none", () => {
  const withRun = pathFor([], true).path;
  const without = pathFor([], false).path;
  assert.ok(pathList(withRun, t, 0, true).includes('data-run="1"'));
  assert.ok(!pathList(without, t, 0, true).includes('data-run="1"'));
});

test("a page that cannot act draws no step buttons", () => {
  const { path } = pathFor([row("app", "bugs/a.md", "red")], true);
  const html = pathList(path, t, 0, false);
  assert.ok(!html.includes('class="ptgb"'));
  assert.ok(html.includes('data-live="0"'));
});

test("a project with nothing in the way says so", () => {
  const m = buildBoard({ ...cfg, projects: [{ id: "x", path: "x", roots: [], ruleSets: [] }] }, [], undefined, true, undefined, undefined, {
    x: { lint: "passing", tests: "passing", lintDetail: "", testsDetail: "", clean: true },
  });
  const path = pathToGo(m, m.projects[0], { maxSteps: 8, canRun: () => false });
  assert.ok(pathList(path, t, 0, true).includes("[ptgNone]"));
});

test("steps beyond the limit are counted in one note", () => {
  const rows = Array.from({ length: 6 }, (_, i) => row("app", `bugs/${i}.md`, "red"));
  const m = buildBoard(cfg, rows, undefined, true);
  const path = pathToGo(m, m.projects[0], { maxSteps: 3, canRun: () => false });
  assert.ok(path.hidden > 0);
  assert.ok(pathList(path, t, 0, true).includes(`ptgMore ${P(path.hidden)}`));
});

test("every row has a kebab button that opens the row menu, naming the document and carrying only its index", () => {
  const m = buildBoard(cfg, [row("app", "docs/a.md", "amber"), row("app", "docs/b.md", "amber")], undefined, true);
  const html = list("Work", m.items, new Map(), t);
  assert.equal(html.match(/data-menu="row"/g)?.length, 2);
  assert.ok(html.includes('data-menu="row" data-id="0" aria-haspopup="menu" aria-expanded="false" aria-controls="menu-row" title="rowMenu" aria-label="rowMenu">⋮</button>'));
  assert.ok(html.includes('data-id="1" aria-haspopup="menu"'));
  assert.equal(/data-menu="row"[^>]*docs\//.test(html), false, "no path in the kebab");
});

test("the project name is left out of a row when one project is in focus, and shown otherwise", () => {
  const m = buildBoard(cfg, [row("app", "docs/a.md", "amber"), row("db", "docs/b.md", "amber")], undefined, true);
  const names = new Map([["app", "App"], ["db", "Db"]]);
  assert.equal(list("Work", m.items, names, t, { single: true }).includes('class="tag"'), false);
  assert.equal(list("Work", m.items, names, t).match(/class="tag"/g)?.length, 2);
});

test("a row's icons are grouped; the most severe one is marked to stay on a narrow row and the group's tooltip lists all", () => {
  const snap = snapshotOf({ "bugs/a.md": "# A\n\nSeverity: critical. Data loss and a security hole when the app starts.\n" });
  const m = buildBoard({ ...cfg, pinned: ["app/bugs/a.md"] }, [row("app", "bugs/a.md", "red")], undefined, true, snap);
  const html = list("Work", m.items, new Map(), t);
  const group = /<span class="marks lm" title="([^"]*)">(.*?)<\/span><span class="k"/.exec(html);
  assert.ok(group, "the icon group is drawn");
  assert.ok(group[1].startsWith("marksMore"));
  assert.equal(group[2].match(/<span class="mk top">/g)?.length, 1, "exactly one icon stays");
  assert.ok(/<span class="mk top"><i class="sev /.test(group[2]), "the severity triangle outranks the pin");
  assert.ok((group[2].match(/<span class="mk"/g)?.length ?? 0) >= 1, "the others are hidden by the narrow rule");
});

test("the progress group keeps only its ring on a narrow row", () => {
  const snap = snapshotOf({ "docs/a.md": "# A\n\n- [x] one\n- [ ] two\n" });
  const m = buildBoard(cfg, [row("app", "docs/a.md", "amber")], undefined, true, snap);
  const html = list("Work", m.items, new Map(), t);
  assert.ok(html.includes('<span class="mk top"><i class="ring part"'));
  assert.ok(html.includes('<span class="mk"><i class="bars"'));
});

test("a document that stops the release (the pin or the stopping severity) is the icon that stays on a narrow row or another stopper, even beside a hot flame and a waiting link", () => {
  const snap = snapshotOf({ "docs/a.md": "# A\nNeeds: docs/b.md\n", "docs/b.md": "# B\n" });
  const m = buildBoard({ ...cfg, pinned: ["app/docs/a.md"] }, [row("app", "docs/a.md", "amber"), row("app", "docs/b.md", "amber")], undefined, true, snap);
  m.items[0].live = { errors: 1, warnings: 0, crashes: 0, hot: true, files: [{ file: "lib/a.dart", problems: { errors: 1, warnings: 0 } }], more: 0 };
  const html = list("Work", [m.items[0]], new Map(), t);
  const top = /<span class="marks lm"[^>]*>[\s\S]*?<span class="mk top">(.*?)<\/span>/.exec(html);
  assert.ok(top && /^<i class="(pin|sev [^"]* stop)"/.test(top[1]), `a stopper stays, not the flame or the link: ${top?.[1]}`);
  assert.ok(html.includes('class="flame hot"') && html.includes('class="link open"'), "the lesser marks are still drawn");
});
