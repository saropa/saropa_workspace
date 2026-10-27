// Suggested links: a document that names exactly one other open document of its project.

import { test } from "node:test";
import assert from "node:assert/strict";
import { inferLinks, suggestionKey } from "../../board/inferred";

const none: ReadonlySet<string> = new Set();

test("the key names both documents of one project", () => {
  assert.equal(suggestionKey("app", "a.md", "b.md"), "app/a.md->app/b.md");
});

test("a document naming another by file name suggests a link", () => {
  const out = inferLinks(
    [
      { project: "app", path: "docs/A.md", refs: ["B.md"] },
      { project: "app", path: "plans/B.md", refs: [] },
    ],
    none,
    none
  );
  assert.deepEqual(out, [{ fromProject: "app", fromPath: "docs/A.md", toPath: "plans/B.md", key: "app/docs/A.md->app/plans/B.md" }]);
});

test("the file name is matched without case and without its folder", () => {
  const out = inferLinks(
    [
      { project: "app", path: "A.md", refs: ["some/dir/b.MD"] },
      { project: "app", path: "B.md", refs: [] },
    ],
    none,
    none
  );
  assert.equal(out.length, 1);
  assert.equal(out[0].toPath, "B.md");
});

test("a name that fits two documents, none, or the document itself suggests nothing", () => {
  const items = [
    { project: "app", path: "a/X.md", refs: ["X.md", "ghost.md"] },
    { project: "app", path: "b/X.md", refs: [] },
    { project: "app", path: "c/X.md", refs: [] },
    { project: "app", path: "me.md", refs: ["me.md"] },
  ];
  assert.deepEqual(inferLinks(items, none, none), []);
});

test("documents of another project are never suggested", () => {
  const out = inferLinks(
    [
      { project: "app", path: "A.md", refs: ["B.md"] },
      { project: "db", path: "B.md", refs: [] },
    ],
    none,
    none
  );
  assert.deepEqual(out, []);
});

test("existing links and rejected suggestions are left out, and a pair is listed once", () => {
  const items = [
    { project: "app", path: "A.md", refs: ["B.md", "B.md", "docs/B.md"] },
    { project: "app", path: "B.md", refs: ["C.md"] },
    { project: "app", path: "C.md", refs: [] },
  ];
  assert.equal(inferLinks(items, none, none).length, 2);
  const linked = new Set([suggestionKey("app", "A.md", "B.md")]);
  const rejected = new Set([suggestionKey("app", "B.md", "C.md")]);
  assert.deepEqual(inferLinks(items, linked, rejected), []);
});

test("at most 50 suggestions are returned", () => {
  const items = Array.from({ length: 60 }, (_, i) => ({ project: "p", path: `f${i}.md`, refs: [`f${(i + 1) % 60}.md`] }));
  assert.equal(inferLinks(items, none, none).length, 50);
});
