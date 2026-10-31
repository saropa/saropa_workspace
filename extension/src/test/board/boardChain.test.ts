// Chain controls: the host finds the row above itself, in the order the move arrows use, and
// reuses the Waits on plan.

import { test } from "node:test";
import assert from "node:assert/strict";
import { planDrop } from "../../board/boardDrop";
import { buildBoard } from "../../board/boardModel";
import { readFacts } from "../../board/docFacts";
import { ScanSnapshot } from "../../board/scanner";
import { BoardConfig, BoardStatus, Classified, emptyCounts } from "../../board/types";

const row = (path: string): Classified => ({ project: "app", path, status: "amber" as BoardStatus, kind: "", note: "" });
const entry = (path: string, text: string) => [path, { size: text.length, mtimeMs: 1, facts: readFacts(text, path) }] as const;
const snap: ScanSnapshot = {
  version: 1,
  takenAt: 1,
  projects: { app: { counts: emptyCounts(), folders: {}, ruleCounts: {}, greyFolders: {}, files: {}, facts: Object.fromEntries([entry("a.md", "# Alpha\n"), entry("b.md", "# Beta\n\nNeeds: a.md\n"), entry("c.md", "# Gamma\n"), entry("d.sql", "select 1;\n")]) } },
};
const rows = ["a.md", "b.md", "c.md", "d.sql"].map(row);
const cfg = (order: string[]): BoardConfig => ({
  version: 1,
  ignore: [],
  ruleSets: {},
  projects: [{ id: "app", name: "App", path: "app", roots: [], ruleSets: [] }],
  groups: [{ name: "Launch", match: ["app/a.md", "app/b.md", "app/c.md", "app/d.sql"] }],
  order: { app: order },
});
const ctxFor = (c: BoardConfig) => ({ rows, projects: c.projects, categories: [] });
const run = (order: string[], path: string, to: unknown) => {
  const c = cfg(order);
  const model = buildBoard(c, rows, undefined, true, snap);
  const id = model.items.find((i) => i.path === path)!.id;
  return planDrop({ zone: "chain", id, to }, model, ctxFor(c));
};
const key = (p: ReturnType<typeof run>): string => (p.ok ? "ok" : p.key);
const stored = ["a.md", "b.md", "c.md", "d.sql"];

test("chain right makes the row wait on the row above; chain left makes the row above wait on it", () => {
  const r = run(stored, "c.md", 1);
  assert.ok(r.ok && r.kind === "waits" && r.from.path === "c.md" && r.onto.path === "b.md");
  const l = run(stored, "c.md", -1);
  assert.ok(l.ok && l.kind === "waits" && l.from.path === "b.md" && l.onto.path === "c.md");
});

test("the row above follows the stored order", () => {
  const r = run(["c.md", "a.md", "b.md", "d.sql"], "a.md", 1);
  assert.ok(r.ok && r.kind === "waits" && r.from.path === "a.md" && r.onto.path === "c.md");
});

test("chain refusals: first row, duplicate link, cycle, bad input", () => {
  assert.equal(key(run(stored, "a.md", 1)), "releaseBoard.reorder.firstSay");
  assert.equal(key(run(stored, "a.md", -1)), "releaseBoard.reorder.firstSay");
  assert.equal(key(run(stored, "b.md", 1)), "releaseBoard.drop.already");
  assert.equal(key(run(stored, "b.md", -1)), "releaseBoard.needs.circle");
  assert.equal(key(run(stored, "c.md", 2)), "releaseBoard.drop.gone");
  const c = cfg(stored);
  const model = buildBoard(c, rows, undefined, true, snap);
  assert.equal(key(planDrop({ zone: "chain", id: 999, to: 1 }, model, ctxFor(c))), "releaseBoard.drop.gone");
  const auto = buildBoard({ ...c, groups: [] }, rows, undefined, true, snap);
  assert.equal(key(planDrop({ zone: "chain", id: 0, to: 1 }, auto, ctxFor(c))), "releaseBoard.reorder.noGroup");
});

test("a document that cannot hold needs is refused", () => {
  const order = ["d.sql", "a.md", "b.md", "c.md"];
  assert.equal(key(run(order, "a.md", -1)), "releaseBoard.drop.noNeeds", "d.sql would hold the needs");
  assert.equal(key(run(order, "a.md", 1)), "ok");
});
