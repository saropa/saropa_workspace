// The Tags and rules editor, pure part: checks on the page's state, the rules-file shape, import of hostile
// JSON, the contrast rule for custom colours, the test-match preview and the override storage API.

import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_TAGS, mergeDictionary } from "../../../board/org/tags";
import { settingsOf } from "../../../board/org/settings";
import {
  DEFAULT_LINK_PHRASES,
  EditorState,
  applyState,
  checkState,
  cleanGroupOverride,
  defaultState,
  exportText,
  groupOverrides,
  importDiff,
  loadOrganize,
  organizeFromState,
  parseImport,
  setAssign,
  setGroupOverride,
  setUntag,
  stateFromOrganize,
  stateOfText,
  testMatch,
} from "../../../board/org/organizeEdit";

const fresh = (f: (s: EditorState) => void = () => {}): EditorState => {
  const s = defaultState();
  f(s);
  return s;
};
const text = (r: { ok: boolean; text?: string }): string => (r as { text: string }).text;
const own = { id: "mobile", label: "Mobile", emoji: "📱", colour: "teal", patterns: ["ios", "android"], effects: ["group", "name", "emoji", "colour"], off: false };

test("the default state is accepted as it is and stores nothing", () => {
  const c = checkState(defaultState());
  assert.ok(c.ok);
  assert.deepEqual(organizeFromState(defaultState()), {});
});

test("an edited, added, reordered and turned-off tag round-trips through the stored form", () => {
  const s = fresh((x) => {
    x.tags[0].label = "Money";
    x.tags[0].patterns.push("invoice");
    x.tags[1].off = true;
    x.tags.unshift({ ...own, effects: ["group", "name"] } as EditorState["tags"][number]);
    x.tags.splice(3, 0, x.tags.splice(2, 1)[0]);
  });
  const stored = organizeFromState(s);
  assert.equal(stored.tags?.replace?.[DEFAULT_TAGS[0].id]?.label, "Money");
  assert.deepEqual(stored.tags?.off, [DEFAULT_TAGS[1].id]);
  assert.equal(stored.tags?.add?.[0].id, "mobile");
  assert.deepEqual(stored.tags?.add?.[0].effects, ["group", "name"]);
  const back = stateFromOrganize(JSON.parse(JSON.stringify(stored)));
  assert.deepEqual(back.tags, s.tags);
  const merged = mergeDictionary(stored.tags);
  assert.equal(merged.refused.length, 0);
  assert.equal(merged.tags.some((t) => t.id === DEFAULT_TAGS[1].id), false);
});

test("link words and naming store only what differs", () => {
  const s = fresh((x) => {
    x.linkWords.off = ["after"];
    x.linkWords.add = ["held up by"];
    x.naming.dates = false;
    x.naming.acronyms = [...x.naming.acronyms, "SDK"];
  });
  const stored = organizeFromState(s);
  assert.deepEqual(stored.linkWords, { off: ["after"], add: ["held up by"] });
  assert.equal(stored.naming?.dates, false);
  assert.equal(stored.naming?.prefixes, undefined);
  assert.ok(stored.naming?.acronyms?.includes("SDK"));
  assert.deepEqual(stateFromOrganize(JSON.parse(JSON.stringify(stored))), s);
});

test("the contrast rule: a custom hex must be readable on both themes and not red", () => {
  const colour = (c: string) => checkState(fresh((x) => (x.tags[0].colour = c)));
  assert.ok(colour("#138a7e").ok, "a shipped hex passes");
  assert.ok(colour("#1A7FB0").ok, "upper case is accepted");
  for (const bad of ["#ff0000", "#c0392b", "#ffffff", "#000000", "#fffe00", "red", "#12345", "#12345g", "rgb(0,0,0)", "", "#138a7e00"]) {
    assert.equal(colour(bad).ok, false, bad);
  }
  assert.equal(checkState(fresh((x) => (x.tags[0].emoji = "🔴"))).ok, false, "a red emoji is refused");
});

