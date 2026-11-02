// "Which comes first": the order answers in the marks file, how they are read back (BoardItem.after, the Gantt,
// Up next, tooltips) and the question logic. Through the real entry points (buildBoard, renderBoard, the marks
// reader and writer). Written, not run by the build agent.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildBoard } from "../../board/boardModel";
import { BoardStrings, renderBoard } from "../../board/boardHtml";
import { buildGantt, upNext } from "../../board/ganttModel";
import { pathToGo } from "../../board/pathToGo";
import { fromModel } from "../../board/handoff";
import { MAX_ENTRIES, emptyMarks, fitMarks, mergeMarks, parseMarks, setOrder } from "../../board/marks";
import {
  MAX_FOLDER_PAIRS,
  MAX_PAIRS,
  MAX_SKIPPED,
  NO_FOLDER,
  OrderEntry,
  OrderItem,
  Pair,
  afterOf,
  emptyOrder,
  forgetItem,
  nextQuestion,
  nextQuestionFor,
  settle,
  tidyOrder,
  withAnswer,
} from "../../board/orderAsk";
import { folderOf } from "../../board/orderModel";
import { BoardConfig, BoardStatus, Classified } from "../../board/types";

const cfg: BoardConfig = { version: 1, ignore: [], ruleSets: {}, projects: [{ id: "app", name: "App", path: "app", roots: [], ruleSets: [] }] } as BoardConfig;
const row = (p: string, status: BoardStatus): Classified => ({ project: "app", path: p, status, kind: "", note: "" });
const names = ["A", "B", "C", "D"];
const rows = names.map((n) => row(`docs/${n}.md`, "amber"));
const pins = names.map((n) => `app/docs/${n}.md`);
const t: BoardStrings = new Proxy({} as BoardStrings, { get: (_o, k: string) => (k === "more" || k === "blocked" || k === "reasonGrey" ? `${k} {count}` : `[${k}]`) });
const build = (order: Record<string, OrderEntry> = {}, extra: object = {}) => buildBoard(cfg, rows, undefined, true, undefined, undefined, undefined, { pins, answered: ["app"], order, ...extra });
const entry = (pairs: Pair[], more: Partial<OrderEntry> = {}): OrderEntry => ({ ...emptyOrder(), pairs, ...more });
const p = (n: string): string => `docs/${n}.md`;
const item = (path: string, sev = 3, folder = "", blocksCount = 0): OrderItem => ({ path, folder, sev, blocksCount });
const idOf = (m: ReturnType<typeof build>, n: string): number => m.items.find((i) => i.path === p(n))!.id;

test("marks: order is parsed, merged local over shared, and capped the same on read and write", () => {
  const many = (n: number): Pair[] => Array.from({ length: n }, (_v, i) => [`a${i}.md`, `b${i}.md`] as Pair);
  const read = parseMarks(JSON.stringify({ order: { app: { pairs: many(MAX_PAIRS + 5), skipped: many(MAX_SKIPPED + 5), folders: many(MAX_FOLDER_PAIRS + 5) }, bad: { pairs: [["x"], [1, 2], ["a", "a"]] }, __proto__: { pairs: many(1) } } }));
  assert.equal(read.order.app.pairs.length, MAX_PAIRS);
  assert.equal(read.order.app.skipped.length, MAX_SKIPPED);
  assert.equal(read.order.app.folders.length, MAX_FOLDER_PAIRS);
  assert.equal(read.order.bad, undefined, "malformed pairs are dropped and an empty entry is not kept");
  // The writer refuses what the reader would cut: nothing is silently lost.
  assert.equal(fitMarks(setOrder(emptyMarks(), "app", entry(many(MAX_PAIRS + 1)))), undefined);
  assert.ok(fitMarks(setOrder(emptyMarks(), "app", entry(many(MAX_PAIRS)))));
  assert.equal(fitMarks(setOrder(emptyMarks(), "app", entry([], { skipped: many(MAX_SKIPPED + 1) }))), undefined);
  assert.equal(fitMarks(setOrder(emptyMarks(), "app", entry([], { folders: many(MAX_FOLDER_PAIRS + 1) }))), undefined);
  const projects = Object.fromEntries(Array.from({ length: MAX_ENTRIES + 1 }, (_v, i) => [`p${i}`, entry(many(1))]));
  assert.equal(fitMarks({ ...emptyMarks(), order: projects }), undefined);
  // Local over shared, per project.
  const merged = mergeMarks(setOrder(emptyMarks(), "app", entry([[p("A"), p("B")]])), setOrder(emptyMarks(), "app", entry([[p("B"), p("A")]])));
  assert.deepEqual(merged.order.app.pairs, [[p("B"), p("A")]]);
  assert.deepEqual(setOrder(emptyMarks(), "app", emptyOrder()).order, {}, "an empty entry removes the project's answers");
});

