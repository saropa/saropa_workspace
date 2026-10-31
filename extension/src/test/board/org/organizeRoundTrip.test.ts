// Round trip of the Tags editor state: loadOrganize reads an `organize` key, organizeFromState stores it back.
// Edited, partly unusable and default keys give the expected stored form, and what is stored loads back equal.

import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_TAGS } from "../../../board/org/tags";
import { defaultState, loadOrganize, organizeFromState } from "../../../board/org/organizeEdit";

const first = DEFAULT_TAGS[0].id;
const second = DEFAULT_TAGS[1].id;
const edited = { tags: { replace: { [first]: { label: "Money", where: ["title"] } }, off: [second], add: [{ id: "mobile", label: "Mobile", emoji: "📱", colour: "teal", patterns: ["ios"], effects: ["group", "name"] }] }, linkWords: { off: ["after"], add: ["held up by"] }, naming: { dates: false, prefixes: ["plan", "spec"] } };
const hostile = { tags: { add: [{ id: "bad", label: "Bad", colour: "#ff0000", patterns: ["x"] }, 5], replace: { nope: { label: "X" } }, off: ["zzz"] }, linkWords: { off: ["unknown"] }, naming: { dates: "no" } };

test("an edited key loads, stores and loads back to the same state", () => {
  const l = loadOrganize(edited);
  assert.deepEqual(l.lossy, []);
  const stored = organizeFromState(l.state);
  assert.equal(stored.tags?.replace?.[first]?.label, "Money");
  assert.deepEqual(stored.tags?.replace?.[first]?.where, ["title"]);
  assert.deepEqual(stored.tags?.off, [second]);
  assert.equal(stored.tags?.add?.[0].id, "mobile");
  assert.equal(stored.tags?.order, undefined);
  assert.deepEqual(stored.linkWords, { off: ["after"], add: ["held up by"] });
  assert.deepEqual(stored.naming, { dates: false, prefixes: ["plan", "spec"] });
  assert.deepEqual(loadOrganize(JSON.parse(JSON.stringify(stored))).state, l.state);
});

test("a key with unusable values drops them, names the parts, and stores nothing", () => {
  const l = loadOrganize(hostile);
  assert.deepEqual([...l.lossy].sort(), ["linkWords", "naming", "tags"]);
  assert.deepEqual(l.state.tags.map((r) => r.id).includes("bad"), false);
  assert.deepEqual(organizeFromState(l.state), {});
});

test("anything that is not an object, and the empty key, give the default state", () => {
  assert.deepEqual(loadOrganize("text"), { state: defaultState(), lossy: [] });
  assert.deepEqual(loadOrganize({}).state, defaultState());
  assert.deepEqual(organizeFromState(defaultState()), {});
});
