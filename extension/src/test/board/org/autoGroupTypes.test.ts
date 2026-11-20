// Covers the small helpers every auto-grouping layer shares: ordering, name cleaning, folder reading, ids and the
// group constructor. A layer that reads these wrongly would give unstable ids, which orphans stored overrides.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Env, G, byKey, cleanerOf, folderLabel, folderOf, make, push, scoped, subtree, why } from "../../../board/org/autoGroupTypes";
import { doc } from "./orgFixtures";

// `make` reads only the project from the environment, so a one-field stand-in is enough here.
const env = { project: "app" } as Env;
const w = why("test", {});

test("byKey: orders by key, so any arrival order gives the same list", () => {
  const docs = [doc("p", "b.md"), doc("p", "a.md"), doc("p", "c.md")];
  assert.deepEqual([...docs].sort(byKey).map((d) => d.path), ["a.md", "b.md", "c.md"]);
  assert.equal(byKey(docs[0], docs[0]), 0);
});

test("cleanerOf: leaving nothing after cleaning falls back to the trimmed raw text", () => {
  assert.equal(cleanerOf()("v2"), "v2");
});

test("cleanerOf: keeps a configured acronym upper-case", () => {
  assert.match(cleanerOf({ acronyms: ["API"] })("api gateway"), /^API\b/);
});

test("folderOf: drops status folders from the logical path", () => {
  assert.equal(folderOf(doc("p", "docs/archive/auth/a.md")), "docs/auth");
});

test("folderOf: a custom status set decides which folders are dropped", () => {
  assert.equal(folderOf(doc("p", "docs/archive/auth/a.md"), new Set(["auth"])), "docs/archive");
});

test("folderOf: a document at the root has no folder", () => {
  assert.equal(folderOf(doc("p", "a.md")), "");
});

test("scoped: prefixes the context, or gives the bare key for the root", () => {
  assert.equal(scoped("docs/auth", "login"), "docs/auth/login");
  assert.equal(scoped("", "login"), "login");
});

test("why: builds the message key under the org reasons, high and inferred by default", () => {
  assert.deepEqual(why("stem", { n: 3 }), { key: "releaseBoard.org.why.stem", params: { n: 3 }, source: "inference", confidence: "high" });
  assert.deepEqual(why("stem", {}, "low", "rules"), { key: "releaseBoard.org.why.stem", params: {}, source: "rules", confidence: "low" });
});

test("push: makes the list for a new key and appends to an existing one", () => {
  const m = new Map<string, number[]>();
  push(m, "a", 1);
  push(m, "a", 2);
  push(m, "b", 3);
  assert.deepEqual([...m.entries()], [["a", [1, 2]], ["b", [3]]]);
});

test("folderLabel: uses the folder's own name", () => {
  assert.equal(folderLabel("docs/auth"), "auth");
});

test("folderLabel: skips container folders for the nearest meaningful parent", () => {
  assert.equal(folderLabel("auth/docs"), "auth");
});

test("folderLabel: a path of only containers keeps the last segment, and an empty path gives an empty label", () => {
  assert.equal(folderLabel("docs/notes"), "notes");
  assert.equal(folderLabel(""), "");
});

test("folderLabel: a custom container set replaces the shipped words", () => {
  assert.equal(folderLabel("docs/auth", new Set(["auth"])), "docs");
});

test("make: the id comes from project, kind and key, never from a member", () => {
  const g = make("stem", env, "login", "login", "Login", "docs", [doc("p", "b.md")], w);
  assert.equal(g.id, "app:stem:login");
  assert.equal(g.kind, "stem");
  assert.equal(g.name, "Login");
  assert.equal(g.rawName, "login");
  assert.equal(g.folder, "docs");
  assert.deepEqual(g.subs, []);
  assert.equal(g.oversize, false);
  assert.equal(g.why, w);
});

test("make: members are sorted by key and the caller's list is not reordered", () => {
  const input = [doc("p", "b.md"), doc("p", "a.md")];
  const g = make("folder", env, "k", "k", "K", "", input, w);
  assert.deepEqual(g.docs.map((d) => d.path), ["a.md", "b.md"]);
  assert.deepEqual(input.map((d) => d.path), ["b.md", "a.md"]);
});

test("subtree: gathers the documents of a group and of every group under it", () => {
  const leaf = make("stem", env, "leaf", "leaf", "Leaf", "", [doc("p", "c.md")], w);
  const mid: G = { ...make("folder", env, "mid", "mid", "Mid", "", [doc("p", "b.md")], w), subs: [leaf] };
  const top: G = { ...make("folder", env, "top", "top", "Top", "", [doc("p", "a.md")], w), subs: [mid] };
  assert.deepEqual(subtree(top).map((d) => d.path), ["a.md", "b.md", "c.md"]);
  assert.deepEqual(subtree(leaf).map((d) => d.path), ["c.md"]);
});