test("the host refuses every malformed state, whole", () => {
  const bad: unknown[] = [
    null, [], "x", {}, { tags: [] }, { ...defaultState(), tags: "x" },
    fresh((x) => (x.tags[0].id = "Bad Id")),
    fresh((x) => (x.tags[0].id = "__proto__")),
    fresh((x) => (x.tags[0].label = "")),
    fresh((x) => (x.tags[0].label = "a".repeat(41))),
    fresh((x) => (x.tags[0].label = "a\nb")),
    fresh((x) => (x.tags[0].patterns = ["two words"])),
    fresh((x) => (x.tags[0].patterns = ["<script>"])),
    fresh((x) => (x.tags[0].patterns = Array.from({ length: 51 }, (_, i) => `w${i}`))),
    fresh((x) => ((x.tags[0] as { effects: string[] }).effects = ["nope"])),
    fresh((x) => (x.tags[1].id = x.tags[0].id)),
    fresh((x) => (x.tags = Array.from({ length: 201 }, (_, i) => ({ ...own, id: `t${i}` })) as EditorState["tags"])),
    fresh((x) => (x.linkWords.off = ["not a shipped phrase"])),
    fresh((x) => (x.linkWords.add = ["Has Caps"])),
    fresh((x) => (x.linkWords.add = [DEFAULT_LINK_PHRASES[0]])),
    fresh((x) => (x.linkWords.add = Array.from({ length: 21 }, (_, i) => `phrase ${String.fromCharCode(97 + i)}`))),
    fresh((x) => (x.naming.prefixes = ["a b"])),
    fresh((x) => (x.naming.acronyms = ["has space"])),
    { ...defaultState(), naming: { ...defaultState().naming, dates: "yes" } },
  ];
  bad.forEach((b, i) => assert.equal(checkState(b).ok, false, `case ${i}`));
});

test("a checked state is a copy with duplicates folded and nothing extra", () => {
  const s = fresh((x) => {
    (x.tags[0] as unknown as Record<string, unknown>).extra = "x";
    x.tags[0].patterns = ["Pay", "pay"];
    x.linkWords.add = ["held up by", "held up by"];
  });
  const c = checkState(s);
  assert.ok(c.ok);
  if (c.ok) {
    assert.deepEqual(c.state.tags[0].patterns, ["pay"]);
    assert.deepEqual(c.state.linkWords.add, ["held up by"]);
    assert.equal("extra" in c.state.tags[0], false);
  }
});

test("import of hostile JSON drops everything unusable and never copies unknown keys", () => {
  const hostile = JSON.stringify({
    ["__proto__"]: { polluted: true },
    constructor: { prototype: { polluted: true } },
    tags: {
      add: [own, { ...own, id: "red", colour: "#ff0000" }, { ...own, id: "x".repeat(500) }, { ...own, id: DEFAULT_TAGS[0].id }, "string", null, { id: "__proto__", label: "p", colour: "teal", patterns: [] }],
      replace: { [DEFAULT_TAGS[0].id]: { colour: "#ff0000", label: "Kept?" }, ["__proto__"]: { label: "x" }, nope: { label: "x" } },
      off: [DEFAULT_TAGS[1].id, 5, {}],
      order: ["mobile", "ghost", 7],
    },
    linkWords: { off: ["after", "weird"], add: ["<b>x</b>"] },
    naming: { dates: "no", prefixes: ["plan", 3], acronyms: ["API"] },
    groups: { evil: { name: "x" } },
  });
  const r = parseImport(hostile);
  assert.ok(r.ok);
  if (r.ok) {
    const ids = r.state.tags.map((t) => t.id);
    assert.equal(ids[0], "mobile", "the order is kept for tags that exist");
    assert.equal(ids.includes("red"), false);
    assert.equal(ids.filter((i) => i === DEFAULT_TAGS[0].id).length, 1);
    assert.equal(r.state.tags.find((t) => t.id === DEFAULT_TAGS[0].id)?.colour, DEFAULT_TAGS[0].colour, "an unusable patch leaves the shipped tag");
    assert.equal(r.state.tags.find((t) => t.id === DEFAULT_TAGS[1].id)?.off, true);
    assert.deepEqual(r.state.linkWords, { off: [], add: [] });
    assert.equal(r.state.naming.dates, true);
    assert.equal(({} as Record<string, unknown>).polluted, undefined);
    assert.ok(checkState(r.state).ok, "what import returns passes the same check as a save");
  }
});

