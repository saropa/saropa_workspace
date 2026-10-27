// Future tab, the list: which paths count, guesses, scores, order inside each flag and
// the sort choices, plus the read-only items found outside deferred folders.

import { test } from "node:test";
import assert from "node:assert/strict";
import { FutureInput, FutureItem, asFutureSort, blockKeyOf, buildFuture, buildItem, findOutside, futureSource, groupItems, guessFields, isFieldValue, moveTarget, scoreOf, compareItems } from "../../board/futureList";

const input = (path: string, block: string[] = [], title = "T", body = "Body\n"): FutureInput => ({
  project: "app",
  projectName: "App",
  path,
  text: `# ${title}\n\n${block.length ? block.join("\n") + "\n\n" : ""}${body}`,
});

test("only documents in the deferred and blocked folders count", () => {
  for (const p of ["plans/deferred/A.md", "plans/blocked/A.md", "docs/deferred/ux/A.md", "docs/deferred/A.md", "docs/blocked/A.md", "docs/blocked/sub/A.md", "plans/deferred/sub/A.md"]) {
    assert.ok(futureSource(p), p);
  }
  for (const p of ["plans/A.md", "docs/history/2026/deferred/A.md", "docs/deferred/A.txt", "other/plans/deferred/A.md", "plans/deferred/", "docs/guides/A.md", "bugs/deferred/A.md"]) {
    assert.equal(futureSource(p), undefined, p);
  }
  assert.equal(futureSource("plans/deferred/A.md"), "deferred");
  assert.equal(futureSource("docs/blocked/A.md"), "blocked");
});

test("a flag that crosses folders names the new path", () => {
  assert.equal(moveTarget("plans/deferred/X.md", true), "plans/blocked/X.md");
  assert.equal(moveTarget("plans/blocked/sub/Y.md", false), "plans/deferred/sub/Y.md");
  assert.equal(moveTarget("docs/deferred/ux/Z.md", true), "docs/blocked/Z.md");
  assert.equal(moveTarget("docs/blocked/Z.md", false), "docs/deferred/Z.md");
  assert.equal(moveTarget("plans/blocked/X.md", true), undefined);
  assert.equal(moveTarget("plans/deferred/X.md", false), undefined);
  assert.equal(moveTarget("plans/A.md", true), undefined);
});

test("guesses: importance from the folder and the text, effort from the length, risk from the words", () => {
  const g = (text: string, source: "deferred" | "blocked" = "deferred") => guessFields(text, source);
  assert.deepEqual(g("# T\n"), { importance: "nice-to-have", wow: 3, reach: "weekly", effort: "S", risk: "low" });
  assert.equal(g("# T\n", "blocked").importance, "not-feasible");
  assert.equal(g("This needs a decision first.").importance, "needs-decision");
  assert.equal(g("Open questions remain.").importance, "needs-decision");
  assert.equal(g("x\n".repeat(59)).effort, "S");
  assert.equal(g("x\n".repeat(60)).effort, "S");
  assert.equal(g("x\n".repeat(61)).effort, "M");
  assert.equal(g("x\n".repeat(149)).effort, "M");
  assert.equal(g("x\n".repeat(150)).effort, "M");
  assert.equal(g("x\n".repeat(151)).effort, "L");
  assert.equal(g("x\n".repeat(399)).effort, "L");
  assert.equal(g("x\n".repeat(401)).effort, "XL");
  assert.equal(g("A destructive macro.").risk, "high");
  assert.equal(g("Runs git reset --hard").risk, "high");
  assert.equal(g("Touches the shared schema.").risk, "medium");
  assert.equal(g("Plain work.").risk, "low");
});

test("a document with no block is listed with guessed values and no flag", () => {
  const item = buildItem(input("plans/deferred/A.md", [], "Alpha"), "deferred");
  assert.equal(item.title, "Alpha");
  assert.equal(item.group, "unflagged");
  assert.equal(item.importance, undefined);
  assert.equal(item.proposed, "nice-to-have");
  assert.deepEqual([item.wow, item.reach, item.effort, item.risk], [3, "weekly", "S", "low"]);
  assert.deepEqual(item.guessed, ["wow", "reach", "effort", "risk", "importance"]);
  assert.equal(scoreOf(item), 6);
});

test("block values win over guesses and only the missing ones are guessed", () => {
  const item = buildItem(input("plans/deferred/A.md", ["Importance: marketable", "Wow: 5", "Effort: L"]), "deferred");
  assert.equal(item.group, "marketable");
  assert.equal(item.proposed, "marketable");
  assert.deepEqual([item.wow, item.reach, item.effort, item.risk], [5, "weekly", "L", "low"]);
  assert.deepEqual(item.guessed, ["reach", "risk"]);
  assert.equal(item.scoreNum, 10);
  assert.equal(item.scoreDen, 4);
  assert.equal(scoreOf(item), 2.5);
});

