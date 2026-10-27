// Contexts: the phrase dictionary, merging a team's changes, time hints and what can be done.

import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_NEEDS, canDo, matchNeeds, mergeNeeds, stepMinutes, stepNeeds, timeHint } from "../../board/needs";

test("a phrase names the contexts that can satisfy it", () => {
  assert.deepEqual(matchNeeds("Upload to TestFlight"), [["iphone", "mac"]]);
  assert.deepEqual(matchNeeds("check logcat output"), [["android"]]);
  assert.deepEqual(matchNeeds("write the changelog"), []);
});

test("a phrase counts only as whole words", () => {
  assert.deepEqual(matchNeeds("the machine room"), [], "mac is not in machine");
  assert.deepEqual(matchNeeds("on a mac."), [["mac"]]);
});

test("phrases joined by or form one group; phrases side by side form two", () => {
  assert.deepEqual(matchNeeds("test on iPhone or Android"), [["android", "iphone"]], "the group is sorted");
  assert.equal(matchNeeds("iPhone and Android").length, 2);
});

test("a group that contains a smaller group is dropped", () => {
  assert.deepEqual(matchNeeds("open xcode on the iphone"), [["iphone"]]);
});

test("a step reads its Needs cell first, then its own text, then its heading", () => {
  assert.deepEqual(stepNeeds({ text: "run adb", heading: "On the Mac", needsCell: "Play Console" }), [["play"]]);
  assert.deepEqual(stepNeeds({ text: "run adb", heading: "On the Mac", needsCell: "nothing special" }), [["android"]]);
  assert.deepEqual(stepNeeds({ text: "tidy up", heading: "On the Mac" }), [["mac"]]);
  assert.deepEqual(stepNeeds({ text: "tidy up", heading: "Cleanup" }), []);
});

test("time hints read minutes and hours", () => {
  assert.equal(timeHint("about 30 min"), 30);
  assert.equal(timeHint("a 4-minute wait"), 4);
  assert.equal(timeHint("1.5 hours"), 90);
  assert.equal(timeHint("no time here"), undefined);
});

test("minutes: the step's hint, else the longest of the quickest contexts, else the default", () => {
  assert.equal(stepMinutes("takes 20 minutes", [["mac"]]), 20);
  assert.equal(stepMinutes("go", [["mac"], ["supabase"]]), 15);
  assert.equal(stepMinutes("go", [["mac", "supabase"]]), 5, "the quickest context that can satisfy the group");
  assert.equal(stepMinutes("go", []), DEFAULT_NEEDS.defaultMinutes);
});

test("a step can be done when every group has a context in hand", () => {
  assert.equal(canDo([], new Set()), true);
  assert.equal(canDo([["iphone", "mac"]], new Set(["mac"])), true);
  assert.equal(canDo([["iphone"], ["mac"]], new Set(["mac"])), false);
});

test("merging adds and replaces contexts and phrases, and ignores bad input", () => {
  assert.equal(mergeNeeds(undefined), DEFAULT_NEEDS);
  assert.equal(mergeNeeds("nope" as never), DEFAULT_NEEDS);
  const d = mergeNeeds({
    defaultMinutes: 12,
    contexts: [{ id: "mac", label: "Mac mini", minutes: 3 }, { id: "nas", label: "NAS" }, { id: 5 } as never],
    phrases: { Backup: ["nas"], xcode: [], "": ["nas"] },
  });
  assert.equal(d.defaultMinutes, 12);
  assert.equal(d.contexts.find((c) => c.id === "mac")?.label, "Mac mini");
  assert.equal(d.contexts.find((c) => c.id === "mac")?.minutes, 3);
  assert.ok(d.contexts.some((c) => c.id === "nas"));
  assert.equal(d.contexts.length, DEFAULT_NEEDS.contexts.length + 1);
  assert.deepEqual(d.phrases.backup, ["nas"], "phrases are stored in lower case");
  assert.deepEqual(d.phrases.xcode, [], "an empty list switches a shipped phrase off");
  assert.equal("" in d.phrases, false);
  assert.deepEqual(matchNeeds("open xcode", d), []);
  assert.deepEqual(matchNeeds("run the backup", d), [["nas"]]);
});

test("context ids the dictionary does not know are dropped from a match", () => {
  const d = mergeNeeds({ phrases: { widget: ["ghost"] } });
  assert.deepEqual(matchNeeds("a widget", d), []);
});
