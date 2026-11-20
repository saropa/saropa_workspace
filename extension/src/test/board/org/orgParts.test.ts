// Tags, naming, colours, layout bands, front matter and overrides of the auto-organization engine.

import { test } from "node:test";
import assert from "node:assert/strict";
import { COLOUR_HEX, assignColours } from "../../../board/org/appearance";
import { readFrontMatter } from "../../../board/org/frontMatter";
import { bandFor, layoutFor, openGroups } from "../../../board/org/layout";
import { clipName, cleanName, dedupNames, displayName } from "../../../board/org/naming";
import { relocateOverrides, resolveByPrecedence } from "../../../board/org/overrides";
import { DEFAULT_TAGS, compileTags, matchTags, mergeDictionary, subjectOf } from "../../../board/org/tags";
import { byId, doc, docs, run, t } from "./orgFixtures";

const compiled = compileTags(DEFAULT_TAGS);

test("names: dates, versions and kind words are cleaned, acronyms kept, no brackets", () => {
  assert.equal(cleanName("2026-10-30_payments_v2"), "Payments");
  assert.equal(cleanName("20261030_payments"), "Payments");
  assert.equal(cleanName("my-API_specs"), "My API specs");
  assert.equal(cleanName("ALL CAPS"), "ALL CAPS");
  assert.equal(cleanName("01_PLAN_share_keys_phase2"), "Share keys");
  assert.equal(cleanName("Café_Münü"), "Café münü");
  assert.equal(cleanName("shareKeys"), "Share keys");
  assert.equal(cleanName("plan (payments) [x]"), "Payments x");
  assert.ok(!/[[\]()]/.test(cleanName("a[b](c)")));
  assert.equal([...clipName("x".repeat(60))].length, 32);
});

test("names: equal names get the nearest differing parent folder, then a number", () => {
  const out = dedupNames([
    { id: "a:folder:plans/payments", name: "Payments", kind: "folder", folder: "plans/payments" },
    { id: "a:folder:bugs/payments", name: "Payments", kind: "folder", folder: "bugs/payments" },
    { id: "a:folder:x/dup", name: "Dup", kind: "folder", folder: "x/dup" },
    { id: "a:folder:x2/dup", name: "Dup", kind: "folder", folder: "x/dup" },
  ]);
  assert.equal(out.get("a:folder:plans/payments"), "Payments · Plans");
  assert.equal(out.get("a:folder:bugs/payments"), "Payments · Bugs");
  assert.deepEqual([out.get("a:folder:x/dup"), out.get("a:folder:x2/dup")], ["Dup", "Dup 2"]);
  assert.ok([...out.values()].every((v) => !/[[\]()]/.test(v)));
});

test("tags: folder and file hits score 3, a title hit 2, a tag applies at 3", () => {
  const folderHit = matchTags(subjectOf("docs/billing/x.md"), compiled);
  assert.equal(folderHit[0].tagId, "payments");
  assert.equal(folderHit[0].score, 3);
  assert.ok(folderHit[0].why.params.words.toString().includes("folder: bill"));
  assert.equal(matchTags(subjectOf("docs/x.md", "Billing"), compiled).length, 0, "one title word is not enough");
  assert.equal(matchTags(subjectOf("docs/x.md", "Billing and refunds"), compiled)[0].tagId, "payments");
  assert.equal(matchTags(subjectOf("docs/payments_plan.md"), compiled)[0].tagId, "payments");
});

test("tags: ties go to the tag listed first, front matter names a tag outright", () => {
  const both = subjectOf("docs/billing_login.md");
  assert.equal(matchTags(both, compiled)[0].tagId, "payments");
  const reordered = compileTags(mergeDictionary({ order: ["security"] }).tags);
  assert.equal(matchTags(both, reordered)[0].tagId, "security");
  const named = matchTags(subjectOf("docs/zz.md"), compiled, ["Payments"]);
  assert.equal(named[0].tagId, "payments");
  assert.equal(named[0].why.source, "frontMatter");
});

test("dictionary: add, replace, turn off and reorder; red is refused", () => {
  const m = mergeDictionary({
    add: [{ id: "legal", label: "Legal", emoji: "⚖", colour: "teal", patterns: ["contract"] }],
    replace: { payments: { emoji: "💰" } },
    off: ["owner"],
    order: ["legal"],
  });
  assert.equal(m.tags[0].id, "legal");
  assert.equal(m.tags.find((x) => x.id === "payments")?.emoji, "💰");
  assert.equal(m.tags.some((x) => x.id === "owner"), false);
  assert.equal(m.refused.length, 0);
  const red = mergeDictionary({
    add: [
      { id: "r1", label: "R1", emoji: "🚀", colour: "#ff0000", patterns: ["a"] },
      { id: "r2", label: "R2", emoji: "🔴", colour: "teal", patterns: ["b"] },
      { id: "r3", label: "R3", emoji: "🚀", colour: "#d33a44", patterns: ["c"] },
      { id: "ok", label: "Ok", emoji: "🚀", colour: "#1a7fb0", patterns: ["d"] },
    ],
  });
  assert.deepEqual(red.refused.map((r) => r.id), ["r1", "r2", "r3"]);
  assert.ok(red.tags.some((x) => x.id === "ok"));
  const bad = mergeDictionary({ replace: { bugs: { colour: "#ff0000" } } });
  assert.equal(bad.tags.find((x) => x.id === "bugs")?.colour, "olive", "a refused change keeps the shipped tag");
});

