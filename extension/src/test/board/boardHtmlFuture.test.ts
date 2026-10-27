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
