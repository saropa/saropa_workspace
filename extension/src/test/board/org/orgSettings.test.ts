// The `organize` key of the rules file changes the engines: tags, link phrases, naming.

import { test } from "node:test";
import assert from "node:assert/strict";
import { inferLinkProposals } from "../../../board/org/linksInfer";
import { LinkDoc } from "../../../board/org/linksSignals";
import { cleanName } from "../../../board/org/naming";
import { matchedTagIds, settingsOf } from "../../../board/org/settings";
import { docs, run } from "./orgFixtures";

const link = (p: string, text = ""): LinkDoc => ({ project: "app", path: p, title: "", text });
// Phrase proposals only: a plain mention of the file name is a separate, weaker signal.
const propose = (organize: unknown, ds: LinkDoc[]) => inferLinkProposals(ds, [], new Set(), { phrases: settingsOf(organize).linkPhrases }).filter((p) => p.signal === "phrase");

test("no organize key gives the shipped dictionary, every phrase and the shipped naming", () => {
  const s = settingsOf(undefined);
  assert.ok(s.tags.length > 5);
  assert.ok(s.linkPhrases.includes("blocked by") && s.linkPhrases.includes("after"));
  assert.equal(s.naming.dates, true);
});

test("a custom tag changes emoji, colour and group of matching documents", () => {
  const paths = ["docs/zebra/a.md", "docs/zebra/b.md", "docs/zebra/c.md", "docs/zebra/d.md", "docs/zebra/e.md", "docs/zebra/f.md"];
  const organize = { tags: { add: [{ id: "stripes", label: "Stripes", emoji: "🦓", colour: "teal", patterns: ["zebra"] }] } };
  const before = run(docs("app", paths), {}, {}, settingsOf(undefined).tags);
  const after = run(docs("app", paths), {}, {}, settingsOf(organize).tags);
  const has = (r: typeof after): boolean => [...r.tagsOf.values()].some((l) => l.some((m) => m.tagId === "stripes"));
  assert.ok(has(after));
  assert.ok(!has(before));
  assert.notEqual(JSON.stringify(before.groups.map((g) => [g.emoji, g.colour, g.name])), JSON.stringify(after.groups.map((g) => [g.emoji, g.colour, g.name])));
});

test("a turned-off shipped tag stops matching", () => {
  const ids = (o: unknown): string[] => settingsOf(o).tags.map((t) => t.id);
  const first = ids(undefined)[0];
  assert.ok(!ids({ tags: { off: [first] } }).includes(first));
});

test("a disabled link phrase stops its proposals; a phrase added gives them", () => {
  const ds = [link("docs/a.md", "Blocked by b.md\n"), link("docs/b.md")];
  assert.equal(propose(undefined, ds).length, 1);
  assert.equal(propose({ linkWords: { off: ["blocked by"] } }, ds).length, 0);
  const odd = [link("docs/a.md", "Held up by b.md\n"), link("docs/b.md")];
  assert.equal(propose(undefined, odd).length, 0);
  assert.equal(propose({ linkWords: { add: ["held up by"] } }, odd).length, 1);
});

test("a custom prefix is stripped from names, and a custom acronym is kept", () => {
  assert.equal(cleanName("memo_payments"), "Memo payments");
  const n = settingsOf({ naming: { prefixes: ["memo"], acronyms: ["Pdf"] } }).naming;
  assert.equal(cleanName("memo_payments", n.acronyms, n), "Payments");
  assert.equal(cleanName("pdf_export", n.acronyms, n), "Pdf export");
  assert.equal(cleanName("2026-10-30_payments", undefined, settingsOf({ naming: { dates: false } }).naming), "2026 10 30 payments");
});

test("naming settings reach the group names of a run", () => {
  const paths = Array.from({ length: 8 }, (_v, i) => `docs/memo_payments/file${i}.md`);
  const names = (organize: unknown): string[] => run(docs("app", paths), { naming: settingsOf(organize).naming }).groups.map((g) => g.name);
  assert.ok(names(undefined).some((n) => /memo/i.test(n)));
  assert.ok(!names({ naming: { prefixes: ["memo"] } }).some((n) => /memo/i.test(n)));
});

test("matchedTagIds lists the tags that match the given documents, in dictionary order", () => {
  const tags = settingsOf({ tags: { add: [{ id: "stripes", label: "Stripes", emoji: "🦓", colour: "teal", patterns: ["zebra"] }] } }).tags;
  assert.deepEqual(matchedTagIds([{ path: "docs/zebra/a.md", title: "Zebra crossing" }], tags), ["stripes"]);
  assert.deepEqual(matchedTagIds([{ path: "docs/x.md", title: "Nothing here" }], tags), []);
});
