// Extra projects of the Release Board: cleaning the user's list, telling a project folder from
// any other, and turning a folder's own rules file into projects. Pure.

import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_EXTRA_PROJECTS, addProjectPaths, asScope, candidateChildren, cleanProjectPaths, folderKey, folderName, folderProjects, insidePath, looksLikeProject, skippedRows } from "../../board/extraProjects";

test("the scope setting reads openOnly and treats everything else as all", () => {
  assert.equal(asScope("openOnly"), "openOnly");
  assert.equal(asScope("all"), "all");
  assert.equal(asScope(undefined), "all");
  assert.equal(asScope("OpenOnly"), "all");
});

test("folder keys drop a trailing separator and a doubled one, and lower-case a drive letter", () => {
  assert.equal(folderKey("/work/app/"), "/work/app");
  assert.equal(folderKey("/work//app"), "/work/app");
  assert.equal(folderKey("/"), "/");
  assert.equal(folderKey("C:\\Work\\App\\"), "c:\\Work\\App");
});

test("the list keeps absolute text paths in order and drops the rest", () => {
  const raw = ["/a/one", 5, null, "relative/dir", "", "  /a/two  ", "/a/one/", "/a/open", "/bad\npath", "D:\\x"];
  const r = cleanProjectPaths(raw, ["/a/open"]);
  assert.deepEqual(r.paths, ["/a/one", "/a/two", "d:\\x"]);
  assert.deepEqual(r.over, []);
});

test("a value that is not a list reads as empty", () => {
  assert.deepEqual(cleanProjectPaths("/a/one", []).paths, []);
  assert.deepEqual(cleanProjectPaths(undefined, []).paths, []);
  assert.deepEqual(cleanProjectPaths({ 0: "/a" }, []).paths, []);
});

test("past the limit the rest are returned apart", () => {
  const raw = Array.from({ length: MAX_EXTRA_PROJECTS + 3 }, (_, i) => `/p/${i}`);
  const r = cleanProjectPaths(raw, []);
  assert.equal(r.paths.length, MAX_EXTRA_PROJECTS);
  assert.deepEqual(r.over, [`/p/${MAX_EXTRA_PROJECTS}`, `/p/${MAX_EXTRA_PROJECTS + 1}`, `/p/${MAX_EXTRA_PROJECTS + 2}`]);
  assert.equal(r.paths[0], "/p/0");
});

test("adding keeps the old order, skips repeats and open folders, and counts what is new", () => {
  const r = addProjectPaths(["/a", "/b"], ["/b", "/c/", "/open", "/d"], ["/open"]);
  assert.deepEqual(r.paths, ["/a", "/b", "/c", "/d"]);
  assert.equal(r.added, 2);
  assert.equal(addProjectPaths(["/a"], ["/a"], []).added, 0);
});

test("adding stops at the limit", () => {
  const have = Array.from({ length: MAX_EXTRA_PROJECTS - 1 }, (_, i) => `/p/${i}`);
  const r = addProjectPaths(have, ["/x", "/y"], []);
  assert.equal(r.paths.length, MAX_EXTRA_PROJECTS);
  assert.equal(r.added, 1);
  assert.equal(r.paths[MAX_EXTRA_PROJECTS - 1], "/x");
});

test("a folder name is the last part of its path", () => {
  assert.equal(folderName("/work/app/"), "app");
  assert.equal(folderName("C:\\work\\Tool"), "Tool");
});

test("a folder looks like a project with .git, .saropa, plans, docs or bugs", () => {
  const dir = (name: string, link = false) => ({ name, dir: true, link });
  assert.equal(looksLikeProject([dir(".git")]), true);
  assert.equal(looksLikeProject([{ name: ".git", dir: false }]), true, "a git file marks a worktree or submodule");
  assert.equal(looksLikeProject([dir(".saropa")]), true);
  assert.equal(looksLikeProject([dir("Plans")]), true);
  assert.equal(looksLikeProject([dir("docs")]), true);
  assert.equal(looksLikeProject([dir("bugs")]), true);
  assert.equal(looksLikeProject([dir("src"), { name: "docs", dir: false }, { name: "readme.md", dir: false }]), false);
  assert.equal(looksLikeProject([dir("docs", true)]), false, "a link is not followed");
  assert.equal(looksLikeProject([]), false);
});

