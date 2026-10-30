// The `organize` key of the rules file reaches the board: tags, naming and hand-made overrides, a Save without a document change, and hostile shapes.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildBoard } from "../../board/boardModel";
import { overridesOf } from "../../board/org/settings";
import { BoardConfig, Classified } from "../../board/types";

const base: BoardConfig = { version: 1, ignore: [], ruleSets: {}, projects: [{ id: "app", name: "App", path: "app", roots: [], ruleSets: [] }] };
const row = (path: string): Classified => ({ project: "app", path, status: "amber", kind: "", note: "" });
const rows = ["a", "b", "c", "d", "e", "f"].map((n) => row(`docs/zebra/${n}.md`));
const groupOf = (cfg: BoardConfig) => buildBoard(cfg, rows, undefined, true).items.find((i) => i.path === "docs/zebra/a.md")!.group;
const tag = (emoji: string, colour: string): BoardConfig => ({ ...base, organize: { tags: { add: [{ id: "stripes", label: "Stripes", emoji, colour, patterns: ["zebra"] }] } } });

test("a custom tag changes the group, emoji and colour on the board", () => {
  const before = groupOf(base)!;
  const after = groupOf(tag("🦓", "orchid"))!;
  assert.equal(after.emoji, "🦓");
  assert.notEqual(after.emoji, before.emoji);
  assert.equal(after.colour, "#9b5bbf");
  assert.notEqual(before.colour, after.colour);
});

test("a Save invalidates the cache without a document change", () => {
  assert.equal(groupOf(tag("🦓", "orchid"))!.emoji, "🦓");
  assert.equal(groupOf(tag("🐴", "orchid"))!.emoji, "🐴");
  assert.equal(groupOf(tag("🦓", "orchid"))!.emoji, "🦓");
});

test("a group colour override needs an allowed colour name", () => {
  const g = groupOf(tag("🦓", "orchid"))!;
  assert.deepEqual(overridesOf({ groups: { [g.id]: { colour: "#ff0000" } } }).groups, {});
  assert.deepEqual(overridesOf({ groups: { [g.id]: { colour: "teal" } } }).groups, { [g.id]: { colour: "teal" } });
  assert.deepEqual(overridesOf({ groups: { [g.id]: { name: "Zebras" } } }).groups, { [g.id]: { name: "Zebras" } });
});

test("hostile organize shapes never throw", () => {
  const shapes: unknown[] = [
    null, 5, "x", [], { untag: [{ tag: 5 }] }, { untag: [null, 3, { project: "app", path: "a.md", tag: {} }] }, { assign: [null] },
    { assign: [{ project: 1, path: [], group: {} }] }, { groups: [] }, { groups: { "__proto__": { name: "x" }, "bad id": 5, "app:folder:x": null } },
    { tags: "x" }, { tags: { add: [null, 5, { id: 5 }], off: "x" } }, { linkWords: 5, naming: [] }, { untag: "x", assign: {} },
  ];
  for (const organize of shapes) {
    assert.doesNotThrow(() => overridesOf(organize));
    assert.doesNotThrow(() => buildBoard({ ...base, organize }, rows, undefined, true));
  }
});
