// Future tab page: the tab buttons, the flag groups, the controls and what the page must
// never carry.

import { test } from "node:test";
import assert from "node:assert/strict";
import { BoardStrings, renderBoard } from "../../board/boardHtml";
import { FutureView, futureMenu, futurePanel, hasFuture, viewTabs } from "../../board/boardHtmlFuture";
import { buildFuture } from "../../board/futureList";
import { buildBoard } from "../../board/boardModel";
import { BoardConfig } from "../../board/types";

const t: BoardStrings = new Proxy({} as BoardStrings, {
  get: (_o, k: string) =>
    k === "futureLabels"
      ? new Proxy({}, { get: (_x, key: string) => `~${key}~` })
      : `[${k}]`,
});

const doc = (path: string, lines: string[], title = "T") => ({ project: "app", projectName: "App", path, text: `# ${title}\n\n${lines.length ? lines.join("\n") + "\n\n" : ""}Body\n` });

const view = (over: Partial<FutureView> = {}): FutureView => ({
  items: buildFuture([
    doc("plans/deferred/low.md", ["Importance: nice-to-have", "Wow: 1", "Reach: rare", "Effort: XL", "Risk: low"], "Low"),
    doc("plans/deferred/top.md", ["Importance: nice-to-have", "Wow: 5", "Reach: daily", "Effort: S", "Risk: low"], "Top"),
  ]),
  outside: [],
  sort: "score",
  canEdit: true,
  researchParallel: 3,
  ...over,
});

test("no view, or a view with no items, draws nothing", () => {
  assert.ok(!viewTabs(undefined, t).includes('data-tab="future"'));
  assert.equal(futurePanel(undefined, t), "");
  assert.ok(!viewTabs(view({ items: [] }), t).includes('data-tab="future"'));
  assert.equal(futurePanel(view({ items: [] }), t), "");
  assert.equal(hasFuture(view({ items: [], outside: [{ project: "app", projectName: "App", path: "ROADMAP.md", title: "x", line: 1, why: "later" }] })), false);
});

test("the tab bar names the count and starts on the Gantt", () => {
  const html = viewTabs(view(), t);
  assert.ok(html.includes('role="tablist"'));
  assert.ok(html.includes('data-tab="gantt" aria-selected="true"'));
  assert.ok(html.includes('data-tab="board" aria-selected="false"'));
  assert.ok(html.indexOf('data-tab="gantt"') < html.indexOf('data-tab="board"'));
  assert.ok(html.includes('data-tab="future" aria-selected="false"'));
  assert.ok(html.includes("~tab~"), "the label comes from the text table");
});

test("rows carry the index into the list, in sorted order inside the flag", () => {
  const html = futurePanel(view(), t);
  // items are ordered by path: low (0), top (1); the score puts top first.
  const first = html.indexOf('data-fut="1"');
  const second = html.indexOf('data-fut="0"');
  assert.ok(first > 0 && second > first);
  assert.ok(html.includes('data-menu="fut" data-id="1"'), "one kebab per item, carrying the index");
  assert.ok(!html.includes("<select data-ff"), "no row of selects");
});

test("the sort control lists every sort and marks the chosen one", () => {
  const html = futurePanel(view({ sort: "risk" }), t);
  for (const s of ["score", "wow", "effort", "risk", "reach"]) {
    assert.ok(html.includes(`<option value="${s}"`), s);
  }
  assert.ok(html.includes('<option value="risk" selected>'));
  assert.ok(!html.includes('<option value="score" selected>'));
});

test("each item is one line: tag, title, score, one importance pill and one kebab, with its values on the kebab", () => {
  const html = futurePanel(view(), t);
  const top = html.slice(html.indexOf('data-fut="1"'), html.indexOf('data-fut="0"'));
  assert.equal(top.match(/<select/g), null);
  assert.equal(top.match(/class="imp"/g)?.length, 1);
  assert.ok(top.includes("~flag.nice-to-have~"));
  assert.equal(top.match(/data-menu="fut"/g)?.length, 1);
  for (const a of ['data-importance="nice-to-have"', 'data-wow="5"', 'data-reach="daily"', 'data-effort="S"', 'data-risk="low"', 'data-research="none"']) {
    assert.ok(top.includes(a), a);
  }
  assert.ok(!top.includes("data-pv"), "a written flag has no proposal");
  assert.ok(!top.includes('class="imp guess"'), "nothing in this block is guessed");
  assert.ok(top.includes('title="~importance~: ~flag.nice-to-have~"'), "the pill has a tooltip");
  assert.ok(top.includes('aria-haspopup="menu"') && top.includes('aria-controls="menu-fut"'));
});

