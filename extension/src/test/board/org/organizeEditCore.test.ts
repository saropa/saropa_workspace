// Covers the shared base of the Tags and rules editor directly: the value checks every page value passes through,
// the row check and cleaner, the default draft, and editOrganize (the one function that edits a rules file text).
// organizeEdit.test.ts reaches these only through the higher-level save and import paths.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ACRONYM,
  COLOUR_NAMES,
  EFFECTS,
  ID,
  KIND_WORD,
  LIMITS,
  PHRASE,
  STATUS_WORD,
  TagRow,
  WHERES,
  cleanRow,
  defaultRow,
  defaultState,
  editOrganize,
  isStr,
  listProblem,
  rowProblem,
  strList,
  tagOfRow,
  DEFAULT_PREFIXES,
} from "../../../board/org/organizeEditCore";
import type { TagDef } from "../../../board/org/tags";

// A fresh copy of a shipped row, so each test edits its own.
const row = (): TagRow => structuredClone(defaultState().tags[0]);

test("isStr: accepts a string within the limit and refuses other types, long text and control characters", () => {
  assert.equal(isStr("abc", 3), true);
  assert.equal(isStr("abcd", 3), false);
  assert.equal(isStr(5, 3), false);
  assert.equal(isStr("a\u0007b", 10), false);
  assert.equal(isStr("a\u007fb", 10), false);
  assert.equal(isStr("a\tb", 10), false);
  assert.equal(isStr("", 10), true);
});

test("strList: accepts an array within the limit only", () => {
  assert.equal(strList([1, 2], 2), true);
  assert.equal(strList([1, 2, 3], 2), false);
  assert.equal(strList("ab", 5), false);
});

test("ID: lower-case slugs only", () => {
  assert.ok(ID.test("a-1"));
  assert.ok(!ID.test("-a"));
  assert.ok(!ID.test("A"));
  assert.ok(!ID.test("a b"));
});

test("PHRASE, ACRONYM, KIND_WORD and STATUS_WORD each hold their own shape", () => {
  assert.ok(PHRASE.test("waits on"));
  assert.ok(!PHRASE.test("a"));
  assert.ok(!PHRASE.test("Waits on"));
  assert.ok(ACRONYM.test("iOS"));
  assert.ok(!ACRONYM.test("1st"));
  assert.ok(KIND_WORD.test("plan"));
  assert.ok(!KIND_WORD.test("plan2"));
  assert.ok(STATUS_WORD.test("in-progress"));
  assert.ok(!STATUS_WORD.test("in--progress"));
  assert.ok(!STATUS_WORD.test("-wip"));
  assert.ok(!STATUS_WORD.test("wip-"));
});

test("defaultState: every shipped list fits the cap the save path enforces", () => {
  const s = defaultState();
  assert.ok(s.tags.length <= LIMITS.tags);
  assert.ok(s.naming.prefixes.length <= LIMITS.prefixes);
  assert.ok(s.naming.acronyms.length <= LIMITS.acronyms);
  assert.ok(s.inference.seqWords.length <= LIMITS.seqWords);
  assert.ok(s.inference.kinds.length <= LIMITS.kinds);
  assert.ok(s.inference.kindOrder.length <= LIMITS.kindOrder);
  assert.ok(s.folders.statusWords.length <= LIMITS.statusWords);
  assert.ok(s.folders.containerWords.length <= LIMITS.containerWords);
});

test("defaultState: shipped words pass the same word rules the save path applies", () => {
  const s = defaultState();
  assert.ok(s.inference.seqWords.every((w) => w.length <= LIMITS.seqWord && KIND_WORD.test(w)));
  assert.ok(s.inference.kinds.every((w) => w.length <= LIMITS.kind && KIND_WORD.test(w)));
  assert.ok(s.folders.statusWords.every((w) => w.length <= LIMITS.statusWord && STATUS_WORD.test(w)));
  assert.ok(s.folders.containerWords.every((w) => w.length <= LIMITS.containerWord && KIND_WORD.test(w)));
});

test("defaultState: the kind order only names kinds that exist", () => {
  const s = defaultState();
  assert.ok(s.inference.kindOrder.every((k) => s.inference.kinds.includes(k)));
});

test("defaultState: editing a draft never changes the shipped lists or the next draft", () => {
  const a = defaultState();
  a.tags[0].patterns.push("zzz");
  a.naming.prefixes.push("zzz");
  a.inference.kinds.push("zzz");
  const b = defaultState();
  assert.ok(!b.tags[0].patterns.includes("zzz"));
  assert.ok(!b.naming.prefixes.includes("zzz"));
  assert.ok(!b.inference.kinds.includes("zzz"));
  assert.ok(!DEFAULT_PREFIXES.includes("zzz"));
});

test("defaultRow: a tag with no effects gets every effect, as its own array", () => {
  const t: TagDef = { id: "t", label: "T", emoji: "", colour: COLOUR_NAMES[0], patterns: ["x"] };
  const r = defaultRow(t);
  assert.deepEqual(r.effects, [...EFFECTS]);
  assert.notEqual(r.effects, EFFECTS);
  assert.equal(r.off, false);
  assert.equal("where" in r, false);
});

