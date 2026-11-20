// Engine-ready settings from the rules file's `organize` key: the tag dictionary, the "waits on" phrases and the
// naming rules (settingsOf), the hand-made overrides (overridesOf), and the tags that match a set of documents.

import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_ACRONYMS, DEFAULT_CONTAINER_WORDS, DEFAULT_KINDS, DEFAULT_KIND_ORDER, DEFAULT_LINK_PHRASES, DEFAULT_PREFIXES, DEFAULT_SEQ_WORDS, DEFAULT_STATUS_WORDS } from "../../../board/org/organizeEdit";
import { matchedTagIds, overridesOf, settingsOf } from "../../../board/org/settings";
import { DEFAULT_TAGS } from "../../../board/org/tags";

test("settingsOf: no organize key gives every shipped tag, phrase and naming default", () => {
  const s = settingsOf(undefined);
  assert.deepEqual(s.tags.map((t) => t.id), DEFAULT_TAGS.map((t) => t.id));
  assert.deepEqual(s.linkPhrases, [...DEFAULT_LINK_PHRASES]);
  assert.equal(s.naming.dates, true);
  assert.deepEqual([...(s.naming.prefixes ?? [])].sort(), [...DEFAULT_PREFIXES].sort());
  assert.deepEqual(s.naming.acronyms, [...DEFAULT_ACRONYMS]);
});

test("settingsOf: tags are plain definitions, without the page-only off flag", () => {
  assert.equal("off" in settingsOf(undefined).tags[0], false);
});

test("settingsOf: a value that is not an object gives the defaults", () => {
  for (const bad of [null, "text", 42, [], true]) {
    assert.equal(settingsOf(bad).tags.length, DEFAULT_TAGS.length);
    assert.equal(settingsOf(bad).naming.dates, true);
  }
});

test("settingsOf: a tag turned off is left out of the dictionary", () => {
  const first = DEFAULT_TAGS[0].id;
  const ids = settingsOf({ tags: { off: [first] } }).tags.map((t) => t.id);
  assert.equal(ids.includes(first), false);
  assert.equal(ids.length, DEFAULT_TAGS.length - 1);
});

test("settingsOf: the order list puts those tags first", () => {
  const last = DEFAULT_TAGS[DEFAULT_TAGS.length - 1].id;
  assert.equal(settingsOf({ tags: { order: [last] } }).tags[0].id, last);
});

test("settingsOf: a phrase turned off is dropped and a phrase of your own is added after the shipped ones", () => {
  const p = settingsOf({ linkWords: { off: ["needs"], add: ["gated by"] } }).linkPhrases;
  assert.equal(p.includes("needs"), false);
  assert.equal(p[p.length - 1], "gated by");
  assert.equal(p.length, DEFAULT_LINK_PHRASES.length);
});

test("settingsOf: an unusable phrase list falls back to the shipped phrases instead of throwing", () => {
  // "bogus" is not a shipped phrase and "Gated By" is not lower case, so each list fails its check as a whole.
  const p = settingsOf({ linkWords: { off: ["bogus"], add: ["Gated By"] } }).linkPhrases;
  assert.deepEqual(p, [...DEFAULT_LINK_PHRASES]);
});

test("settingsOf: naming values are read, with prefixes as a set", () => {
  const n = settingsOf({ naming: { dates: false, prefixes: ["plan", "spec"], acronyms: ["API", "Foo"] } }).naming;
  assert.equal(n.dates, false);
  assert.deepEqual([...(n.prefixes ?? [])], ["plan", "spec"]);
  assert.deepEqual(n.acronyms, ["API", "Foo"]);
});

test("settingsOf: acronyms that differ only by case are kept once", () => {
  assert.equal(settingsOf({ naming: { acronyms: ["API", "api"] } }).naming.acronyms?.length, 1);
});

test("settingsOf: a naming value of the wrong kind keeps its default", () => {
  const n = settingsOf({ naming: { dates: "yes", prefixes: ["Plan"] } }).naming;
  assert.equal(n.dates, true);
  // An upper-case prefix fails the word check, so the whole list is ignored.
  assert.deepEqual([...(n.prefixes ?? [])].sort(), [...DEFAULT_PREFIXES].sort());
});

test("settingsOf: no organize key gives shipped inference and folder constants", () => {
  const s = settingsOf(undefined);
  assert.deepEqual(s.seqWords, [...DEFAULT_SEQ_WORDS]);
  assert.deepEqual(s.kinds, [...DEFAULT_KINDS]);
  assert.deepEqual(s.kindOrder, [...DEFAULT_KIND_ORDER]);
  assert.deepEqual([...s.statusWords].sort(), [...DEFAULT_STATUS_WORDS].sort());
  assert.deepEqual([...s.containerWords].sort(), [...DEFAULT_CONTAINER_WORDS].sort());
});

test("settingsOf: custom inference constants are threaded through", () => {
  // A rules file with custom sequence words and kinds exposes them in the settings.
  const s = settingsOf({ inference: { seqWords: ["chapter"], kinds: ["spec"], kindOrder: ["spec"] } });
  assert.deepEqual(s.seqWords, ["chapter"]);
  assert.deepEqual(s.kinds, ["spec"]);
  assert.deepEqual(s.kindOrder, ["spec"]);
});