test("the menu lists every choice as a radio with a tooltip, and the proposal and empty flag as extras", () => {
  const m = futureMenu(view(), t);
  assert.ok(m.includes('id="menu-fut"') && m.includes('role="menu"'));
  assert.equal(futureMenu(undefined, t), "");
  for (const f of ["importance", "wow", "reach", "effort", "risk", "research"]) {
    assert.ok(m.includes(`data-ffield="${f}"`), f);
  }
  assert.ok(m.includes('data-act="ff:wow:5"') && m.includes('data-act="ff:reach:daily"') && m.includes('data-act="ff:effort:XL"') && m.includes('data-act="ff:risk:high"'));
  assert.ok(m.includes('data-act="ff:importance:not-feasible"') && m.includes('data-act="ff:research:ready"'));
  assert.ok((m.match(/role="menuitemradio"/g) ?? []).length >= 20);
  assert.ok(!m.replace(/role="menuitemradio"/g, "").includes("menuitemradio"));
  assert.equal((m.match(/<button/g) ?? []).length, (m.match(/<button[^>]* title="/g) ?? []).length, "every entry has a tooltip");
  assert.ok(m.includes('title="~wow~: 5"') && m.includes('title="~reach~: ~reach.daily~"'), "the tooltip names the characteristic and the value");
  assert.ok(m.includes('data-act="fpropose"') && m.includes('data-act="ff:importance:" '), "extras exist, hidden until the script needs them");
});

test("a document with no block shows a guessed pill, an Unflagged label and the proposal on its kebab", () => {
  const html = futurePanel(view({ items: buildFuture([doc("plans/deferred/new.md", [], "New")]) }), t);
  assert.ok(html.includes("~flag.unflagged~"));
  assert.equal(html.match(/class="imp guess"/g)?.length, 1);
  assert.ok(html.includes('data-importance=""'));
  assert.ok(html.includes('data-pv="nice-to-have"'));
  assert.ok(html.includes('data-gs="wow,reach,effort,risk,importance"'));
});

test("Not feasible shows the blocker with an edit button; text is escaped", () => {
  const items = buildFuture([doc("plans/blocked/h.md", ["Importance: not-feasible", "Blocker: <b>no</b> API & more"], "H")]);
  const html = futurePanel(view({ items }), t);
  assert.ok(html.includes("&#60;b&#62;no&#60;/b&#62; API &#38; more"));
  assert.ok(!html.includes("<b>no</b>"));
  assert.ok(html.includes('data-fblock="0"'));
  const none = futurePanel(view({ items: buildFuture([doc("plans/blocked/h.md", [], "H")]) }), t);
  assert.ok(none.includes("~noBlocker~"));
});

test("a title with markup cannot add markup", () => {
  const items = buildFuture([doc("plans/deferred/x.md", [], "<img src=x onerror=alert(1)>")]);
  const html = futurePanel(view({ items }), t);
  assert.ok(!html.includes("<img"));
  assert.ok(html.includes("&#60;img src=x onerror=alert(1)&#62;"));
});

test("while a scan is running or a stored result is shown every control is off", () => {
  const html = futurePanel(view({ canEdit: false }), t);
  const controls = html.match(/<button[^>]*data-menu="fut"[^>]*>/g) ?? [];
  assert.equal(controls.length, 2);
  assert.ok(controls.every((c) => c.includes(" disabled")), controls.join("\n"));
  const on = futurePanel(view(), t);
  assert.ok(!(on.match(/<button[^>]*data-menu="fut"[^>]*>/g) ?? []).some((c) => c.includes("disabled")));
});

test("items outside the deferred folders are listed read only, with their source", () => {
  const html = futurePanel(view({ outside: [{ project: "app", projectName: "App", path: "plans/MASTER_PLAN.md", title: "6.3 Conflict center", line: 228, why: "not-started" }] }), t);
  assert.ok(html.includes('data-fopen-o="0"'));
  assert.ok(html.includes("6.3 Conflict center"));
  assert.ok(html.includes("~outsideSource~"));
  assert.ok(html.includes("~outsideHeading~"));
  const row = html.slice(html.indexOf('data-fopen-o="0"'));
  assert.ok(!row.slice(0, row.indexOf("</div></div>")).includes("data-ff"), "no edit controls on a read-only row");
});

const cfg: BoardConfig = { version: 1, ignore: [], ruleSets: {}, projects: [{ id: "app", name: "App", path: "app", roots: [], ruleSets: [] }] };

test("the board page wraps its content in the Board tab and adds the Future tab when there is something to list", () => {
  const model = buildBoard(cfg, [], undefined, true);
  const html = renderBoard(model, t, "n", 1, {}, undefined, undefined, undefined, view());
  assert.ok(html.includes('id="tab-board"'));
  assert.ok(html.includes('id="tab-future"'));
  assert.ok(html.includes('role="tablist"'));
  assert.equal(html.match(/<script/g)?.length, 1);
  assert.ok(html.indexOf('id="tab-board"') < html.indexOf('id="tab-future"'));
  assert.ok(html.indexOf('id="tab-future"') < html.indexOf("<script"));
  const plain = renderBoard(model, t, "n", 1, {}, undefined, undefined, undefined, undefined);
  assert.ok(!plain.includes('id="tab-future"'));
  assert.ok(plain.includes('role="tablist"') && plain.includes('id="tab-gantt"'), "the Gantt and Board tabs are always there");
});

test("the page script sends only indexes and values, never a path", () => {
  const model = buildBoard(cfg, [], undefined, true);
  const html = renderBoard(model, t, "n", 1, {}, undefined, undefined, undefined, view());
  const script = html.slice(html.indexOf("<script"));
  assert.ok(script.includes("type:'futureSet',i:Number("));
  assert.ok(script.includes("fillFut"), "the script ticks the menu from the kebab");
  assert.ok(script.includes("type:'futureBlocker',i:Number("));
  assert.ok(script.includes("type:'futureOpen'"));
  assert.ok(script.includes("type:'futureSort',value:"));
  assert.ok(!script.includes("plans/deferred"));
});

const withResearch = (states: Array<[string, string[]]>, over: Partial<FutureView> = {}): FutureView =>
  view({ items: buildFuture(states.map(([name, lines]) => doc(`plans/deferred/${name}.md`, ["Importance: nice-to-have", ...lines], name))), ...over });

test("a document with no research state shows no research line and no question", () => {
  const html = futurePanel(withResearch([["A", []]]), t);
  assert.ok(!html.includes("data-frt"), "the research checkbox is gone");
  assert.ok(html.includes('data-research="none"'), "the state is set from the item's menu");
  assert.ok(!html.includes("~research.none~"), "no research line while the state is none");
  assert.ok(!html.includes("data-fq"), "no question while the state is none");
  assert.ok(!html.includes("data-fhand"), "no button without a flagged document");
  assert.ok(!html.includes('class="fresearch"'), "no summary without a research state");
});

test("a needed document shows its question in a textarea on its own row and the summary with the hand-off button", () => {
  const html = futurePanel(withResearch([["A", ["Research: needed", "Research question: Is it still possible?"]]]), t);
  assert.ok(/<div class="fc fqrow"><label[^>]*><span[^>]*>[^<]*<\/span><textarea class="fq" rows="2" data-fq="0" maxlength="300"/.test(html));
  assert.ok(html.includes('>Is it still possible?</textarea>'));
  assert.ok(html.includes('data-research="needed"') && html.includes("~research.needed~"));
  assert.ok(html.includes('<span title="researchCounts">~waiting~</span>'));
  assert.ok(html.includes("~handAll~"));
  assert.ok(html.includes("<button data-fhand "));
});

test("the summary counts each state and uses the fixed count wording", () => {
  const t2: BoardStrings = new Proxy({} as BoardStrings, {
    get: (_o, k: string) =>
      k === "futureLabels"
        ? { waiting: "{count} waiting", inProgressCount: "{count} running", readyCount: "{count} ready, not reviewed", handAll: "Hand all ({count})", handBatch: "Hand {batch} ({queued} queued)" }
        : `[${k}]`,
  });
  const html = futurePanel(withResearch([["A", ["Research: needed"]], ["B", ["Research: needed"]], ["C", ["Research: in-progress"]], ["D", ["Research: ready"]], ["E", ["Research: reviewed"]]]), t2);
  assert.ok(html.includes('<span title="researchCounts"><span class="pill" title="pillTip">2</span> waiting \u00b7 <span class="pill" title="pillTip">1</span> running \u00b7 <span class="pill" title="pillTip">1</span> ready, not reviewed</span>'));
  assert.ok(html.includes('>Hand all (<span class="pill" title="pillTip">2</span>)</button>'));
});

test("when more are flagged than the limit the button names the batch and how many stay queued", () => {
  const t2: BoardStrings = new Proxy({} as BoardStrings, {
    get: (_o, k: string) => (k === "futureLabels" ? { handAll: "Hand all ({count})", handBatch: "Hand {batch} ({queued} queued)" } : `[${k}]`),
  });
  const five: Array<[string, string[]]> = ["A", "B", "C", "D", "E"].map((n) => [n, ["Research: needed"]]);
  assert.ok(futurePanel(withResearch(five, { researchParallel: 3 }), t2).includes('>Hand <span class="pill" title="pillTip">3</span> (<span class="pill" title="pillTip">2</span> queued)</button>'));
  assert.ok(futurePanel(withResearch(five, { researchParallel: 5 }), t2).includes('>Hand all (<span class="pill" title="pillTip">5</span>)</button>'));
  assert.ok(futurePanel(withResearch(five, { researchParallel: 1 }), t2).includes('>Hand <span class="pill" title="pillTip">1</span> (<span class="pill" title="pillTip">4</span> queued)</button>'));
});

test("the hand-off button is disabled when the tab cannot edit", () => {
  const states: Array<[string, string[]]> = [["A", ["Research: needed"]]];
  const button = (v: FutureView): string => /<button data-fhand[^>]*>/.exec(futurePanel(v, t))![0];
  assert.ok(!button(withResearch(states)).includes("disabled"));
  assert.ok(button(withResearch(states, { canEdit: false })).includes(" disabled"));
});

test("research ready shows the not-reviewed label and the review button; other states do not", () => {
  const ready = futurePanel(withResearch([["A", ["Research: ready"]]]), t);
  assert.ok(ready.includes("~readyNotReviewed~"));
  assert.ok(ready.includes('<button data-frev="0" title="markReviewed">~markReviewed~</button>'));
  for (const state of ["none", "needed", "in-progress", "reviewed"]) {
    const html = futurePanel(withResearch([["A", [`Research: ${state}`]]]), t);
    assert.ok(!html.includes("data-frev") && !html.includes("~readyNotReviewed~"), state);
  }
});

test("the menu headings show icons for wow, reach, effort and risk beside the full name", () => {
  const m = futureMenu(view(), t);
  for (const icon of ["\u2728", "\u{1F465}", "\u23F1\uFE0F", "\u26A0\uFE0F"]) {
    assert.ok(m.includes(`aria-hidden="true">${icon}</span>`), icon);
  }
  assert.ok(m.includes("</span> ~wow~</div>"));
});

test("a tab that cannot edit disables every research control and the menu button", () => {
  const html = futurePanel(withResearch([["A", ["Research: ready"]]], { canEdit: false }), t);
  assert.ok(/<button[^>]*data-menu="fut"[^>]* disabled[ >]/.test(html), "the menu button is off");
  assert.ok(/<textarea[^>]*data-fq="0"[^>]* disabled>/.test(html));
  assert.ok(html.includes('<button data-frev="0" disabled title="markReviewed">'));
});

test("the question is escaped and the page carries only indexes for research", () => {
  const html = futurePanel(withResearch([["A", ["Research: needed", 'Research question: "><script>alert(1)</script> & <b>']]]), t);
  assert.ok(!html.includes("<script>"));
  assert.ok(html.includes('>&#34;&#62;&#60;script&#62;alert(1)&#60;/script&#62; &#38; &#60;b&#62;</textarea>'));
  const attrs = html.match(/data-(fq|frev|fhand)="?[^ >]*/g) ?? [];
  assert.ok(attrs.every((a) => /^data-(fq|frev)="\d+"$/.test(a) || a === "data-fhand"), attrs.join(" "));
});

test("section headings carry an icon from one helper, and the setting turns every one off", () => {
  const model = buildBoard({ projects: [{ id: "app", name: "App", path: "." }] } as unknown as BoardConfig, [], undefined, true, undefined);
  const on = renderBoard(model, t, "n", 1, {}, undefined, undefined, undefined, view());
  const off = renderBoard(model, t, "n", 1, { sectionIcons: false }, undefined, undefined, undefined, view());
  assert.ok(on.includes('class="si"'), "icons on by default");
  assert.ok(!off.includes('class="si"'), "no icon when the setting is off");
  assert.ok(!on.includes("summary.sh::before") && on.includes("summary.sh::after"), "chevron sits at the right of the summary");
  assert.ok(!/<summary(?![^>]*class="sh")/.test(on), "every summary uses the shared style");
});