test("a malformed block falls back to guesses for the bad fields", () => {
  const item = buildItem(input("plans/deferred/A.md", ["Importance: soon", "Wow: 9", "Reach: daily"]), "deferred");
  assert.equal(item.group, "unflagged");
  assert.deepEqual(item.guessed, ["wow", "effort", "risk", "importance"]);
  assert.equal(item.wow, 3);
  assert.equal(item.reach, "daily");
});

test("a document in blocked/ with no flag is Not feasible; its flag wins when it has one", () => {
  const bare = buildItem(input("plans/blocked/A.md"), "blocked");
  assert.equal(bare.group, "not-feasible");
  assert.equal(bare.importance, undefined);
  assert.equal(bare.proposed, "not-feasible");
  const flagged = buildItem(input("plans/blocked/B.md", ["Importance: marketable"]), "blocked");
  assert.equal(flagged.group, "marketable");
  const withBlocker = buildItem(input("plans/blocked/C.md", ["Importance: not-feasible", "Blocker: no editor API"]), "blocked");
  assert.equal(withBlocker.blocker, "no editor API");
});

test("an empty or oversized document (no text) is still listed from its path", () => {
  const item = buildItem({ project: "app", projectName: "App", path: "plans/deferred/HAPTIC_EVENT_CUES.md", text: "" }, "deferred");
  assert.equal(item.title, "HAPTIC_EVENT_CUES");
  assert.equal(item.group, "unflagged");
});

test("the title comes from the first heading, with markup stripped", () => {
  assert.equal(buildItem({ project: "p", projectName: "P", path: "plans/deferred/A.md", text: "﻿# Deferred: `Haptic` **cues**\n" }, "deferred").title, "Deferred: Haptic cues");
});

test("buildFuture ignores other folders and orders by project then path", () => {
  const items = buildFuture([
    { ...input("plans/deferred/B.md"), project: "b" },
    input("plans/deferred/Z.md"),
    input("plans/other/Q.md"),
    input("plans/blocked/A.md"),
    { ...input("docs/deferred/m/C.md"), project: "a" },
  ]);
  assert.deepEqual(items.map((i) => `${i.project}:${i.path}`), ["a:docs/deferred/m/C.md", "app:plans/blocked/A.md", "app:plans/deferred/Z.md", "b:plans/deferred/B.md"]);
});

const mk = (name: string, flag: string, wow: number, reach: string, effort: string, risk: string): FutureInput =>
  input(`plans/deferred/${name}.md`, [`Importance: ${flag}`, `Wow: ${wow}`, `Reach: ${reach}`, `Effort: ${effort}`, `Risk: ${risk}`], name);

const order = (items: FutureItem[], sort: "score" | "wow" | "effort" | "risk" | "reach", group = "nice-to-have"): string[] =>
  groupItems(items, sort).find((g) => g.group === group)!.entries.map((e) => e.item.title);

test("default order: wow times reach over effort, lower risk on a tie, then path", () => {
  const items = buildFuture([
    mk("a_high", "build-next", 5, "daily", "S", "high"),
    mk("b_low", "build-next", 5, "daily", "S", "low"),
    mk("c", "build-next", 3, "weekly", "M", "low"),
    mk("d_tie_b", "build-next", 3, "weekly", "S", "low"),
    mk("e_tie_a", "build-next", 2, "daily", "S", "low"),
  ]);
  // scores: a 15, b 15, c 3, d 6, e 6
  assert.deepEqual(order(items, "score", "build-next"), ["b_low", "a_high", "d_tie_b", "e_tie_a", "c"]);
  assert.deepEqual(items.map((i) => scoreOf(i)), [15, 15, 3, 6, 6]);
});

test("each sort puts its own field first and falls back to the score", () => {
  const items = buildFuture([
    mk("x1", "nice-to-have", 5, "daily", "XL", "high"),
    mk("x2", "nice-to-have", 1, "rare", "S", "low"),
    mk("x3", "nice-to-have", 3, "weekly", "M", "medium"),
    mk("x4", "nice-to-have", 4, "rare", "M", "low"),
  ]);
  // scores: x1 1.875, x2 1, x3 3, x4 2
  assert.deepEqual(order(items, "score"), ["x3", "x4", "x1", "x2"]);
  assert.deepEqual(order(items, "wow"), ["x1", "x4", "x3", "x2"]);
  assert.deepEqual(order(items, "effort"), ["x2", "x3", "x4", "x1"]);
  assert.deepEqual(order(items, "risk"), ["x4", "x2", "x3", "x1"]);
  assert.deepEqual(order(items, "reach"), ["x1", "x3", "x4", "x2"]);
});