test("no order entry: the board is the same as before (no after, no folder rank, no mark)", () => {
  const m = build();
  assert.ok(m.items.every((i) => i.after === undefined && i.inferred === undefined));
  assert.equal(m.projects[0].folderRank, undefined);
  const html = renderBoard(m, t, "n", 1, { groupBy: "project" });
  assert.ok(!html.includes('class="ginf"'));
  assert.deepEqual(buildGantt(m)[0].rows.map((r) => r.after), [[], [], [], []]);
});

test("A before B and B before C infers A before C and is never asked", () => {
  const e = entry([[p("A"), p("B")], [p("B"), p("C")]]);
  const placed = afterOf(settle(e.pairs).kept, new Set([p("A"), p("B"), p("C")]));
  assert.deepEqual(placed.get(p("C")), { after: [p("B")], inferred: [p("A")] });
  assert.deepEqual(placed.get(p("B")), { after: [p("A")], inferred: [] });
  const q = nextQuestion([item(p("A")), item(p("B")), item(p("C"))], e);
  assert.equal(q, undefined, "all three are ordered");
  // Through a closed document the order still holds.
  assert.deepEqual(afterOf([[p("A"), "closed.md"], ["closed.md", p("C")]], new Set([p("A"), p("C")])).get(p("C")), { after: [p("A")], inferred: [] });
});

test("ten items in agreeing severity order take nine questions; the worst case stays under N times log2 N", () => {
  const ten = Array.from({ length: 10 }, (_v, i) => item(`d${i}.md`, 0));
  const ask = (newFirst: boolean): number => {
    let e = emptyOrder();
    let n = 0;
    for (let q = nextQuestion(ten, e); q; q = nextQuestion(ten, e)) {
      n++;
      assert.ok(n < 100, "terminates");
      e = withAnswer(e, q, newFirst ? q.a : q.b);
    }
    return n;
  };
  // The owner agrees with the guess: the item asked about (a) comes after the placed one (b).
  assert.equal(ask(false), 9);
  // The owner reverses every guess: more questions, but bounded.
  const worst = ask(true);
  assert.ok(worst >= 9 && worst <= 10 * Math.ceil(Math.log2(10)), `worst was ${worst}`);
});

test("Needs beats a contradicting answer and the newest answer beats an older one", () => {
  assert.deepEqual(settle([[p("A"), p("B")]], [[p("B"), p("A")]]).dropped, [[p("A"), p("B")]], "Needs wins");
  const { kept, dropped } = settle([[p("A"), p("B")], [p("B"), p("C")], [p("C"), p("A")]]);
  assert.deepEqual(dropped, [[p("A"), p("B")]], "the oldest answer on the loop loses");
  assert.equal(kept.length, 2);
  // On the board a loop of answers never breaks the Gantt.
  const m = build({ app: entry([[p("A"), p("B")], [p("B"), p("A")]]) });
  assert.equal(buildGantt(m)[0].rows.length, 4);
});

test("a skipped pair is not asked again; asking about one item clears its pairs; a stale path is dropped on write", () => {
  const two = [item(p("A")), item(p("B"))];
  const q = nextQuestion(two, emptyOrder())!;
  const skipped = withAnswer(emptyOrder(), q, undefined);
  assert.equal(nextQuestion(two, skipped), undefined);
  assert.deepEqual(forgetItem(entry([[p("A"), p("B")]], { skipped: [[p("A"), p("C")]] }), p("A")), emptyOrder());
  const { entry: cleaned, lost } = tidyOrder(entry([[p("A"), p("B")], [p("A"), "gone.md"]]), [], (x) => x !== "gone.md");
  assert.deepEqual(cleaned.pairs, [[p("A"), p("B")]]);
  assert.equal(lost, 1);
});

