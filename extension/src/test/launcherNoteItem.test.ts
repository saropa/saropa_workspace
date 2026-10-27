// Unit tests for the Notes-pane launcher row builder.

import { test } from "node:test";
import assert from "node:assert/strict";
import { noteLauncherItem } from "../views/launcherNoteItem";

const note = { path: "/n/todo.md", filename: "todo.md", scope: "project" as const, relative: ".notes/todo.md", preview: "first line" };

test("label drops the extension and the preview becomes the description", () => {
  const item = noteLauncherItem(note);
  assert.equal(item.label, "todo");
  assert.equal(item.desc, "first line");
  assert.equal(item.sub, ".notes/todo.md");
  assert.equal(item.pane, "notes");
});

test("an empty preview yields no description", () => {
  assert.equal(noteLauncherItem({ ...note, preview: "" }).desc, undefined);
});

test("only the last extension is stripped", () => {
  assert.equal(noteLauncherItem({ ...note, filename: "a.b.md" }).label, "a.b");
  assert.equal(noteLauncherItem({ ...note, filename: "README" }).label, "README");
});

test("project and global notes get distinct sections, groups and glyphs", () => {
  const p = noteLauncherItem(note);
  const g = noteLauncherItem({ ...note, scope: "global" });
  assert.equal(p.section, "Project Notes");
  assert.equal(g.section, "Global Notes");
  assert.equal(p.groupId, "notes:project");
  assert.equal(g.groupId, "notes:global");
  assert.equal(p.groupIcon, "note");
  assert.equal(g.groupIcon, "globe");
});
