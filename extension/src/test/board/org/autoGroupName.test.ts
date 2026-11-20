// Direct tests for the name layer of auto-grouping: sequence families, shared stem words, tag themes, shared source files,
// link joins and the cut of an over-size group. The layer is driven through a hand-built Env so each signal is isolated.

import { test } from "node:test";
import assert from "node:assert/strict";
import { nameLayer } from "../../../board/org/autoGroupName";
import { Env, G } from "../../../board/org/autoGroupTypes";
import { layoutFor } from "../../../board/org/layout";
import type { OrgDoc, TagMatch } from "../../../board/org/orgTypes";
import { DEFAULT_TAGS } from "../../../board/org/tags";
import { fileTokens } from "../../../board/org/tokens";
import { doc } from "./orgFixtures";

// Builds the Env for a list of documents. The file tokens come from the real tokenizer so the fixture cannot drift from
// what the layer sees in production; `max` is lowered by tests that need an over-size group without a huge fixture.
function envFor(docs: OrgDoc[], over: Partial<Env> = {}, max?: number): Env {
  const layout = layoutFor(10);
  return {
    project: "app",
    layout: max === undefined ? layout : { ...layout, max },
    tok: new Map(docs.map((d) => [d.key, fileTokens(d.path)])),
    matches: new Map(),
    tagById: new Map(DEFAULT_TAGS.map((t) => [t.id, t])),
    hubs: new Set(),
    nameOf: (raw) => raw,
    ...over,
  };
}

const d = (p: string, extra: Partial<OrgDoc> = {}): OrgDoc => doc("app", p, extra);
const byId = (gs: G[], id: string): G | undefined => gs.find((g) => g.id === id);

test("a sequence family of two or more members becomes one seq group with its range", () => {
  const docs = [d("docs/PLAN_login_phase1.md"), d("docs/PLAN_login_phase3.md")];
  const { groups, rest } = nameLayer(envFor(docs), docs, "");
  const g = byId(groups, "app:seq:docs/login");
  assert.ok(g, "the family group exists");
  assert.equal(g.kind, "seq");
  assert.deepEqual(g.range, { label: "phase", from: 1, to: 3 });
  assert.equal(g.docs.length, 2);
  assert.equal(rest.length, 0);
});

test("a lone sequence member is not a family and stays loose", () => {
  const docs = [d("docs/PLAN_login_phase1.md")];
  const { groups, rest } = nameLayer(envFor(docs), docs, "");
  assert.equal(groups.length, 0);
  assert.deepEqual(rest.map((x) => x.key), [docs[0].key]);
});

test("members with a different sequence label than the most common one stay loose", () => {
  const docs = [d("docs/login_phase1.md"), d("docs/login_phase2.md"), d("docs/login_part1.md")];
  const { groups, rest } = nameLayer(envFor(docs), docs, "");
  assert.equal(byId(groups, "app:seq:docs/login")?.docs.length, 2);
  assert.ok(rest.some((x) => x.path === "docs/login_part1.md"), "the part member is left out of the phase family");
});

test("a plain document with the family stem joins the family", () => {
  const docs = [d("docs/login_phase1.md"), d("docs/login_phase2.md"), d("docs/login.md")];
  const { groups } = nameLayer(envFor(docs), docs, "");
  assert.equal(byId(groups, "app:seq:docs/login")?.docs.length, 3);
});

test("documents sharing a first stem word make a stem group, and kind words are not counted as the word", () => {
  const docs = [d("payments_alpha.md"), d("payments_beta.md"), d("PLAN.md"), d("BUG.md")];
  const { groups, rest } = nameLayer(envFor(docs), docs, "");
  const g = byId(groups, "app:stem:payments");
  assert.ok(g);
  assert.equal(g.docs.length, 2);
  // PLAN and BUG are kind words only: two of them would group on "plan"/"bug" if the kind filter were missing.
  assert.equal(groups.length, 1);
  assert.equal(rest.length, 2);
});

test("a stem group is scoped to its context folder", () => {
  const docs = [d("payments_alpha.md"), d("payments_beta.md")];
  const { groups } = nameLayer(envFor(docs), docs, "docs");
  assert.ok(byId(groups, "app:stem:docs/payments"));
});

test("a stem word shorter than three letters makes no group", () => {
  const docs = [d("ab_alpha.md"), d("ab_beta.md")];
  assert.equal(nameLayer(envFor(docs), docs, "").groups.length, 0);
});

test("a stem group under the minimum is not made", () => {
  const docs = [d("payments_alpha.md")];
  assert.equal(nameLayer(envFor(docs), docs, "").groups.length, 0);
});

function match(tagId: string, where: "folder" | "file" | "title", source: TagMatch["why"]["source"] = "inference"): TagMatch {
  return { tagId, score: 5, hits: [{ where, word: "login" }], why: { key: "releaseBoard.org.why.tag", params: {}, source, confidence: "medium" } };
}

test("documents whose best tag is the same make a tag group carrying the tag id and the matched words", () => {
  const docs = [d("alpha.md"), d("beta.md")];
  const tag = DEFAULT_TAGS[0];
  const matches = new Map(docs.map((x) => [x.key, [match(tag.id, "file")]]));
  const { groups } = nameLayer(envFor(docs, { matches }), docs, "");
  const g = byId(groups, `app:tag:${tag.id}`);
  assert.ok(g);
  assert.equal(g.tagId, tag.id);
  assert.equal(g.name, tag.label);
  assert.equal(g.why.params.count, 2);
  assert.equal(g.why.params.words, "login");
});

