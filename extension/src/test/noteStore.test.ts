import { test } from "node:test";
import assert from "node:assert/strict";
import { ensureNoteExtension } from "../model/noteStore";

test("ensureNoteExtension appends .md when no extension present", () => {
  assert.equal(ensureNoteExtension("standup-checklist"), "standup-checklist.md");
  assert.equal(ensureNoteExtension("notes"), "notes.md");
  assert.equal(ensureNoteExtension("a"), "a.md");
});

test("ensureNoteExtension preserves an explicit extension", () => {
  assert.equal(ensureNoteExtension("query.sql"), "query.sql");
  assert.equal(ensureNoteExtension("scratch.json"), "scratch.json");
  assert.equal(ensureNoteExtension("log.txt"), "log.txt");
  assert.equal(ensureNoteExtension("notes.md"), "notes.md");
});

test("ensureNoteExtension handles edge cases with dots", () => {
  assert.equal(ensureNoteExtension(".gitignore"), ".gitignore");
  assert.equal(ensureNoteExtension("file.name.md"), "file.name.md");
  assert.equal(ensureNoteExtension("v1.2.3"), "v1.2.3");
});
