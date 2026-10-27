// In progress: which documents are listed, in what order, and the small path helpers the host uses.

import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_IN_PROGRESS_MAX, clampInProgressMax, editedKey, parsePorcelainZ, pickInProgress, relativeUnder, underPrefix } from "../../board/inProgress";
import { BoardItem } from "../../board/boardModel";

const item = (id: number, path: string, status: BoardItem["status"], project = "app"): BoardItem => ({
  id,
  project,
  path,
  title: path,
  status,
  kind: "",
  hub: false,
  blocksCount: 0,
  waitsOn: [],
  pinned: false,
  stopping: false,
});

test("the limit stays between 1 and 50 and falls back to 15", () => {
  assert.equal(DEFAULT_IN_PROGRESS_MAX, 15);
  assert.equal(clampInProgressMax(0), 1);
  assert.equal(clampInProgressMax(-4), 1);
  assert.equal(clampInProgressMax(51), 50);
  assert.equal(clampInProgressMax(7.6), 8);
  assert.equal(clampInProgressMax("12"), 12);
  assert.equal(clampInProgressMax("x"), 15);
  assert.equal(clampInProgressMax(undefined), 15);
  assert.equal(clampInProgressMax(NaN), 15);
});

test("edited documents come first, then documents marked in progress, each once", () => {
  const items = [item(0, "bugs/a.md", "red"), item(1, "docs/p.md", "purple"), item(2, "docs/b.md", "amber"), item(3, "docs/q.md", "purple"), item(4, "bugs/c.md", "red")];
  const edited = new Set([editedKey("app", "docs/b.md"), editedKey("app", "docs/p.md"), editedKey("app", "nothing.md")]);
  assert.deepEqual(pickInProgress(items, edited, 15), { ids: [1, 2, 3], more: 0, editing: 2 });
});

test("a document of another project with the same path is not taken for an edited one", () => {
  const items = [item(0, "docs/a.md", "red", "db"), item(1, "docs/a.md", "red", "app")];
  assert.deepEqual(pickInProgress(items, new Set([editedKey("app", "docs/a.md")]), 15), { ids: [1], more: 0, editing: 1 });
});

test("the list is cut at the limit and the rest is counted", () => {
  const items = Array.from({ length: 40 }, (_x, i) => item(i, `docs/${i}.md`, "amber"));
  const edited = new Set(items.map((i) => editedKey(i.project, i.path)));
  const v = pickInProgress(items, edited, 15);
  assert.equal(v.ids.length, 15);
  assert.deepEqual(v.ids, Array.from({ length: 15 }, (_x, i) => i));
  assert.equal(v.more, 25);
  assert.equal(v.editing, 15);
  assert.equal(pickInProgress(items, edited, 500).more, 0, "a limit of 50 lists all 40");
  assert.equal(pickInProgress(items, edited, 500).ids.length, 40);
  assert.equal(pickInProgress(items, edited, 0).ids.length, 1);
});

test("hundreds of marked documents are cut, not listed", () => {
  const items = Array.from({ length: 300 }, (_x, i) => item(i, `docs/${i}.md`, "purple"));
  const v = pickInProgress(items, new Set(), 15);
  assert.equal(v.ids.length, 15);
  assert.equal(v.more, 285);
  assert.equal(v.editing, 0);
});

test("nothing edited and nothing marked is an empty list", () => {
  assert.deepEqual(pickInProgress([item(0, "a.md", "red")], new Set(), 15), { ids: [], more: 0, editing: 0 });
});

test("a file is made relative to the project folder it sits in", () => {
  assert.equal(relativeUnder("/w/app", "/w/app/docs/a.md"), "docs/a.md");
  assert.equal(relativeUnder("/w/app/", "/w/app/docs/a.md"), "docs/a.md");
  assert.equal(relativeUnder("C:\\w\\app", "C:\\w\\app\\docs\\a.md"), "docs/a.md");
  assert.equal(relativeUnder("/w/app", "/w/app"), undefined);
  assert.equal(relativeUnder("/w/app", "/w/application/a.md"), undefined, "a folder with the same start is not the same folder");
  assert.equal(relativeUnder("/w/app", "/x/a.md"), undefined);
  assert.equal(relativeUnder("C:\\W\\App", "c:\\w\\app\\Docs\\a.md", true), "Docs/a.md");
  assert.equal(relativeUnder("C:\\W\\App", "c:\\w\\app\\Docs\\a.md", false), undefined);
});

test("git status output is read as paths, renames count both names", () => {
  assert.deepEqual(parsePorcelainZ(" M docs/a.md\0?? docs/new file.md\0A  b.md\0"), ["docs/a.md", "docs/new file.md", "b.md"]);
  assert.deepEqual(parsePorcelainZ("R  new.md\0old.md\0 M x.md\0"), ["new.md", "old.md", "x.md"]);
  assert.deepEqual(parsePorcelainZ(""), []);
  assert.deepEqual(parsePorcelainZ("\0\0"), []);
});

test("paths are made relative to git's prefix and others are dropped", () => {
  assert.deepEqual(underPrefix(["app/docs/a.md", "other/b.md", "app/c.md"], "app/\n"), ["docs/a.md", "c.md"]);
  assert.deepEqual(underPrefix(["a.md"], ""), ["a.md"]);
});
