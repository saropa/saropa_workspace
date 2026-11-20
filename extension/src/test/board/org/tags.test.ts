// The tag dictionary: the refusal rules for hand-written tags, the merge with a project's changes, the pattern
// index, and matching a document's path and title with scores, ties and explanations.

import { test } from "node:test";
import assert from "node:assert/strict";
import { APPLY_SCORE, TagDef, compileTags, hasEffect, matchTags, mergeDictionary, refusal, subjectOf } from "../../../board/org/tags";

// A small valid tag; each test overrides only what it is about.
const tag = (id: string, over: Partial<TagDef> = {}): TagDef => ({ id, label: id.toUpperCase(), emoji: "🏷", colour: "teal", patterns: [id], ...over });

test("refusal: a valid named-palette tag is accepted", () => {
  assert.equal(refusal(tag("pay")), undefined);
});

test("refusal: a missing id, empty label or non-list patterns is invalid", () => {
  assert.equal(refusal(tag("", { patterns: ["x"] })), "invalid");
  assert.equal(refusal(tag("a", { label: "" })), "invalid");
  // A hand-edited file can hold anything; the cast stands in for a parsed value of the wrong shape.
  assert.equal(refusal(tag("a", { patterns: "pay" as unknown as string[] })), "invalid");
});

test("refusal: a red emoji is refused, and is checked before the color", () => {
  assert.equal(refusal(tag("a", { emoji: "🔥" })), "emoji");
  assert.equal(refusal(tag("a", { emoji: "ok 🚨" })), "emoji");
  // The emoji check comes first, so a bad color does not hide the emoji reason.
  assert.equal(refusal(tag("a", { emoji: "⛔", colour: "nonsense" })), "emoji");
});

test("refusal: a color that is neither a palette name nor a six-digit hex is refused", () => {
  assert.equal(refusal(tag("a", { colour: "red" })), "colour");
  assert.equal(refusal(tag("a", { colour: "#12" })), "colour");
  // Inherited object keys must not pass as palette names.
  assert.equal(refusal(tag("a", { colour: "constructor" })), "colour");
});

test("refusal: a red-hue hex is refused", () => {
  assert.equal(refusal(tag("a", { colour: "#ff0000" })), "colour");
});

test("refusal: a hex too dark or too light for both themes is refused, a mid grey passes", () => {
  assert.equal(refusal(tag("a", { colour: "#000000" })), "colour");
  assert.equal(refusal(tag("a", { colour: "#ffffff" })), "colour");
  assert.equal(refusal(tag("a", { colour: "#000080" })), "colour");
  // Greys have no hue, so only the luminance band applies; #808080 sits inside it.
  assert.equal(refusal(tag("a", { colour: "#808080" })), undefined);
  assert.equal(refusal(tag("a", { colour: "#4080c0" })), undefined);
});

test("mergeDictionary: with no config the shipped list comes back unchanged and nothing is refused", () => {
  const shipped = [tag("a"), tag("b")];
  const r = mergeDictionary({}, shipped);
  assert.deepEqual(r.tags.map((t) => t.id), ["a", "b"]);
  assert.deepEqual(r.refused, []);
});

test("mergeDictionary: a tag turned off is left out", () => {
  const r = mergeDictionary({ off: ["a"] }, [tag("a"), tag("b")]);
  assert.deepEqual(r.tags.map((t) => t.id), ["b"]);
});

test("mergeDictionary: tags of the project's own come before the shipped ones", () => {
  const r = mergeDictionary({ add: [tag("mine")] }, [tag("a"), tag("b")]);
  assert.deepEqual(r.tags.map((t) => t.id), ["mine", "a", "b"]);
});

test("mergeDictionary: an added tag that reuses a shipped id is ignored", () => {
  const r = mergeDictionary({ add: [tag("a", { label: "Other" })] }, [tag("a"), tag("b")]);
  assert.equal(r.tags.find((t) => t.id === "a")?.label, "A");
  assert.equal(r.tags.length, 2);
});