test("dictionary: every shipped tag is valid, there are 16, and the eight colours pass", () => {
  assert.equal(DEFAULT_TAGS.length, 16);
  assert.equal(mergeDictionary().refused.length, 0);
  const hexes = Object.values(COLOUR_HEX).map((hex, i) => ({ id: "c" + i, label: "C", emoji: "📁", colour: hex, patterns: ["x"] }));
  assert.equal(mergeDictionary({ add: hexes }).refused.length, 0);
});

test("colours: a tag keeps its colour, others get a stable one that siblings do not share", () => {
  const input = Array.from({ length: 8 }, (_v, i) => ({ id: "app:folder:f" + i, parent: "app" }));
  const a = assignColours(input);
  const b = assignColours([...input].reverse());
  assert.deepEqual([...a], [...b].sort((x, y) => (x[0] < y[0] ? -1 : 1)));
  assert.equal(new Set([...a.values()].map((v) => v.colour)).size, 8);
  const tagged = assignColours([{ id: "app:tag:x", parent: "app", tagColour: "ochre", tagLabel: "X" }]);
  assert.equal(tagged.get("app:tag:x")?.colour, "ochre");
});

test("front matter: tags, group and needs are read; no block and broken blocks are ignored", () => {
  const fm = readFrontMatter("---\ntags: [payments, \"security\"]\ngroup: Store launch\nneeds:\n  - docs/a.md\n  - docs/b.md\n---\n# Title\n");
  assert.deepEqual(fm.tags, ["payments", "security"]);
  assert.equal(fm.group, "Store launch");
  assert.deepEqual(fm.needs, ["docs/a.md", "docs/b.md"]);
  assert.deepEqual(readFrontMatter("tags: [a]\n# Title").tags, []);
  assert.deepEqual(readFrontMatter("---\ntags: [a]\nno closing line").tags, []);
  assert.deepEqual(readFrontMatter("---\n{{ not yaml\n---\n").tags, []);
  assert.deepEqual(readFrontMatter("---\ntags: a, b\n---\n").tags, ["a", "b"]);
});

test("precedence: your change, then the rules file, then front matter, then inference", () => {
  assert.deepEqual(resolveByPrecedence({ inference: "i", frontMatter: "f", rules: "r" }), { value: "r", source: "rules" });
  assert.deepEqual(resolveByPrecedence({ inference: "i", override: "o", rules: "r" }), { value: "o", source: "override" });
  assert.equal(resolveByPrecedence({}), undefined);
});

test("precedence in grouping: a placement by hand beats a rules glob, which beats front matter", () => {
  const input = [
    doc("app", "docs/a.md", { group: "From front matter" }),
    doc("app", "docs/b.md", { group: "From front matter" }),
    doc("app", "docs/c.md", { group: "From front matter" }),
  ];
  const r1 = run(input, { manual: [{ name: "From rules", match: ["app/docs/a.md"] }] });
  assert.equal(r1.groupOf.get("app\tdocs/a.md"), "app:manual:From rules");
  assert.equal(r1.groupOf.get("app\tdocs/b.md"), "app:manual:From front matter");
  assert.equal(r1.docWhy.get("app\tdocs/b.md")?.source, "frontMatter");
  const r2 = run(input, { manual: [{ name: "From rules", match: ["app/docs/a.md"] }] }, { assign: [{ project: "app", path: "docs/a.md", group: "app:manual:By hand" }] });
  assert.equal(r2.groupOf.get("app\tdocs/a.md"), "app:manual:By hand");
  assert.equal(byId(r2, "app:manual:By hand")?.why.source, "override");
});

test("overrides: a group override renames, recolours and is marked as set by you; a missing id is stale", () => {
  const input = docs("app", ["docs/pay/a.md", "docs/pay/b.md", "docs/pay/c.md"]);
  const id = run(input).groups[0].id;
  const r = run(input, {}, { groups: { [id]: { name: "Store payments", emoji: "🛒", colour: "pine" }, "app:folder:gone": { name: "x" } }, untag: [{ project: "app", path: "docs/gone.md", tag: "x" }] });
  const g = byId(r, id)!;
  assert.equal(g.name, "Store payments");
  assert.equal(g.emoji, "🛒");
  assert.equal(g.colour, "pine");
  assert.equal(g.edited, true);
  assert.equal(g.nameWhy.source, "override");
  assert.deepEqual(r.stale.map((s) => s.ref).sort(), ["app:folder:gone", "docs/gone.md"]);
});

