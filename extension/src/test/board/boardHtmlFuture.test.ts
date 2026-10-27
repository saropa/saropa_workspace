// Future tab page: the tab buttons, the flag groups, the controls and what the page must
// never carry.

import { test } from "node:test";
import assert from "node:assert/strict";
import { BoardStrings, renderBoard } from "../../board/boardHtml";
import { FutureView, futurePanel, futureTabs, hasFuture } from "../../board/boardHtmlFuture";
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
  handEnabled: true,
  ...over,
});

test("no view, or a view with no items, draws nothing", () => {
  assert.equal(futureTabs(undefined, t), "");
  assert.equal(futurePanel(undefined, t), "");
  assert.equal(futureTabs(view({ items: [] }), t), "");
  assert.equal(futurePanel(view({ items: [] }), t), "");
  assert.equal(hasFuture(view({ items: [], outside: [{ project: "app", projectName: "App", path: "ROADMAP.md", title: "x", line: 1, why: "later" }] })), false);
});

test("the tab bar names the count and starts on the board", () => {
  const html = futureTabs(view(), t);
  assert.ok(html.includes('role="tablist"'));
  assert.ok(html.includes('data-tab="board" aria-selected="true"'));
  assert.ok(html.includes('data-tab="future" aria-selected="false"'));
  assert.ok(html.includes("~tab~"), "the label comes from the text table");
});

test("rows carry the index into the list, in sorted order inside the flag", () => {
  const html = futurePanel(view(), t);
  // items are ordered by path: low (0), top (1); the score puts top first.
  const first = html.indexOf('data-fut="1"');
  const second = html.indexOf('data-fut="0"');
  assert.ok(first > 0 && second > first);
  assert.ok(html.includes('data-ff="importance" data-fi="1"'));
  assert.ok(html.includes('data-ff="wow" data-fi="1"'));
});

test("the sort control lists every sort and marks the chosen one", () => {
  const html = futurePanel(view({ sort: "risk" }), t);
  for (const s of ["score", "wow", "effort", "risk", "reach"]) {
    assert.ok(html.includes(`<option value="${s}"`), s);
  }
  assert.ok(html.includes('<option value="risk" selected>'));
  assert.ok(!html.includes('<option value="score" selected>'));
});

test("the controls show the document's values", () => {
  const html = futurePanel(view(), t);
  const top = html.slice(html.indexOf('data-fut="1"'), html.indexOf('data-fut="0"'));
  assert.ok(top.includes('<option value="5" selected>'));
  assert.ok(top.includes('<option value="daily" selected>'));
  assert.ok(top.includes('<option value="S" selected>'));
  assert.ok(top.includes('<option value="nice-to-have" selected>'));
  assert.ok(!top.includes('class="guess"'), "nothing in this block is guessed");
});

test("a document with no block shows guessed controls and an Unflagged group with a proposal button", () => {
  const html = futurePanel(view({ items: buildFuture([doc("plans/deferred/new.md", [], "New")]) }), t);
  assert.ok(html.includes("~flag.unflagged~"));
  assert.equal(html.match(/class="guess"/g)?.length, 5);
  assert.ok(html.includes('<option value="" selected>'));
  assert.ok(html.includes('data-faccept="0" data-fv="nice-to-have"'));
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
  const controls = (html.match(/<(select|button) data-f[a-z]+[^>]*>/g) ?? []).filter((c) => !c.includes("data-fsort"));
  assert.ok(controls.length >= 10);
  assert.ok(controls.every((c) => c.includes(" disabled")), controls.join("\n"));
  const on = futurePanel(view(), t);
  assert.ok(!(on.match(/<select data-ff[^>]*>/g) ?? []).some((c) => c.includes("disabled")));
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
  assert.ok(!plain.includes('role="tablist"'));
});