test("a tag matched only through the folder name does not group a document", () => {
  const docs = [d("alpha.md"), d("beta.md")];
  const matches = new Map(docs.map((x) => [x.key, [match(DEFAULT_TAGS[0].id, "folder")]]));
  assert.equal(nameLayer(envFor(docs, { matches }), docs, "").groups.length, 0);
});

test("a front matter tag groups a document even when its only hit is in the folder", () => {
  const docs = [d("alpha.md"), d("beta.md")];
  const matches = new Map(docs.map((x) => [x.key, [match(DEFAULT_TAGS[0].id, "folder", "frontMatter")]]));
  assert.equal(nameLayer(envFor(docs, { matches }), docs, "").groups.length, 1);
});

test("documents sharing source files make a files group named after the most used file", () => {
  const files = ["lib/pay/index.ts", "lib/pay/util.ts"];
  const docs = [d("alpha.md", { sourceFiles: files }), d("beta.md", { sourceFiles: files })];
  const { groups } = nameLayer(envFor(docs), docs, "");
  assert.equal(groups.length, 1);
  assert.equal(groups[0].kind, "files");
  assert.equal(groups[0].docs.length, 2);
  assert.equal(groups[0].name, "index.ts");
});

test("a hub document never pulls others into a group", () => {
  const files = ["lib/pay/index.ts", "lib/pay/util.ts"];
  const docs = [d("alpha.md", { sourceFiles: files }), d("beta.md", { sourceFiles: files })];
  const hubs = new Set([docs[0].key]);
  const { groups, rest } = nameLayer(envFor(docs, { hubs }), docs, "");
  assert.equal(groups.length, 0);
  assert.equal(rest.length, 2);
});

test("a loose document whose links all point into one group joins that group and the count goes up", () => {
  const family = [d("docs/login_phase1.md"), d("docs/login_phase2.md")];
  const linked = d("docs/zeta.md", { needs: [family[0].key] });
  const docs = [...family, linked];
  const { groups, rest } = nameLayer(envFor(docs), docs, "");
  const g = byId(groups, "app:seq:docs/login");
  assert.ok(g);
  assert.equal(g.docs.length, 3);
  assert.equal(g.why.params.count, 3);
  assert.equal(rest.length, 0);
});

test("a document linking into two different groups stays loose", () => {
  const a = [d("docs/login_phase1.md"), d("docs/login_phase2.md")];
  const b = [d("docs/sync_phase1.md"), d("docs/sync_phase2.md")];
  const linked = d("docs/zeta.md", { needs: [a[0].key, b[0].key] });
  const docs = [...a, ...b, linked];
  const { rest } = nameLayer(envFor(docs), docs, "");
  assert.deepEqual(rest.map((x) => x.key), [linked.key]);
});

test("a document linking to a group made at a lower level joins it through prior", () => {
  const family = [d("docs/login_phase1.md"), d("docs/login_phase2.md")];
  const first = nameLayer(envFor(family), family, "");
  const linked = d("zeta.md", { needs: [family[0].key] });
  const second = nameLayer(envFor([linked]), [linked], "", first.groups);
  // The joined document is taken from the free list, so it no longer counts as loose, and it lands in the prior group.
  assert.equal(second.rest.length, 0);
  assert.equal(first.groups[0].docs.length, 3);
});

test("an over-size stem group is cut by child folder into sibling groups", () => {
  const docs = ["a", "b"].flatMap((f) => ["one", "two", "three"].map((n) => d(`${f}/pay_${n}.md`)));
  const { groups, rest } = nameLayer(envFor(docs, {}, 3), docs, "");
  assert.deepEqual(groups.map((g) => g.id).sort(), ["app:stem:pay/a", "app:stem:pay/b"]);
  assert.equal(rest.length, 0);
  assert.ok(groups.every((g) => g.docs.length === 3 && !g.oversize));
  assert.ok(groups.every((g) => g.name.startsWith("pay · ")));
});

test("an over-size group no signal can cut stays whole and is flagged", () => {
  const docs = ["one", "two", "three", "four"].map((n) => d(`pay_${n}.md`));
  const { groups } = nameLayer(envFor(docs, {}, 3), docs, "");
  assert.equal(groups.length, 1);
  assert.equal(groups[0].oversize, true);
  assert.equal(groups[0].why.key, "releaseBoard.org.why.oversize");
});

test("a part left under the minimum after a cut goes back to the loose documents", () => {
  // Three in folder a make a part; the one in folder b is under MIN (2) and is released.
  const docs = [...["one", "two", "three"].map((n) => d(`a/pay_${n}.md`)), d("b/pay_four.md")];
  const { groups, rest } = nameLayer(envFor(docs, {}, 3), docs, "");
  assert.ok(byId(groups, "app:stem:pay/a"));
  assert.deepEqual(rest.map((x) => x.path), ["b/pay_four.md"]);
});

test("empty input gives no groups and no rest", () => {
  assert.deepEqual(nameLayer(envFor([]), [], ""), { groups: [], rest: [] });
});