test("the comparison is exact: scores are compared as fractions", () => {
  const items = buildFuture([mk("p", "nice-to-have", 4, "weekly", "L", "low"), mk("q", "nice-to-have", 1, "daily", "M", "low")]);
  // p = 8/4 = 2, q = 3/2 = 1.5
  assert.ok(compareItems(items[0], items[1], "score") < 0);
  assert.ok(compareItems(items[1], items[0], "score") > 0);
  assert.equal(compareItems(items[0], items[0], "score"), 0);
});

test("flags come in the fixed order, unflagged first and not feasible last; empty flags are left out", () => {
  const items = buildFuture([
    mk("n", "needs-decision", 3, "weekly", "S", "low"),
    mk("f", "not-feasible", 3, "weekly", "S", "low"),
    input("plans/deferred/u.md"),
    mk("b", "build-next", 3, "weekly", "S", "low"),
    mk("t", "nice-to-have", 3, "weekly", "S", "low"),
    mk("m", "marketable", 3, "weekly", "S", "low"),
  ]);
  assert.deepEqual(groupItems(items, "score").map((g) => g.group), ["unflagged", "build-next", "marketable", "nice-to-have", "needs-decision", "not-feasible"]);
  assert.deepEqual(groupItems(buildFuture([mk("b", "build-next", 3, "weekly", "S", "low")]), "score").map((g) => g.group), ["build-next"]);
});

test("entries carry the index into the list that was grouped, not the sorted position", () => {
  const items = buildFuture([mk("a_low", "nice-to-have", 1, "rare", "XL", "low"), mk("b_top", "nice-to-have", 5, "daily", "S", "low")]);
  const entries = groupItems(items, "score")[0].entries;
  assert.deepEqual(entries.map((e) => [e.i, e.item.title]), [[1, "b_top"], [0, "a_low"]]);
});

test("sort names from settings or the page", () => {
  assert.equal(asFutureSort("wow"), "wow");
  assert.equal(asFutureSort("random"), "score");
  assert.equal(asFutureSort(undefined), "score");
});

test("page fields map to block keys and only valid values pass", () => {
  assert.equal(blockKeyOf("importance"), "Importance");
  assert.equal(blockKeyOf("wow"), "Wow");
  assert.equal(blockKeyOf("research"), undefined);
  assert.equal(blockKeyOf("blocker"), undefined);
  assert.equal(isFieldValue("importance", "not-feasible"), true);
  assert.equal(isFieldValue("importance", ""), false);
  assert.equal(isFieldValue("importance", "soon"), false);
  assert.equal(isFieldValue("wow", "5"), true);
  assert.equal(isFieldValue("wow", "6"), false);
  assert.equal(isFieldValue("wow", 5), false);
  assert.equal(isFieldValue("effort", "XL"), true);
  assert.equal(isFieldValue("nope", "x"), false);
});

const outside = (text: string) => findOutside({ project: "app", projectName: "App", path: "ROADMAP.md", text });

test("bullets under Later and Exploratory headings are listed, nested bullets and later sections are not", () => {
  const text = [
    "# Roadmap",
    "## Later",
    "- **Alpha** - a [thing](http://x.test/a) to do",
    "  - nested detail",
    "* Beta",
    "## Done",
    "- Not listed",
    "### Exploratory ideas",
    "- Gamma",
    "## Next",
    "- Delta",
  ].join("\n");
  assert.deepEqual(
    outside(text).map((o) => [o.title, o.line, o.why]),
    [
      ["Alpha - a thing to do", 3, "later"],
      ["Beta", 5, "later"],
      ["Gamma", 9, "exploratory"],
    ]
  );
});

test("a heading whose Status line says Not started is listed once", () => {
  const text = ["### 6.3 Conflict center", "", "- **Status:** Not started. Speculative.", "### 6.4 Done thing", "- **Status:** Shipped", "### 6.5 Waiting", "", "### 6.6 Waiting too", "- **Status:** Not started"].join("\n");
  assert.deepEqual(
    outside(text).map((o) => [o.title, o.line, o.why]),
    [
      ["6.3 Conflict center", 1, "not-started"],
      ["6.6 Waiting too", 8, "not-started"],
    ]
  );
});

test("a Status line under the next heading does not belong to the heading above", () => {
  const text = ["### A", "text", "### B", "- Status: Not started"].join("\n");
  assert.deepEqual(outside(text).map((o) => o.title), ["B"]);
});

test("no more than 50 items are listed from one document", () => {
  const text = ["## Later", ...Array.from({ length: 80 }, (_v, i) => `- item ${i}`)].join("\n");
  const list = outside(text);
  assert.equal(list.length, 50);
  assert.equal(list[49].title, "item 49");
});

test("a document with CRLF lines and a byte order mark reads the same", () => {
  const list = outside("﻿## Later\r\n- One\r\n- Two\r\n");
  assert.deepEqual(list.map((o) => [o.title, o.line]), [["One", 2], ["Two", 3]]);
});
