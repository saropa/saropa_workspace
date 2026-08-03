import { test } from "node:test";
import assert from "node:assert/strict";
import { ensureNoteExtension } from "../model/noteStore";
import { validateNoteName, hasBinaryContent } from "../commands/noteCommands";

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

test("validateNoteName accepts valid names", () => {
  assert.equal(validateNoteName("standup-checklist"), undefined);
  assert.equal(validateNoteName("my notes 2026"), undefined);
  assert.equal(validateNoteName("query.sql"), undefined);
  assert.equal(validateNoteName(".gitignore"), undefined);
});

test("validateNoteName rejects empty or whitespace-only names", () => {
  assert.notEqual(validateNoteName(""), undefined);
  assert.notEqual(validateNoteName("   "), undefined);
});

test("validateNoteName rejects invalid characters", () => {
  assert.notEqual(validateNoteName("foo/bar"), undefined);
  assert.notEqual(validateNoteName("foo\\bar"), undefined);
  assert.notEqual(validateNoteName("foo:bar"), undefined);
  assert.notEqual(validateNoteName('foo"bar'), undefined);
  assert.notEqual(validateNoteName("foo<bar"), undefined);
  assert.notEqual(validateNoteName("foo>bar"), undefined);
  assert.notEqual(validateNoteName("foo|bar"), undefined);
  assert.notEqual(validateNoteName("foo*bar"), undefined);
  assert.notEqual(validateNoteName("foo?bar"), undefined);
});

test("validateNoteName rejects trailing dots and spaces", () => {
  assert.notEqual(validateNoteName("notes."), undefined);
  assert.notEqual(validateNoteName("notes "), undefined);
});

test("validateNoteName rejects Windows reserved device names", () => {
  assert.notEqual(validateNoteName("con"), undefined);
  assert.notEqual(validateNoteName("CON"), undefined);
  assert.notEqual(validateNoteName("nul"), undefined);
  assert.notEqual(validateNoteName("NUL.md"), undefined);
  assert.notEqual(validateNoteName("com1"), undefined);
  assert.notEqual(validateNoteName("lpt9"), undefined);
  assert.notEqual(validateNoteName("AUX"), undefined);
  assert.notEqual(validateNoteName("prn.txt"), undefined);
});

test("validateNoteName allows names containing reserved words as substrings", () => {
  assert.equal(validateNoteName("console"), undefined);
  assert.equal(validateNoteName("nulify"), undefined);
  assert.equal(validateNoteName("com10"), undefined);
  assert.equal(validateNoteName("auxiliary"), undefined);
});

test("hasBinaryContent detects null bytes as binary", () => {
  assert.equal(hasBinaryContent(new Uint8Array([0x48, 0x69, 0x00, 0x21])), true);
  assert.equal(hasBinaryContent(new Uint8Array([0x00])), true);
});

test("hasBinaryContent accepts plain text", () => {
  assert.equal(hasBinaryContent(new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f])), false);
  assert.equal(hasBinaryContent(new Uint8Array([])), false);
});

test("hasBinaryContent only samples the first 8192 bytes", () => {
  const buf = new Uint8Array(16384).fill(0x41);
  buf[8192] = 0x00;
  assert.equal(hasBinaryContent(buf), false);
  buf[8191] = 0x00;
  assert.equal(hasBinaryContent(buf), true);
});

