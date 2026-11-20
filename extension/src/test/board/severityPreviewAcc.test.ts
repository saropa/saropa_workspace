// The preview accumulator (severityPreview) driven in steps, and the list comparison the editor
// writer uses (severityDraft). severityEdit.test covers previewChanges in one call; this file covers
// the batch path the host takes (emptyPreview, addToPreview, finishPreview) and sameList.
// Pure; no host needed.

import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SEVERITY, SeverityDict } from "../../board/severity";
import { PreviewAcc, PreviewDoc, addToPreview, emptyPreview, finishPreview, previewChanges } from "../../board/severityPreview";
import { sameList } from "../../board/severityDraft";

// A dictionary where only "zzqq" counts, and it is extreme. The shipped title weight (3) meets the
// shipped threshold (3), so one "zzqq" in a title is enough; text without it scores medium.
const ZZ: SeverityDict = { ...DEFAULT_SEVERITY, phrases: { extreme: ["zzqq"], critical: [], high: [], low: [] } };

const raised: PreviewDoc = { title: "Raised", project: "app", path: "docs/raised.md", text: "zzqq", before: "medium" };
const eased: PreviewDoc = { title: "Eased", project: "app", path: "docs/eased.md", text: "plain words", before: "high" };
const same: PreviewDoc = { title: "Same", project: "app", path: "docs/same.md", text: "plain words", before: "medium" };

test("emptyPreview returns a fresh zeroed accumulator every call", () => {
  const a = emptyPreview();
  assert.deepEqual(a, { checked: 0, changed: 0, lowered: 0, raised: 0, eased: 0, tightened: 0, examples: [], all: [] });
  a.checked = 5;
  // deepEqual is an assertion function: it narrows `a` to the literal above, where `all` is never[].
  // The cast restores the declared accumulator type so the push type-checks.
  (a as PreviewAcc).all.push({ title: "x", project: "p", from: "low", to: "high", stopsFrom: false, stopsTo: true });
  // Mutating one run must never leak into the next.
  const b = emptyPreview();
  assert.equal(b.checked, 0);
  assert.equal(b.all.length, 0);
});

test("addToPreview counts every document and only the ones whose level changes", () => {
  const acc = emptyPreview();
  addToPreview(acc, [raised, eased, same], ZZ, "deliberate");
  assert.equal(acc.checked, 3);
  assert.equal(acc.changed, 2);
  // medium to extreme is a raise; high to medium is a lowering.
  assert.equal(acc.raised, 1);
  assert.equal(acc.lowered, 1);
  // Under "deliberate", high stops the release and medium does not.
  assert.equal(acc.tightened, 1);
  assert.equal(acc.eased, 1);
  assert.equal(acc.all.length, 2);
});

test("the profile decides what counts as eased or tightened", () => {
  // Under "rush" only extreme and critical stop: high to medium changes nothing about stopping.
  const acc = emptyPreview();
  addToPreview(acc, [eased], ZZ, "rush");
  assert.equal(acc.changed, 1);
  assert.equal(acc.eased, 0);
  assert.equal(acc.tightened, 0);
});

test("two batches add up to the same answer as one pass", () => {
  const acc = emptyPreview();
  addToPreview(acc, [raised], ZZ, "deliberate");
  addToPreview(acc, [eased, same], ZZ, "deliberate");
  assert.deepEqual(finishPreview(acc), previewChanges([raised, eased, same], ZZ, "deliberate"));
});

test("finishPreview puts documents that stop the release no longer first, and cuts at the limit", () => {
  const acc = emptyPreview();
  addToPreview(acc, [raised, eased], ZZ, "deliberate");
  const both = finishPreview(acc);
  assert.deepEqual(both.examples.map((e) => e.title), ["Eased", "Raised"]);
  const one = finishPreview(acc, 1);
  assert.deepEqual(one.examples.map((e) => e.title), ["Eased"]);
  // The counts still describe every changed document, not only the cut examples.
  assert.equal(one.changed, 2);
});

test("finishPreview hands back the result without the internal list of every change", () => {
  const acc = emptyPreview();
  addToPreview(acc, [raised], ZZ, "deliberate");
  assert.equal("all" in finishPreview(acc), false);
});

test("finishPreview breaks ties by the size of the jump, then by title", () => {
  const acc = emptyPreview();
  // Both raise without easing anything; the bigger jump (low to extreme) goes first.
  const big: PreviewDoc = { title: "Big", project: "app", path: "docs/big.md", text: "zzqq", before: "low" };
  const small: PreviewDoc = { title: "Small", project: "app", path: "docs/small.md", text: "zzqq", before: "high" };
  const alpha: PreviewDoc = { title: "Alpha", project: "app", path: "docs/alpha.md", text: "zzqq", before: "high" };
  addToPreview(acc, [small, big, alpha], ZZ, "deliberate");
  assert.deepEqual(finishPreview(acc).examples.map((e) => e.title), ["Big", "Alpha", "Small"]);
});

test("an empty document list previews as no change", () => {
  const r = previewChanges([], ZZ, "deliberate");
  assert.deepEqual(r, { checked: 0, changed: 0, lowered: 0, raised: 0, eased: 0, tightened: 0, examples: [] });
});

test("sameList ignores order, case and white space", () => {
  assert.equal(sameList(["a b", "c"], ["C", "a  b"]), true);
  assert.equal(sameList([], []), true);
});

test("sameList tells lists apart by length and by repeated entries", () => {
  assert.equal(sameList(["a"], ["a", "b"]), false);
  assert.equal(sameList(["a", "a"], ["a", "b"]), false);
  assert.equal(sameList(["a", "a"], ["a"]), false);
});