test("settingsOf: custom folder constants are threaded through as sets", () => {
  // A rules file with custom status and container words produces the right sets.
  const s = settingsOf({ folders: { statusWords: ["wip"], containerWords: ["shared"] } });
  assert.ok(s.statusWords.has("wip"));
  assert.equal(s.statusWords.size, 1);
  assert.ok(s.containerWords.has("shared"));
  assert.equal(s.containerWords.size, 1);
});

const empty = { groups: {}, assign: [], untag: [] };

test("overridesOf: a value that is not an object gives no overrides", () => {
  assert.deepEqual(overridesOf(undefined), empty);
  assert.deepEqual(overridesOf("x"), empty);
  assert.deepEqual(overridesOf([]), empty);
});

test("overridesOf: a group entry is kept with its name trimmed", () => {
  const r = overridesOf({ groups: { "app:folder:docs": { name: "  Docs  ", emoji: "📄" } } });
  assert.deepEqual(r.groups, { "app:folder:docs": { name: "Docs", emoji: "📄" } });
});

test("overridesOf: group entries with a bad id, an empty body or an unusable value are dropped", () => {
  const r = overridesOf({
    groups: {
      "no-colons": { name: "A" },
      "app: folder:x": { name: "B" },
      "app:folder:empty": {},
      "app:folder:blank": { name: "   " },
      "app:folder:long": { name: "x".repeat(61) },
      "app:folder:ok": { name: "Fine" },
    },
  });
  // One bad line must not hide the good ones.
  assert.deepEqual(Object.keys(r.groups ?? {}), ["app:folder:ok"]);
});

test("overridesOf: a groups key that is not an object is ignored", () => {
  assert.deepEqual(overridesOf({ groups: [1, 2] }).groups, {});
  assert.deepEqual(overridesOf({ groups: "x" }).groups, {});
});

test("overridesOf: an assign entry keeps only project, path and group", () => {
  const r = overridesOf({ assign: [{ project: "app", path: "a.md", group: "app:folder:docs", extra: 1 }] });
  assert.deepEqual(r.assign, [{ project: "app", path: "a.md", group: "app:folder:docs" }]);
});

test("overridesOf: assign entries with a bad group, an empty path or the wrong shape are dropped", () => {
  const r = overridesOf({
    assign: [
      { project: "app", path: "a.md", group: "nope" },
      { project: "app", path: "", group: "app:folder:docs" },
      { project: "", path: "b.md", group: "app:folder:docs" },
      { path: "c.md", group: "app:folder:docs" },
      "text",
      null,
      { project: "app", path: "ok.md", group: "app:folder:docs" },
    ],
  });
  assert.deepEqual(r.assign?.map((a) => a.path), ["ok.md"]);
});

test("overridesOf: an assign or untag key that is not a list gives an empty list", () => {
  const r = overridesOf({ assign: { a: 1 }, untag: "x" });
  assert.deepEqual(r.assign, []);
  assert.deepEqual(r.untag, []);
});

test("overridesOf: an untag entry keeps a lower-case slug tag and drops others", () => {
  const r = overridesOf({
    untag: [
      { project: "app", path: "a.md", tag: "bugs" },
      { project: "app", path: "a.md", tag: "Bad Tag" },
      { project: "app", path: "a.md", tag: "t".repeat(41) },
      { project: "app", path: "a.md", tag: 5 },
      { project: "app", path: "a.md" },
    ],
  });
  // The id cap is 40, so 41 characters is refused even though every character is valid.
  assert.deepEqual(r.untag, [{ project: "app", path: "a.md", tag: "bugs" }]);
});

const TAGS = settingsOf(undefined).tags;

test("matchedTagIds: no documents or no tags match nothing", () => {
  assert.deepEqual(matchedTagIds([], TAGS), []);
  assert.deepEqual(matchedTagIds([{ path: "payments/refund.md", title: "" }], []), []);
});

test("matchedTagIds: a document whose words are in no tag matches nothing", () => {
  assert.deepEqual(matchedTagIds([{ path: "zzqx/vvwy.md", title: "" }], TAGS), []);
});

test("matchedTagIds: ids come back in dictionary order whatever the order of the documents", () => {
  const ids = matchedTagIds([{ path: "auth/login.md", title: "" }, { path: "payments/refund.md", title: "" }], TAGS);
  assert.ok(ids.includes("payments") && ids.includes("security"));
  // The dictionary lists payments before security; the documents were given the other way round.
  assert.ok(ids.indexOf("payments") < ids.indexOf("security"));
});

test("matchedTagIds: a tag that several documents match is listed once", () => {
  const ids = matchedTagIds([{ path: "payments/refund.md", title: "" }, { path: "payments/billing.md", title: "" }], TAGS);
  assert.equal(ids.filter((id) => id === "payments").length, 1);
});

test("matchedTagIds: title words count toward a match", () => {
  // Two title words at weight 2 reach the apply score, while the path alone matches nothing.
  assert.deepEqual(matchedTagIds([{ path: "zzqx/vvwy.md", title: "Payment refund" }], TAGS).includes("payments"), true);
});