test("the page script sends only indexes and values, never a path", () => {
  const model = buildBoard(cfg, [], undefined, true);
  const html = renderBoard(model, t, "n", 1, {}, undefined, undefined, undefined, view());
  const script = html.slice(html.indexOf("<script"));
  assert.ok(script.includes("type:'futureSet',i:Number("));
  assert.ok(script.includes("type:'futureBlocker',i:Number("));
  assert.ok(script.includes("type:'futureOpen'"));
  assert.ok(script.includes("type:'futureSort',value:"));
  assert.ok(!script.includes("plans/deferred"));
});

const withResearch = (states: Array<[string, string[]]>, over: Partial<FutureView> = {}): FutureView =>
  view({ items: buildFuture(states.map(([name, lines]) => doc(`plans/deferred/${name}.md`, ["Importance: nice-to-have", ...lines], name))), ...over });

test("a document with no research state shows the toggle off, the state list and an empty question", () => {
  const html = futurePanel(withResearch([["A", []]]), t);
  assert.ok(html.includes('<input type="checkbox" data-frt="0" title="researchToggle">'));
  assert.ok(html.includes('data-ff="research" data-fi="0"'));
  assert.ok(html.includes('<option value="none" selected>~research.none~</option>'));
  for (const v of ["needed", "in-progress", "ready", "reviewed"]) {
    assert.ok(html.includes(`<option value="${v}">~research.${v}~</option>`), v);
  }
  assert.ok(html.includes('data-fq="0" maxlength="300" value=""'));
  assert.ok(!html.includes("data-fhand"), "no button without a flagged document");
  assert.ok(!html.includes('class="fresearch"'), "no summary without a research state");
});

test("a needed document shows the toggle on, its question and the summary with the hand-off button", () => {
  const html = futurePanel(withResearch([["A", ["Research: needed", "Research question: Is it still possible?"]]]), t);
  assert.ok(html.includes('<input type="checkbox" data-frt="0" checked title="researchToggle">'));
  assert.ok(html.includes('value="Is it still possible?"'));
  assert.ok(html.includes('<option value="needed" selected>'));
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

test("the hand-off button is disabled when the tab cannot edit or Hand to chat is off", () => {
  const states: Array<[string, string[]]> = [["A", ["Research: needed"]]];
  const button = (v: FutureView): string => /<button data-fhand[^>]*>/.exec(futurePanel(v, t))![0];
  assert.ok(!button(withResearch(states)).includes("disabled"));
  assert.ok(button(withResearch(states, { canEdit: false })).includes(" disabled"));
  const off = button(withResearch(states, { handEnabled: false }));
  assert.ok(off.includes(" disabled"));
  assert.ok(off.includes("~handOffTip~"));
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

test("the toggle is locked while research is under way, ready or reviewed", () => {
  for (const state of ["in-progress", "ready", "reviewed"]) {
    const html = futurePanel(withResearch([["A", [`Research: ${state}`]]]), t);
    assert.ok(html.includes('<input type="checkbox" data-frt="0" disabled title="researchToggle">'), state);
  }
});

test("a tab that cannot edit disables every research control", () => {
  const html = futurePanel(withResearch([["A", ["Research: ready"]]], { canEdit: false }), t);
  assert.ok(html.includes('data-frt="0" disabled'));
  assert.ok(html.includes('data-ff="research" data-fi="0"') && /<select data-ff="research"[^>]*disabled>/.test(html));
  assert.ok(/<input type="text"[^>]*data-fq="0"[^>]* disabled>/.test(html));
  assert.ok(html.includes('<button data-frev="0" disabled title="markReviewed">'));
});

test("the question is escaped and the page carries only indexes for research", () => {
  const html = futurePanel(withResearch([["A", ["Research: needed", 'Research question: "><script>alert(1)</script> & <b>']]]), t);
  assert.ok(!html.includes("<script>"));
  assert.ok(html.includes('value="&#34;&#62;&#60;script&#62;alert(1)&#60;/script&#62; &#38; &#60;b&#62;"'));
  const attrs = html.match(/data-(frt|fq|frev|fhand)="?[^ >]*/g) ?? [];
  assert.ok(attrs.every((a) => /^data-(frt|fq|frev)="\d+"$/.test(a) || a === "data-fhand"), attrs.join(" "));
});
