// The look of a group: the allowed color names, which tag wins a group, the emoji explanation, and stable
// distinct colors among siblings.

import { test } from "node:test";
import assert from "node:assert/strict";
import { COLOUR_HEX, assignColours, emojiWhy, isAllowedColour, pickGroupTag } from "../../../board/org/appearance";
import { TagDef, compileTags } from "../../../board/org/tags";
import type { TagMatch } from "../../../board/org/orgTypes";

const def = (id: string, over: Partial<TagDef> = {}): TagDef => ({ id, label: id.toUpperCase(), emoji: "🏷", colour: "teal", patterns: [id], ...over });

// A match of one tag by one word; the explanation is not what these tests are about.
const match = (tagId: string, word: string): TagMatch => ({ tagId, score: 3, hits: [{ where: "file", word }], why: { key: "k", params: {}, source: "inference", confidence: "medium" } });

test("isAllowedColour: accepts every palette name and refuses others", () => {
  for (const name of Object.keys(COLOUR_HEX)) {
    assert.equal(isAllowedColour(name), true, name);
  }
  assert.equal(isAllowedColour("red"), false);
  assert.equal(isAllowedColour(""), false);
});

test("isAllowedColour: inherited object keys never pass", () => {
  assert.equal(isAllowedColour("constructor"), false);
  assert.equal(isAllowedColour("toString"), false);
  assert.equal(isAllowedColour("__proto__"), false);
});

test("palette: eight six-digit hex values, none repeated", () => {
  const values = Object.values(COLOUR_HEX);
  assert.equal(values.length, 8);
  assert.equal(new Set(values).size, 8);
  for (const v of values) {
    assert.match(v, /^#[0-9a-f]{6}$/);
  }
});

test("pickGroupTag: a tag on at least half the members wins, with its count and top word", () => {
  const c = compileTags([def("pay"), def("auth")]);
  const members = [[match("pay", "payment")], [match("pay", "payment")], [match("auth", "login")]];
  const g = pickGroupTag(members, [], c);
  assert.equal(g?.tag.id, "pay");
  assert.equal(g?.count, 2);
  assert.equal(g?.total, 3);
  assert.equal(g?.word, "payment");
});

test("pickGroupTag: a tag on fewer than half the members does not win", () => {
  const c = compileTags([def("pay")]);
  const g = pickGroupTag([[match("pay", "pay")], [], [], []], [], c);
  assert.equal(g, undefined);
});

test("pickGroupTag: with no member match, the tag of the group's name is used and count is zero", () => {
  const c = compileTags([def("pay")]);
  const g = pickGroupTag([[], []], [match("pay", "payments")], c);
  assert.equal(g?.tag.id, "pay");
  assert.equal(g?.count, 0);
  assert.equal(g?.word, "payments");
});

test("pickGroupTag: no members and no name match is undefined", () => {
  assert.equal(pickGroupTag([], [], compileTags([def("pay")])), undefined);
});

test("pickGroupTag: equal counts go to the tag listed first in the dictionary", () => {
  const c = compileTags([def("first"), def("second")]);
  const g = pickGroupTag([[match("second", "b"), match("first", "a")]], [], c);
  assert.equal(g?.tag.id, "first");
});

test("pickGroupTag: the top word is the most common, ties broken alphabetically", () => {
  const c = compileTags([def("pay")]);
  const g = pickGroupTag([[match("pay", "zeta")], [match("pay", "alpha")]], [], c);
  assert.equal(g?.word, "alpha");
});

test("emojiWhy: no tag gives the fallback emoji at low confidence", () => {
  const r = emojiWhy(undefined, "📁");
  assert.equal(r.emoji, "📁");
  assert.equal(r.why.confidence, "low");
  assert.equal(r.why.key, "releaseBoard.org.emoji.default");
});

test("emojiWhy: a tag gives its emoji and the counts at medium confidence", () => {
  const r = emojiWhy({ tag: def("pay", { emoji: "💳" }), count: 2, total: 3, word: "pay" }, "📁");
  assert.equal(r.emoji, "💳");
  assert.equal(r.why.confidence, "medium");
  assert.deepEqual(r.why.params, { emoji: "💳", tag: "PAY", word: "pay", count: 2, total: 3 });
});

test("assignColours: a tag's color is kept as given, with the tag label in the explanation", () => {
  const out = assignColours([{ id: "a", parent: "p", tagColour: "#123456", tagLabel: "Pay" }]);
  assert.equal(out.get("a")?.colour, "#123456");
  assert.equal(out.get("a")?.why.key, "releaseBoard.org.colour.tag");
  assert.deepEqual(out.get("a")?.why.params, { tag: "Pay" });
});

test("assignColours: siblings without a tag color get distinct palette names", () => {
  const groups = ["a", "b", "c", "d", "e", "f", "g", "h"].map((id) => ({ id, parent: "p" }));
  const out = assignColours(groups);
  const colours = groups.map((g) => out.get(g.id)?.colour);
  assert.equal(new Set(colours).size, 8);
  for (const c of colours) {
    assert.equal(isAllowedColour(c ?? ""), true);
  }
});

test("assignColours: the result does not depend on input order", () => {
  const a = assignColours([{ id: "x", parent: "p" }, { id: "y", parent: "p" }]);
  const b = assignColours([{ id: "y", parent: "p" }, { id: "x", parent: "p" }]);
  assert.equal(a.get("x")?.colour, b.get("x")?.colour);
  assert.equal(a.get("y")?.colour, b.get("y")?.colour);
});

test("assignColours: a sibling's tag color is not reused by an untagged group", () => {
  const out = assignColours([{ id: "t", parent: "p", tagColour: "teal" }, ...["a", "b", "c", "d", "e", "f", "g"].map((id) => ({ id, parent: "p" }))]);
  const untagged = ["a", "b", "c", "d", "e", "f", "g"].map((id) => out.get(id)?.colour);
  assert.equal(untagged.includes("teal"), false);
});

test("assignColours: the same id gets the same color in separate runs, and automatic ones are low confidence", () => {
  const one = assignColours([{ id: "docs", parent: "p" }]).get("docs");
  const two = assignColours([{ id: "docs", parent: "p" }]).get("docs");
  assert.equal(one?.colour, two?.colour);
  assert.equal(one?.why.confidence, "low");
});

test("assignColours: an empty list gives an empty map", () => {
  assert.equal(assignColours([]).size, 0);
});
