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

test("inference constants round-trip through store and load", () => {
  // Custom sequence words, kinds and kind order store only what differs from defaults.
  const org = { inference: { seqWords: ["chapter", "step"], kinds: ["spec", "plan", "readme"], kindOrder: ["plan", "spec"] } };
  const l = loadOrganize(org);
  assert.deepEqual(l.lossy, []);
  assert.deepEqual(l.state.inference.seqWords, ["chapter", "step"]);
  assert.deepEqual(l.state.inference.kinds, ["spec", "plan", "readme"]);
  assert.deepEqual(l.state.inference.kindOrder, ["plan", "spec"]);
  const stored = organizeFromState(l.state);
  assert.deepEqual(stored.inference?.seqWords, ["chapter", "step"]);
  assert.deepEqual(stored.inference?.kinds, ["spec", "plan", "readme"]);
  assert.deepEqual(stored.inference?.kindOrder, ["plan", "spec"]);
  // Load back produces the same state.
  assert.deepEqual(loadOrganize(JSON.parse(JSON.stringify(stored))).state, l.state);
});

test("folders constants round-trip through store and load", () => {
  // Custom status and container words store only what differs from defaults.
  const org = { folders: { statusWords: ["wip", "done"], containerWords: ["shared"] } };
  const l = loadOrganize(org);
  assert.deepEqual(l.lossy, []);
  assert.deepEqual(l.state.folders.statusWords, ["wip", "done"]);
  assert.deepEqual(l.state.folders.containerWords, ["shared"]);
  const stored = organizeFromState(l.state);
  assert.deepEqual(stored.folders?.statusWords, ["wip", "done"]);
  assert.deepEqual(stored.folders?.containerWords, ["shared"]);
  assert.deepEqual(loadOrganize(JSON.parse(JSON.stringify(stored))).state, l.state);
});

test("inference and folders at default values store nothing", () => {
  // When the user hasn't changed inference or folders, nothing is stored.
  const s = defaultState();
  const stored = organizeFromState(s);
  assert.equal(stored.inference, undefined);
  assert.equal(stored.folders, undefined);
});

test("anything that is not an object, and the empty key, give the default state", () => {
  assert.deepEqual(loadOrganize("text"), { state: defaultState(), lossy: [] });
  assert.deepEqual(loadOrganize({}).state, defaultState());
  assert.deepEqual(organizeFromState(defaultState()), {});
});