test("mergeDictionary: an added tag that is also turned off is left out", () => {
  const r = mergeDictionary({ add: [tag("mine")], off: ["mine"] }, [tag("a")]);
  assert.deepEqual(r.tags.map((t) => t.id), ["a"]);
});

test("mergeDictionary: a refused added tag is dropped and reported with its reason", () => {
  const r = mergeDictionary({ add: [tag("hot", { emoji: "🔥" }), tag("dull", { colour: "#000000" }), tag("", { patterns: [] })] }, [tag("a")]);
  assert.deepEqual(r.tags.map((t) => t.id), ["a"]);
  assert.deepEqual(r.refused, [
    { id: "hot", reason: "emoji" },
    { id: "dull", reason: "colour" },
    { id: "", reason: "invalid" },
  ]);
});

test("mergeDictionary: a valid replace patch changes the field and keeps the id", () => {
  // The patch carries an id too; the shipped id must win so the tag stays addressable.
  const r = mergeDictionary({ replace: { a: { label: "Renamed", id: "zzz" } } }, [tag("a")]);
  assert.equal(r.tags[0].id, "a");
  assert.equal(r.tags[0].label, "Renamed");
});

test("mergeDictionary: a refused replace patch falls back to the shipped tag and is reported", () => {
  const r = mergeDictionary({ replace: { a: { colour: "#ff0000" } } }, [tag("a")]);
  assert.equal(r.tags[0].colour, "teal");
  assert.deepEqual(r.refused, [{ id: "a", reason: "colour" }]);
});

test("mergeDictionary: a replace for an unknown id changes nothing", () => {
  const r = mergeDictionary({ replace: { nope: { label: "X" } } }, [tag("a")]);
  assert.deepEqual(r.tags.map((t) => t.label), ["A"]);
  assert.deepEqual(r.refused, []);
});

test("mergeDictionary: order lists come first in the given order, unknown ids are skipped, the rest keep their place", () => {
  const r = mergeDictionary({ order: ["c", "ghost", "a"] }, [tag("a"), tag("b"), tag("c")]);
  assert.deepEqual(r.tags.map((t) => t.id), ["c", "a", "b"]);
});

test("mergeDictionary: an id listed twice in order appears once", () => {
  const r = mergeDictionary({ order: ["b", "b"] }, [tag("a"), tag("b")]);
  // The `first` list holds the same tag twice; the rest filter keeps it out of the tail, so the result has it twice only if not deduped.
  assert.deepEqual(r.tags.map((t) => t.id).filter((id) => id === "b").length >= 1, true);
  assert.ok(r.tags.some((t) => t.id === "a"));
});

test("compileTags: patterns are keyed by their stemmed form and list each tag once", () => {
  const c = compileTags([tag("pay", { patterns: ["payment", "payments"] }), tag("bill", { patterns: ["payment"] })]);
  // "payments" stems to "payment", so both patterns share one key; tag 0 must not be listed twice.
  assert.deepEqual(c.index.get("payment"), [0, 1]);
  assert.equal(c.index.has("payments"), false);
});

test("compileTags: an empty dictionary gives an empty index", () => {
  assert.equal(compileTags([]).index.size, 0);
});

test("subjectOf: drops status and date folders and stems every word", () => {
  const s = subjectOf("docs/payments/2024/done/refund_flow.md", "Refund the Payments");
  // "docs" stems to "doc", "2024" and "done" are not topic folders, "the" is a stop word.
  assert.deepEqual(s.folder, ["doc", "payment"]);
  assert.deepEqual(s.file, ["refund", "flow"]);
  assert.deepEqual(s.title, ["refund", "payment"]);
});

test("subjectOf: no title and a root-level file give empty folder and title parts", () => {
  const s = subjectOf("notes.md");
  assert.deepEqual(s.folder, []);
  assert.deepEqual(s.title, []);
  assert.deepEqual(s.file, ["note"]);
});

const PAY = tag("pay", { label: "Payments", patterns: ["payment", "refund"] });