test("overrides: a removed tag no longer applies to the document", () => {
  const input = [doc("app", "docs/billing_notes.md")];
  assert.equal(run(input).tagsOf.get(input[0].key)?.[0].tagId, "payments");
  const r = run(input, {}, { untag: [{ project: "app", path: "docs/billing_notes.md", tag: "payments" }] });
  assert.equal(r.tagsOf.get(input[0].key)?.length, 0);
});

test("overrides follow a renamed file when exactly one match exists; otherwise they are stale", () => {
  const cfg = {
    assign: [
      { project: "app", path: "docs/old/a.md", group: "app:manual:G" },
      { project: "app", path: "docs/old/dup.md", group: "app:manual:G" },
      { project: "app", path: "docs/old/deleted.md", group: "app:manual:G" },
    ],
  };
  const now = [{ project: "app", path: "docs/new/a.md" }, { project: "app", path: "docs/n1/dup.md" }, { project: "app", path: "docs/n2/dup.md" }];
  const r = relocateOverrides(cfg, now);
  assert.deepEqual(r.moved, [{ from: "docs/old/a.md", to: "docs/new/a.md" }]);
  assert.equal(r.config.assign![0].path, "docs/new/a.md");
  assert.deepEqual(r.stale.map((s) => s.ref).sort(), ["docs/old/deleted.md", "docs/old/dup.md"]);
});

test("overrides follow a renamed folder that holds 80 percent of the same file names", () => {
  const cfg = { groups: { "app:folder:docs/old": { name: "Mine" } } };
  const r = relocateOverrides(cfg, [], [{ id: "app:folder:docs/new", files: ["a.md", "b.md", "c.md", "d.md", "e.md", "z.md"] }], { "app:folder:docs/old": ["a.md", "b.md", "c.md", "d.md", "e.md"] });
  assert.ok(r.config.groups?.["app:folder:docs/new"]);
  const none = relocateOverrides(cfg, [], [{ id: "app:folder:docs/new", files: ["a.md"] }], { "app:folder:docs/old": ["a.md", "b.md", "c.md", "d.md", "e.md"] });
  assert.deepEqual(none.stale, [{ kind: "group", ref: "app:folder:docs/old" }]);
});

test("layout: the table for 5, 30, 100, 500 and 2000 documents", () => {
  const rows = [5, 30, 100, 500, 2000].map((n) => layoutFor(n));
  assert.deepEqual(rows.map((l) => l.headers), [false, true, true, true, true]);
  assert.deepEqual(rows.map((l) => [l.min, l.max]), [[2, 8], [2, 11], [3, 20], [4, 40], [5, 40]]);
  assert.deepEqual(rows.map((l) => l.levels), [1, 1, 1, 2, 2]);
  assert.deepEqual(rows.map((l) => l.rowLimit), [null, 8, 5, 5, 3]);
  assert.deepEqual(rows.map((l) => l.finished), ["all", "all", "last2", "count", "count"]);
  assert.deepEqual(rows.map((l) => l.suggestions.minConfidence), ["low", "medium", "medium", "medium", "high"]);
  assert.ok(rows.slice(1).every((l) => l.foldWhy));
});

test("layout: bands change upward at the boundary and downward only 10 percent below", () => {
  assert.equal(bandFor(50), 2);
  assert.equal(bandFor(49), 1);
  assert.equal(bandFor(46, 2), 2, "stays in the band just below the boundary");
  assert.equal(bandFor(44, 2), 1);
  assert.equal(bandFor(10, 4), 1);
  assert.equal(layoutFor(48, 2).band, 2);
});

test("layout: open groups on first view follow the blocker rule and the owner's own folds win", () => {
  const groups = [{ id: "a", blockers: 0 }, { id: "b", blockers: 5 }, { id: "c", blockers: 2 }, { id: "d", blockers: 9 }, { id: "e", blockers: 1 }];
  assert.deepEqual([...openGroups(layoutFor(5), groups)].sort(), ["a", "b", "c", "d", "e"]);
  assert.deepEqual([...openGroups(layoutFor(100), groups)].sort(), ["b", "c", "d"]);
  assert.deepEqual([...openGroups(layoutFor(30), groups)].sort(), ["b", "c", "d", "e"]);
  assert.deepEqual([...openGroups(layoutFor(30), groups.slice(0, 3))].sort(), ["a", "b", "c"]);
  assert.deepEqual([...openGroups(layoutFor(2000), groups, new Map([["a", true], ["d", false]]))].sort(), ["a", "b", "c"]);
});

test("every automatic group says why, with a name, emoji and colour reason", () => {
  const input = docs("app", ["docs/billing/a.md", "docs/billing/b.md", "docs/billing/c.md"]);
  const g = run(input).groups[0];
  assert.equal(t(g.why.key, g.why.params), "Auto group: folder docs/billing, 3 documents.");
  assert.equal(g.emoji, "💳");
  assert.equal(g.tag, "payments");
  assert.equal(g.colour, "ochre");
  assert.match(t(g.emojiWhy.key, g.emojiWhy.params), /💳 from tag Payments/);
  assert.equal(displayName(g, t), "Billing");
});