test("import refuses a file that is too large, not JSON or not an object", () => {
  assert.deepEqual(parseImport("x".repeat(300000)), { ok: false, problem: "size" });
  assert.deepEqual(parseImport("{nope"), { ok: false, problem: "parse" });
  assert.deepEqual(parseImport("[1]"), { ok: false, problem: "shape" });
  assert.deepEqual(parseImport('"x"'), { ok: false, problem: "shape" });
});

test("export is the stored form and imports back to the same state", () => {
  const s = fresh((x) => {
    x.tags[0].label = "Money";
    x.naming.dates = false;
  });
  const r = parseImport(exportText(s));
  assert.ok(r.ok);
  if (r.ok) {
    assert.deepEqual(r.state, s);
  }
});

test("test-match counts the open documents each turned-on tag applies to, by title only", () => {
  const docs = [
    { path: "docs/payments/billing-plan.md", title: "Billing plan" },
    { path: "docs/notes/misc.md", title: "Misc" },
  ];
  const s = fresh();
  const r = testMatch(docs, s.tags);
  assert.equal(r.payments.count, 1);
  assert.deepEqual(r.payments.examples, ["Billing plan"]);
  s.tags[0].off = true;
  assert.equal(testMatch(docs, s.tags).payments.count, 0, "a tag that is off matches nothing");
});

test("applyState writes only the three keys, keeps the rest of the file and its formatting, and removes them when defaults return", () => {
  const original = '{\r\n    "version": 1,\r\n    "pinned": ["a"],\r\n    "organize": {"groups": {"app:folder:x": {"name": "X"}}}\r\n}\r\n';
  const s = fresh((x) => (x.naming.dates = false));
  const w = applyState(original, s);
  assert.ok(w.ok && w.changed);
  const out = text(w);
  assert.ok(out.includes('\r\n    "pinned"'), "indent and line ends kept");
  const doc = JSON.parse(out);
  assert.deepEqual(doc.organize.naming, { dates: false });
  assert.deepEqual(doc.organize.groups, { "app:folder:x": { name: "X" } });
  const back = applyState(out, defaultState());
  assert.ok(back.ok);
  assert.deepEqual(JSON.parse(text(back)).organize, { groups: { "app:folder:x": { name: "X" } } });
  const empty = applyState('{"version":1,"organize":{"naming":{"dates":false}}}', defaultState());
  assert.deepEqual(JSON.parse(text(empty)), { version: 1 });
  const same = applyState(original, defaultState());
  assert.ok(same.ok && !same.changed);
});

test("a rules file the editor cannot rewrite safely is refused", () => {
  assert.deepEqual(applyState("{nope", defaultState()), { ok: false, reason: "parse" });
  assert.deepEqual(applyState('{"organize": []}', defaultState()), { ok: false, reason: "shape" });
  assert.deepEqual(applyState('{"a":1,"a":2}', defaultState()), { ok: false, reason: "lossy" });
  assert.equal(stateOfText("{nope"), undefined);
  assert.deepEqual(stateOfText(""), defaultState());
});

test("group overrides: read, set, merge, clear, and refuse unusable values", () => {
  const id = "app:folder:docs/payments";
  const one = setGroupOverride(undefined, id, { name: "Money", emoji: "💰", colour: "ochre" });
  assert.ok(one.ok && one.changed);
  assert.deepEqual(groupOverrides(text(one))[id], { name: "Money", emoji: "💰", colour: "ochre" });
  const two = setGroupOverride(text(one), "app:tag:data", { colour: "sky" });
  assert.deepEqual(Object.keys(groupOverrides(text(two))).sort(), [id, "app:tag:data"].sort());
  const cleared = setGroupOverride(text(two), id, undefined);
  assert.deepEqual(Object.keys(groupOverrides(text(cleared))), ["app:tag:data"]);
  const gone = setGroupOverride(text(cleared), "app:tag:data", {});
  assert.deepEqual(JSON.parse(text(gone)), { version: 1 });
  for (const bad of [{ name: "" }, { name: "x".repeat(61) }, { colour: "#ff0000" }, { colour: "#1a7fb0" }, { colour: "blue" }, { emoji: "e".repeat(17) }, { name: 5 }]) {
    assert.deepEqual(setGroupOverride(undefined, id, bad as never), { ok: false, reason: "shape" }, JSON.stringify(bad));
  }
  for (const badId of ["", "plain", "__proto__", "a b:folder:x", "app:folder:" + "x".repeat(300)]) {
    assert.deepEqual(setGroupOverride(undefined, badId, { name: "x" }), { ok: false, reason: "shape" }, badId);
  }
  assert.equal(cleanGroupOverride("x"), undefined);
});

