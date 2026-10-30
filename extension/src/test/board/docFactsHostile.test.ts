// Hostile text: documents built to make a pattern backtrack must be read in linear time, and
// real-shaped documents must still read as before. There are no timing assertions: a hang fails the suite.

import { test } from "node:test";
import assert from "node:assert/strict";
import { needsTargets, parseNeeds, readFacts } from "../../board/docFacts";
import { addNeed, removeNeed } from "../../board/needsEdit";

// Runs `f` once. There is no timing check: a pattern that backtracks badly would hang the suite.
function fast(_name: string, _budgetMs: number, f: () => void): void {
  f();
}

test("facts read hostile documents in linear time", () => {
  const doc = (body: string): string => `# T\n\n${body}\n`;
  const cases: Array<[string, string]> = [
    ["whitespace-only lines", doc("  \n".repeat(40_000))],
    ["blank lines", doc("\n".repeat(400_000))],
    ["one line of spaces", doc(" ".repeat(1_000_000))],
    ["heading of spaces", doc(`#${" ".repeat(500_000)}x${" ".repeat(500_000)}`)],
    ["heading of marks", doc(`# a${"# ".repeat(200_000)}`)],
    ["Needs of spaces", doc(`Needs:${" ".repeat(20_000)}`)],
    ["Needs of brackets", doc(`Needs: ${"[".repeat(20_000)}`)],
    ["Needs of stars", doc(`Needs:${"*".repeat(40_000)}`)],
    ["inline base64 image", doc(`![x](data:image/png;base64,${"A1/b".repeat(475_000)})`)],
    ["many name-like lines", doc("a.b/c-d_e".repeat(200_000))],
    ["many document names", doc("x.md ".repeat(200_000))],
  ];
  for (const [name, text] of cases) {
    fast(name, 3000, () => readFacts(text, "doc.md"));
  }
});

test("a document above the facts budget is read up to the budget", () => {
  const text = `# T\n\n${"word ".repeat(1_000_000)}`;
  const f = readFacts(text, "doc.md");
  assert.equal(f.chars, text.length);
  assert.ok(f.words < 400_100);
});

test("hostile Needs text is read in linear time", () => {
  for (const text of [`Needs:${" ".repeat(20_000)}`, `Needs: ${"[".repeat(20_000)}`, `Needs: ${"](".repeat(20_000)}`, `Needs: ${"a and ".repeat(300)}${" ".repeat(20_000)}`]) {
    fast("parseNeeds", 1500, () => parseNeeds(text));
    fast("needsTargets", 1500, () => needsTargets(text));
  }
});

test("the Needs editor reads hostile lines in linear time and leaves them alone", () => {
  const stars = `# T\n\nNeeds:${"*".repeat(40_000)}\n`;
  const spaces = `# T\n\nNeeds:${" ".repeat(20_000)}\n`;
  for (const text of [stars, spaces, `# T\n\nNeeds: ${"[".repeat(20_000)}\n`, `# T\n\n${"-".repeat(40_000)}needs: x\n`]) {
    fast("addNeed", 1500, () => addNeed(text, "docs/A.md", "a.md"));
    fast("removeNeed", 1500, () => removeNeed(text, "docs/A.md", "a.md"));
  }
  assert.equal(addNeed(stars, "docs/A.md", "a.md").ok, true);
  assert.equal(removeNeed(stars, "docs/A.md", "a.md").ok, false);
});

test("the Needs editor refuses a document above the size budget", () => {
  const big = `# T\n\n${"x\n".repeat(1_100_000)}`;
  assert.deepEqual(addNeed(big, "docs/A.md", "a.md"), { ok: false, reason: "shape" });
  assert.deepEqual(removeNeed(big, "docs/A.md", "a.md"), { ok: false, reason: "shape" });
});

test("a Needs line past the line limit is not read as a Needs line", () => {
  assert.deepEqual(parseNeeds(`Needs: ${"a".repeat(2100)}`), []);
  assert.deepEqual(parseNeeds(`Needs: ${"a".repeat(1900)}`), ["a".repeat(1900)]);
});

test("real shapes read the same as before", () => {
  const text = [
    "---",
    "tags: [a]",
    "---",
    "# Plan: share keys  ##",
    "",
    "## Steps",
    "- [ ] first step",
    "   * [x] done step",
    "  - [ ]   padded step",
    "### Later ###",
    "| Item | Status | Needs |",
    "| --- | --- | --- |",
    "| one | pending | docs/B.md |",
    "| two | done | |",
    "See docs/OTHER.md, ../x/PLAN_B.md and a/b/c.md.md plus https://example.com/x.",
    "> **Needs:** docs/PLAN_A.md, [Other, the plan](../x/PLAN_B.md); supabase:db-access/run.sql and `lib/a.dart`.",
    "```",
    "Needs: ignored.md",
    "```",
    "#### too deep",
  ].join("\n");
  const f = readFacts(text, "doc.md");
  assert.equal(f.title, "Plan: share keys  ##");
  assert.equal(f.headings, 3);
  assert.equal(f.stepsOpen, 2);
  assert.equal(f.stepsDone, 1);
  assert.deepEqual(f.steps, [
    { line: 7, heading: "Steps", text: "first step" },
    { line: 9, heading: "Steps", text: "padded step" },
    { line: 13, heading: "Later", text: "one", needsCell: "docs/B.md" },
  ]);
  assert.equal(f.rowsAll, 2);
  assert.equal(f.docRefs, 5);
  assert.deepEqual(f.docRefNames, ["../x/PLAN_B.md", "a/b/c.md.md", "docs/B.md", "docs/OTHER.md", "docs/PLAN_A.md"]);
  assert.deepEqual(f.needs, ["docs/PLAN_A.md", "../x/PLAN_B.md", "supabase:db-access/run.sql", "lib/a.dart"]);
});

test("source paths are read in one pass, also on hostile runs", () => {
  const hostile = readFacts(`# T\n\n${"src/".repeat(20_000)}`, "doc.md");
  assert.equal(hostile.sourceRefs, 0);
  assert.deepEqual(hostile.sourceFiles, []);
  const text = "See lib/a.dart, extension/src/x/y.ts and src/src/b.py; also src/c.tsx, test/d.sql.md, supabase/e.sql-f.sql.";
  const f = readFacts(text, "doc.md");
  assert.deepEqual(f.sourceFiles, ["extension/src/x/y.ts", "lib/a.dart", "src/src/b.py", "supabase/e.sql-f.sql", "test/d.sql"]);
  assert.equal(f.sourceRefs, 5);
});

test("a Needs line is read in a document with lone carriage returns", () => {
  assert.deepEqual(parseNeeds("# T\rNeeds: a.md\rmore\rNeeds: b.md"), ["a.md", "b.md"]);
});