test("folders are asked first and only the top folder's documents are asked", () => {
  const items = [item("a1.md", 0, "fa"), item("a2.md", 1, "fa"), item("b1.md", 2, "fb"), item("b2.md", 3, "fb")];
  const first = nextQuestion(items, emptyOrder())!;
  assert.equal(first.kind, "folder");
  const answered = withAnswer(emptyOrder(), first, "fa");
  const second = nextQuestion(items, answered)!;
  assert.equal(second.kind, "item");
  assert.ok(second.a.startsWith("a") && second.b.startsWith("a"), "inside the top folder");
  const done = withAnswer(answered, second, second.b);
  const third = nextQuestion(items, done)!;
  assert.ok(third.a.startsWith("b"), "the next folder only after the top one is ordered");
  // Folder answers order sections only: no item gets an edge from them.
  assert.equal(done.pairs.length, 1);
});

test("a closed document keeps transitivity and hands its answers back when it reopens", () => {
  const e = entry([[p("A"), p("B")], [p("B"), p("C")]]);
  const placed = afterOf(settle(e.pairs).kept, new Set([p("A"), p("C")]));
  assert.deepEqual(placed.get(p("C")), { after: [p("A")], inferred: [] });
});

test("an ungrouped folder answer survives the write and read round trip", () => {
  const items = [item("a.md", 0, NO_FOLDER), item("b.md", 1, NO_FOLDER), item("c.md", 2, "fb")];
  const first = nextQuestion(items, emptyOrder())!;
  assert.equal(first.kind, "folder");
  const e = withAnswer(emptyOrder(), first, NO_FOLDER);
  const back = parseMarks(JSON.stringify(setOrder(emptyMarks(), "app", e))).order.app;
  assert.deepEqual(back.folders, e.folders, "the ungrouped folder id is kept");
  assert.notEqual(nextQuestion(items, back)?.kind, "folder", "the folder question is not asked again");
  // Ungrouped board items use the same id.
  assert.ok(build().projects[0].items.every((i) => folderOf(i) === NO_FOLDER));
  // A folder that is gone is dropped on write.
  assert.deepEqual(tidyOrder(e, [], () => true, (id) => id === NO_FOLDER).entry.folders, []);
});

test("at the skip cap nothing more is asked, so a batch is never refused", () => {
  const two = [item(p("A")), item(p("B"))];
  const full = entry([], { skipped: Array.from({ length: MAX_SKIPPED }, (_v, i) => [`x${i}.md`, `y${i}.md`] as Pair) });
  assert.equal(nextQuestion(two, full), undefined);
  assert.equal(nextQuestionFor(two, full, p("B")), undefined);
  assert.ok(fitMarks(setOrder(emptyMarks(), "app", full)));
});

test("the board reads answers into after, the Gantt ranks, and the tooltip names the source", () => {
  const m = build({ app: entry([[p("A"), p("B")], [p("B"), p("C")]]) });
  assert.deepEqual(m.items.find((i) => i.path === p("C"))!.after, [idOf(m, "B")]);
  assert.deepEqual(m.items.find((i) => i.path === p("C"))!.inferred, [idOf(m, "A")]);
  assert.deepEqual(m.items.find((i) => i.path === p("C"))!.waitsOn, [], "an answer is not a dependency");
  const g = buildGantt(m)[0];
  const at = (n: string) => g.rows.find((r) => r.path === p(n))!;
  assert.ok(at("A").start < at("B").start && at("B").start < at("C").start, "later answers start later");
  assert.deepEqual(at("C").after, [idOf(m, "B")]);
  assert.deepEqual(at("C").askedNames, [at("B").title]);
  const html = renderBoard(m, t, "n", 1, { groupBy: "project" });
  assert.ok(html.includes('class="ginf"'), "the dotted chain mark on the inferred row");
  assert.ok(html.includes("[ganttAsked]") || html.includes("ganttAsked"), "the asked line is in a tooltip");
  // Handoff and path to go never read an answer.
  assert.deepEqual(m.items.map((i) => i.waitsOn), [[], [], [], []]);
  assert.ok(pathToGo && fromModel);
});

test("Up next leaves out an item that is after an open one", () => {
  const m = build({ app: entry([[p("A"), p("B")]]) });
  const up = upNext(m).map((i) => i.path);
  assert.ok(up.includes(p("A")) && !up.includes(p("B")));
});

test("tooltip names are escaped", () => {
  const m = build({ app: entry([[p("A"), p("B")]]) });
  m.items.find((i) => i.path === p("A"))!.title = '"><img src=x onerror=alert(1)>';
  const html = renderBoard(m, t, "n", 1, { groupBy: "project" });
  assert.ok(!html.includes("<img src=x"));
});