test("defaultRow and tagOfRow: where is kept only when the tag has it, and off is dropped", () => {
  const t: TagDef = { id: "t", label: "T", emoji: "", colour: COLOUR_NAMES[0], patterns: ["x"], where: ["file"] };
  const r = defaultRow(t);
  assert.deepEqual(r.where, ["file"]);
  const back = tagOfRow(r);
  assert.equal("off" in back, false);
  assert.deepEqual(back.where, ["file"]);
  assert.equal("where" in tagOfRow(defaultRow({ ...t, where: undefined })), false);
});

test("rowProblem: every shipped row passes its own check", () => {
  assert.deepEqual(defaultState().tags.map((r) => rowProblem(r)).filter((p) => p !== undefined), []);
});

test("rowProblem: a value that is not an object is a shape problem", () => {
  assert.equal(rowProblem(null), "shape");
  assert.equal(rowProblem(5), "shape");
  assert.equal(rowProblem([]), "shape");
});

test("rowProblem: names the first field that is wrong", () => {
  const bad = (edit: (r: TagRow) => void): string | undefined => {
    const r = row();
    edit(r);
    return rowProblem(r);
  };
  assert.equal(bad((r) => (r.id = "Bad Id")), "id");
  assert.equal(bad((r) => (r.label = "   ")), "label");
  assert.equal(bad((r) => (r.emoji = "x".repeat(LIMITS.emoji + 1))), "emoji");
  assert.equal(bad((r) => (r.colour = "#12345678")), "colour");
  assert.equal(bad((r) => (r.patterns = ["has space"])), "patterns");
  assert.equal(bad((r) => (r.patterns = Array.from({ length: LIMITS.patterns + 1 }, (_, i) => `w${i}`))), "patterns");
  assert.equal(bad((r) => (r.effects = ["bogus" as never])), "effects");
  assert.equal(bad((r) => (r.off = "no" as never)), "effects");
  assert.equal(bad((r) => (r.where = [])), "where");
  assert.equal(bad((r) => (r.where = ["nowhere" as never])), "where");
  assert.equal(bad((r) => (r.where = [...WHERES, "file"])), "where");
});

test("rowProblem: a red emoji is refused by the dictionary rules", () => {
  const r = row();
  r.emoji = "\u{1F525}";
  assert.equal(rowProblem(r), "emoji");
});

test("cleanRow: trims the label, lower-cases and dedupes patterns, orders effects and places", () => {
  const r: TagRow = { ...row(), label: "  Auth  ", patterns: ["Login", "login", "Token"], effects: ["colour", "group"], where: ["title", "folder"] };
  const c = cleanRow(r);
  assert.equal(c.label, "Auth");
  assert.deepEqual(c.patterns, ["login", "token"]);
  assert.deepEqual(c.effects, ["group", "colour"]);
  assert.deepEqual(c.where, ["folder", "title"]);
});

test("cleanRow: a hex colour is lower-cased and a named colour is left alone; an empty where is dropped", () => {
  assert.equal(cleanRow({ ...row(), colour: "#ABCDEF" }).colour, "#abcdef");
  assert.equal(cleanRow({ ...row(), colour: COLOUR_NAMES[0] }).colour, COLOUR_NAMES[0]);
  assert.equal("where" in cleanRow({ ...row(), where: [] }), false);
});

test("listProblem: true only for a short enough list of in-limit strings that all pass the check", () => {
  const word = (s: string): boolean => KIND_WORD.test(s);
  assert.equal(listProblem(["a", "b"], 2, 5, word), true);
  assert.equal(listProblem(["a", "b", "c"], 2, 5, word), false);
  assert.equal(listProblem(["abcdef"], 2, 5, word), false);
  assert.equal(listProblem(["A"], 2, 5, word), false);
  assert.equal(listProblem("a", 2, 5, word), false);
  assert.equal(listProblem([1], 2, 5, word), false);
});

test("editOrganize: a missing file is made and the organize object written", () => {
  const out = editOrganize(undefined, (org) => {
    org.naming = { dates: false };
    return true;
  });
  assert.ok(out.ok);
  if (out.ok) {
    assert.equal(out.changed, true);
    assert.deepEqual(JSON.parse(out.text).organize, { naming: { dates: false } });
  }
});

test("editOrganize: an edit that changes nothing reports no change and keeps the text as it was", () => {
  const text = '{ "version": 1, "organize": {"a":1} }';
  assert.deepEqual(editOrganize(text, () => true), { ok: true, text, changed: false });
  assert.deepEqual(editOrganize(undefined, () => true), { ok: true, text: "", changed: false });
});

test("editOrganize: emptying the organize object removes it and leaves other keys alone", () => {
  const out = editOrganize('{"version":1,"organize":{"a":1},"other":2}', (org) => {
    delete org.a;
    return true;
  });
  assert.ok(out.ok);
  if (out.ok) {
    const doc = JSON.parse(out.text);
    assert.equal(out.changed, true);
    assert.equal("organize" in doc, false);
    assert.equal(doc.other, 2);
  }
});

test("editOrganize: a refusal from the callback is a shape refusal", () => {
  assert.deepEqual(editOrganize(undefined, () => false), { ok: false, reason: "shape" });
});

test("editOrganize: a file that does not parse, or whose organize is not an object, is refused", () => {
  assert.deepEqual(editOrganize("{ nope", () => true), { ok: false, reason: "parse" });
  assert.deepEqual(editOrganize('{"version":1,"organize":5}', () => true), { ok: false, reason: "shape" });
});
