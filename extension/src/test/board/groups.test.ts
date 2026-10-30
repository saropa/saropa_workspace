// Groups: manual groups, shared name prefixes, shared source files, hubs and exclusions.

import { test } from "node:test";
import assert from "node:assert/strict";
import { GroupInput, buildGroups } from "../../board/groups";

function doc(project: string, path: string, extra: Partial<GroupInput> = {}): GroupInput {
  return { key: `${project}\t${path}`, project, path, words: 100, docRefs: 0, sourceFiles: [], ...extra };
}
const key = (project: string, path: string): string => `${project}\t${path}`;

test("documents with the same name prefix in one project form a named group", () => {
  const r = buildGroups([doc("app", "docs/OWNER_a.md"), doc("app", "docs/OWNER_b.md"), doc("app", "docs/lone.md")]);
  const g = r.groupOf.get(key("app", "docs/OWNER_a.md"));
  assert.equal(g?.name, "Owner documents");
  assert.equal(r.groupOf.get(key("app", "docs/OWNER_b.md"))?.id, g?.id);
  assert.equal(r.groupOf.has(key("app", "docs/lone.md")), false, "a group needs two or more documents");
});

test("a date prefix is ignored when reading the name prefix", () => {
  const r = buildGroups([doc("app", "20260101_HANDOVER_x.md"), doc("app", "20260202_HANDOVER_y.md")]);
  assert.equal(r.groupOf.get(key("app", "20260101_HANDOVER_x.md"))?.name, "Handover documents");
});

test("the same prefix in two projects does not group them", () => {
  const r = buildGroups([doc("app", "OWNER_a.md"), doc("db", "OWNER_b.md")]);
  assert.equal(r.groupOf.size, 0);
});

test("a generic prefix such as PLAN says nothing", () => {
  const r = buildGroups([doc("app", "PLAN_a.md"), doc("app", "PLAN_b.md")]);
  assert.equal(r.groupOf.size, 0);
  const own = buildGroups([doc("app", "PLAN_a.md"), doc("app", "PLAN_b.md")], { genericPrefixes: [] });
  assert.equal(own.groupOf.size, 2);
});

test("a group listed by hand wins and keeps its own name", () => {
  const r = buildGroups(
    [doc("app", "docs/a.md"), doc("app", "docs/b.md"), doc("app", "OWNER_c.md"), doc("app", "OWNER_d.md")],
    { manual: [{ name: "Launch", match: ["app/docs/*.md", "app/OWNER_c.md"] }] }
  );
  assert.equal(r.groupOf.get(key("app", "docs/a.md"))?.name, "Launch");
  assert.equal(r.groupOf.get(key("app", "OWNER_c.md"))?.name, "Launch");
  assert.equal(r.groupOf.has(key("app", "OWNER_d.md")), false, "the other OWNER document is alone now");
});

test("an earlier manual group keeps a document a later one also matches", () => {
  const r = buildGroups(
    [doc("app", "a.md"), doc("app", "b.md"), doc("app", "c.md")],
    { manual: [{ name: "First", match: ["app/a.md", "app/b.md"] }, { name: "Second", match: ["app/**"] }] }
  );
  assert.equal(r.groupOf.get(key("app", "a.md"))?.name, "First");
  assert.equal(r.groupOf.get(key("app", "c.md"))?.name, "Second", "a group listed by hand shows with one document");
  assert.equal(r.groupOf.get(key("app", "c.md"))?.byUser, true);
});

test("two shared source files make a Related documents group; one does not", () => {
  const files = ["lib/a.dart", "lib/b.dart", "lib/c.dart"];
  const r = buildGroups([
    doc("app", "x.md", { sourceFiles: files }),
    doc("app", "y.md", { sourceFiles: files.slice(0, 2) }),
    doc("app", "z.md", { sourceFiles: ["lib/c.dart"] }),
  ]);
  assert.equal(r.groupOf.get(key("app", "x.md"))?.name, "Related documents");
  assert.equal(r.groupOf.get(key("app", "y.md"))?.id, r.groupOf.get(key("app", "x.md"))?.id);
  assert.equal(r.groupOf.has(key("app", "z.md")), false);
});

test("documents of different projects never share a file group", () => {
  const files = ["lib/a.dart", "lib/b.dart"];
  const r = buildGroups([doc("app", "x.md", { sourceFiles: files }), doc("db", "y.md", { sourceFiles: files })]);
  assert.equal(r.groupOf.size, 0);
});

test("a chain of overlaps does not grow into one giant group", () => {
  const mk = (i: number): GroupInput => doc("app", `d${i}.md`, { sourceFiles: [`f${i}`, `f${i + 1}`, `f${i + 2}`] });
  const r = buildGroups([0, 1, 2, 3, 4, 5].map(mk));
  const ids = new Set([...r.groupOf.values()].map((g) => g.id));
  assert.ok(ids.size >= 2, "the seed takes only its direct mates");
});

test("a group takes at most the configured number of file mates", () => {
  const shared = ["a", "b"];
  const docs = Array.from({ length: 6 }, (_, i) => doc("app", `d${i}.md`, { sourceFiles: shared }));
  const r = buildGroups(docs, { maxFileGroup: 3 });
  const sizes = new Map<string, number>();
  for (const g of r.groupOf.values()) {
    sizes.set(g.id, (sizes.get(g.id) ?? 0) + 1);
  }
  assert.ok([...sizes.values()].every((n) => n <= 3));
});

test("a hub is flagged and never merged by shared files", () => {
  const files = ["a", "b"];
  const r = buildGroups([
    doc("app", "big.md", { words: 25000, sourceFiles: files }),
    doc("app", "x.md", { sourceFiles: files }),
    doc("app", "y.md", { sourceFiles: files }),
    doc("app", "index.md", { docRefs: 30 }),
  ]);
  assert.deepEqual([...r.hubs].sort(), [key("app", "big.md"), key("app", "index.md")]);
  assert.equal(r.groupOf.has(key("app", "big.md")), false);
  assert.equal(r.groupOf.get(key("app", "x.md"))?.id, r.groupOf.get(key("app", "y.md"))?.id);
});

test("documents matching an ungrouped glob are left out, and are not hubs either", () => {
  const r = buildGroups([doc("app", "OWNER_a.md", { words: 99999 }), doc("app", "OWNER_b.md")], { ungrouped: ["app/OWNER_a.md"] });
  assert.equal(r.groupOf.size, 0);
  assert.equal(r.hubs.size, 0);
});

test("the hub limits can be changed", () => {
  const r = buildGroups([doc("app", "a.md", { words: 50 })], { hubWords: 50 });
  assert.ok(r.hubs.has(key("app", "a.md")));
});