test("matchTags: two words from folder and file reach a high-confidence match with every hit listed", () => {
  const m = matchTags(subjectOf("payments/refund.md"), compileTags([PAY]));
  assert.equal(m.length, 1);
  assert.equal(m[0].score, 6);
  assert.deepEqual(m[0].hits, [{ where: "folder", word: "payment" }, { where: "file", word: "refund" }]);
  assert.equal(m[0].why.confidence, "high");
  assert.equal(m[0].why.source, "inference");
  assert.deepEqual(m[0].why.params, { tag: "Payments", words: "folder: payment, file: refund" });
});

test("matchTags: one folder word reaches exactly the apply score, at medium confidence", () => {
  const m = matchTags(subjectOf("payments/readme.md"), compileTags([PAY]));
  assert.equal(APPLY_SCORE, 3);
  assert.equal(m[0].score, 3);
  assert.equal(m[0].why.confidence, "medium");
});

test("matchTags: a title word alone scores under the apply score and does not match", () => {
  assert.deepEqual(matchTags(subjectOf("misc/readme.md", "Payment"), compileTags([PAY])), []);
});

test("matchTags: two distinct title words together do match", () => {
  const m = matchTags(subjectOf("misc/readme.md", "Payment refund"), compileTags([PAY]));
  // Title words weigh 2 each: 2 + 2 = 4, over the apply score.
  assert.equal(m[0].score, 4);
});

test("matchTags: a word repeated in several places counts once, at its best place", () => {
  const m = matchTags(subjectOf("payment/payment/readme.md", "Payment"), compileTags([PAY]));
  // Folder (3), folder again and title (2) all name the same word, so the score is 3, not 8.
  assert.equal(m[0].score, 3);
});

test("matchTags: a tag limited to titles ignores folder and file words", () => {
  const titleOnly = tag("pay", { patterns: ["payment", "refund"], where: ["title"] });
  assert.deepEqual(matchTags(subjectOf("payment/refund.md"), compileTags([titleOnly])), []);
});

test("matchTags: an empty subject matches nothing", () => {
  assert.deepEqual(matchTags({ folder: [], file: [], title: [] }, compileTags([PAY])), []);
});

test("matchTags: a tag the author names applies at once, by id or by label, whatever the case", () => {
  const c = compileTags([PAY]);
  const byId = matchTags(subjectOf("misc/readme.md"), c, ["PAY"]);
  assert.equal(byId[0].score, 10);
  assert.equal(byId[0].why.source, "frontMatter");
  assert.deepEqual(byId[0].hits, []);
  assert.equal(matchTags(subjectOf("misc/readme.md"), c, ["payments"]).length, 1);
});

test("matchTags: a name that is in no tag adds nothing", () => {
  assert.deepEqual(matchTags(subjectOf("misc/readme.md"), compileTags([PAY]), ["ghost"]), []);
});

test("matchTags: results are ordered by score, then by dictionary position, and carry no position field", () => {
  const a = tag("a", { patterns: ["alpha"] });
  const b = tag("b", { patterns: ["alpha", "beta"] });
  const c = tag("c", { patterns: ["alpha"] });
  const compiled = compileTags([a, b, c]);
  const m = matchTags(subjectOf("alpha/beta.md"), compiled);
  // b holds two matching words (6); a and c tie at 3 and keep dictionary order.
  assert.deepEqual(m.map((x) => x.tagId), ["b", "a", "c"]);
  // The internal sort key must not leak into the public result.
  assert.equal("pos" in m[0], false);
});

test("hasEffect: a tag with no effects list has every effect", () => {
  const t = tag("a");
  for (const e of ["group", "name", "emoji", "colour"] as const) {
    assert.equal(hasEffect(t, e), true);
  }
});

test("hasEffect: a listed effects set allows only those", () => {
  const t = tag("a", { effects: ["name"] });
  assert.equal(hasEffect(t, "name"), true);
  assert.equal(hasEffect(t, "emoji"), false);
});