test("child folders worth looking in: real, not hidden, not node_modules, sorted and capped", () => {
  const kids = [
    { name: "zeta", dir: true },
    { name: "alpha", dir: true },
    { name: ".cache", dir: true },
    { name: "node_modules", dir: true },
    { name: "linked", dir: true, link: true },
    { name: "notes.txt", dir: false },
    { name: "mid", dir: true },
  ];
  assert.deepEqual(candidateChildren(kids), { names: ["alpha", "mid", "zeta"], cut: 0 });
  assert.deepEqual(candidateChildren(kids, 2), { names: ["alpha", "mid"], cut: 1 });
});

test("a path from a rules file stays inside its folder", () => {
  assert.equal(insidePath(""), "");
  assert.equal(insidePath("."), "");
  assert.equal(insidePath("./web/"), "web");
  assert.equal(insidePath("web\\app"), "web/app");
  assert.equal(insidePath("a/../b"), "b");
  assert.equal(insidePath(".."), undefined);
  assert.equal(insidePath("../x"), undefined);
  assert.equal(insidePath("a/../../x"), undefined);
  assert.equal(insidePath("/etc"), undefined);
  assert.equal(insidePath("C:\\x"), undefined);
  assert.equal(insidePath(7), undefined);
});

function input(parsed: Record<string, unknown> | undefined, used = new Set<string>(["app"])): Parameters<typeof folderProjects>[0] {
  return {
    id: "tool",
    name: "tool",
    uri: "file:///work/tool",
    join: (rel) => `file:///work/tool/${rel}`,
    roots: ["docs"],
    defaultSets: ["folder-states", "reference-docs"],
    parsed,
    uniqueId: (n) => {
      let id = n;
      for (let i = 2; used.has(id); i++) {
        id = `${n}-${i}`;
      }
      used.add(id);
      return id;
    },
  };
}

test("a folder without a rules file is one project over the default rule sets", () => {
  const r = folderProjects(input(undefined));
  assert.deepEqual(r.projects, [{ id: "tool", name: "tool", path: "file:///work/tool", roots: ["docs"], ruleSets: ["folder-states", "reference-docs"], extra: true }]);
  assert.deepEqual(r.ruleSets, {});
});

test("a rules file with no project list changes only the rule sets, which stay with this folder", () => {
  const r = folderProjects(input({ ruleSets: { "folder-states": { description: "mine" } } }));
  assert.deepEqual(r.projects[0].ruleSets, ["tool:folder-states", "reference-docs"]);
  assert.deepEqual(Object.keys(r.ruleSets), ["tool:folder-states"]);
  assert.equal(r.ruleSets["tool:folder-states"].description, "mine");
});

test("a rules file that lists projects makes each one a project inside the folder", () => {
  const r = folderProjects(
    input({
      ruleSets: { custom: {} },
      projects: [
        { id: "web", path: "web", roots: ["docs", "../escape", "/abs"], ruleSets: ["custom", "doc-kinds"], importance: "high" },
        { id: "app", path: ".", roots: ["plans"], ruleSets: [] },
        { id: "evil", path: "../elsewhere", roots: [], ruleSets: [] },
        "not an object",
      ],
    })
  );
  assert.deepEqual(
    r.projects.map((p) => [p.id, p.path, p.roots, p.ruleSets, p.importance, p.extra]),
    [
      ["web", "file:///work/tool/web", ["docs"], ["tool:custom", "doc-kinds"], "high", true],
      ["app-2", "file:///work/tool", ["plans"], [], undefined, true],
    ]
  );
});

test("a project list with nothing usable falls back to the folder itself", () => {
  const r = folderProjects(input({ projects: [{ id: "evil", path: "/etc", roots: [], ruleSets: [] }] }));
  assert.deepEqual(r.projects.map((p) => [p.id, p.path]), [["tool", "file:///work/tool"]]);
});

test("skipped rows carry the folder name and the reason, never the path", () => {
  assert.deepEqual(skippedRows([{ path: "/secret/place/gone", reason: "missing" }]), [{ name: "gone", reason: "missing" }]);
});