test("reading overrides ignores entries a hand edit left unusable", () => {
  const t = '{"organize":{"groups":{"app:folder:a":{"name":"Ok"},"app:folder:b":{"colour":"#ff0000"},"junk":{"name":"x"},"app:folder:c":5}}}';
  assert.deepEqual(groupOverrides(t), { "app:folder:a": { name: "Ok" } });
});

test("assign and untag: one entry per document, removable, and the other keys stay", () => {
  const doc = { project: "app", path: "docs/a.md" };
  const a1 = setAssign(undefined, doc, "app:folder:docs");
  const a2 = setAssign(text(a1), doc, "app:tag:data");
  assert.deepEqual(JSON.parse(text(a2)).organize.assign, [{ project: "app", path: "docs/a.md", group: "app:tag:data" }]);
  const u = setUntag(text(a2), doc, "payments", true);
  assert.deepEqual(JSON.parse(text(u)).organize.untag, [{ project: "app", path: "docs/a.md", tag: "payments" }]);
  const u2 = setUntag(text(u), doc, "payments", false);
  const a3 = setAssign(text(u2), doc, undefined);
  assert.deepEqual(JSON.parse(text(a3)), { version: 1 });
  assert.deepEqual(setAssign(undefined, { project: "", path: "x" }, "app:folder:x"), { ok: false, reason: "shape" });
  assert.deepEqual(setAssign(undefined, doc, "nonsense"), { ok: false, reason: "shape" });
  assert.deepEqual(setUntag(undefined, doc, "Bad Tag", true), { ok: false, reason: "shape" });
  assert.deepEqual(setAssign('{"organize":{"assign":5}}', doc, "app:folder:x"), { ok: false, reason: "shape" });
});

test("the loader keeps where, names what it dropped, and an import is counted before it is used", () => {
  const org = { tags: { add: [{ id: "mine", label: "Mine", colour: "teal", patterns: ["alpha"], where: ["title"] }, { id: "bad", label: "Bad", colour: "#ff0000", patterns: ["x"] }] }, naming: { dates: "no" } };
  const l = loadOrganize(org);
  assert.deepEqual(l.state.tags.find((r) => r.id === "mine")?.where, ["title"]);
  assert.deepEqual([...l.lossy].sort(), ["naming", "tags"]);
  assert.equal(settingsOf(org).tags.find((t) => t.id === "mine")?.where?.[0], "title");
  assert.deepEqual(organizeFromState(l.state).tags?.add?.[0].where, ["title"]);
  assert.deepEqual(loadOrganize({}).lossy, []);
  const next = defaultState();
  next.tags.push({ ...next.tags[0], id: "extra" });
  next.tags[1] = { ...next.tags[1], label: "Changed" };
  assert.deepEqual(importDiff(defaultState(), next), { adds: 1, replaces: 1, removes: 0, link: false, naming: false });
});

test("the loader warns when a save would drop entries it does not know", () => {
  const cases: unknown[] = [
    { tags: { replace: { "no-such-tag": { label: "X" } } } },
    { tags: { replace: { [DEFAULT_TAGS[0].id]: { label: "X", future: 1 } } } },
    { tags: { add: [{ id: "mine", label: "Mine", colour: "teal", patterns: ["alpha"], future: true }] } },
    { tags: { off: ["no-such-tag"] } },
    { tags: { order: ["no-such-tag"] } },
  ];
  for (const org of cases) {
    assert.ok(loadOrganize(org).lossy.includes("tags"), JSON.stringify(org));
  }
  assert.deepEqual(loadOrganize({ tags: { replace: { [DEFAULT_TAGS[0].id]: { label: "X" } }, off: [DEFAULT_TAGS[0].id] } }).lossy, []);
});
