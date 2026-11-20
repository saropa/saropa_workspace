// Covers readFrontMatter: the three keys read (tags, group, needs) in inline and block list forms, quoting,
// and the cases where a block is ignored (missing, unclosed, not YAML, or past the line cap).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFrontMatter } from "../../../board/org/frontMatter";

test("readFrontMatter: reads inline tags, a group and needs", () => {
  const r = readFrontMatter("---\ntags: [a, b]\ngroup: Payments\nneeds: x.md\n---\n# Body");
  assert.deepEqual(r.tags, ["a", "b"]);
  assert.equal(r.group, "Payments");
  assert.deepEqual(r.needs, ["x.md"]);
});

test("readFrontMatter: reads block lists and strips quotes from items", () => {
  const r = readFrontMatter("---\ntags:\n  - a\n  - 'b'\n  - \"c d\"\nneeds:\n  - one.md\n  - two.md\n---\n");
  assert.deepEqual(r.tags, ["a", "b", "c d"]);
  assert.deepEqual(r.needs, ["one.md", "two.md"]);
});

test("readFrontMatter: a block list ends at the next key", () => {
  const r = readFrontMatter("---\nneeds:\n  - a.md\ngroup: G\n---\n");
  assert.deepEqual(r.needs, ["a.md"]);
  assert.equal(r.group, "G");
});

test("readFrontMatter: tag and Tags are read like tags, keys being case-insensitive", () => {
  assert.deepEqual(readFrontMatter("---\ntag: solo\n---\n").tags, ["solo"]);
  assert.deepEqual(readFrontMatter("---\nTags: [x]\n---\n").tags, ["x"]);
});

test("readFrontMatter: repeated keys add up instead of replacing", () => {
  const r = readFrontMatter("---\ntags: [a]\ntags: [b]\n---\n");
  assert.deepEqual(r.tags, ["a", "b"]);
});

test("readFrontMatter: empty list items are dropped", () => {
  assert.deepEqual(readFrontMatter("---\ntags: [a, , b]\n---\n").tags, ["a", "b"]);
});

test("readFrontMatter: a quoted group loses its quotes and an empty group is unset", () => {
  assert.equal(readFrontMatter("---\ngroup: \"My Group\"\n---\n").group, "My Group");
  // An empty value must read as no group at all, not as an empty-named group.
  assert.equal(readFrontMatter("---\ngroup:\n---\n").group, undefined);
});

test("readFrontMatter: keys it does not read are ignored without failing the block", () => {
  const r = readFrontMatter("---\ntitle: Something\ntags: [a]\n---\n");
  assert.deepEqual(r.tags, ["a"]);
  assert.equal(r.group, undefined);
});

test("readFrontMatter: a document with no block gives the empty result", () => {
  const r = readFrontMatter("# Just a heading\n\ntags: [a]\n");
  assert.deepEqual(r.tags, []);
  assert.deepEqual(r.needs, []);
  assert.equal(r.group, undefined);
});

test("readFrontMatter: empty text and an empty block give the empty result", () => {
  assert.deepEqual(readFrontMatter("").tags, []);
  const r = readFrontMatter("---\n---\n");
  assert.deepEqual(r.tags, []);
  assert.deepEqual(r.needs, []);
});

test("readFrontMatter: the opening marker must be the first line", () => {
  assert.deepEqual(readFrontMatter("\n---\ntags: [a]\n---\n").tags, []);
});

test("readFrontMatter: a block that never closes is ignored", () => {
  assert.deepEqual(readFrontMatter("---\ntags: [a]\n# no end\n").tags, []);
});

test("readFrontMatter: a three-dot line closes the block like three dashes", () => {
  assert.deepEqual(readFrontMatter("---\ntags: [a]\n...\n").tags, ["a"]);
});

test("readFrontMatter: a block holding a line that is not YAML is ignored whole", () => {
  // The valid tags line above it must not leak out of a block that is not trustworthy.
  const r = readFrontMatter("---\ntags: [a]\nthis is prose with no colon\n---\n");
  assert.deepEqual(r.tags, []);
});

test("readFrontMatter: a leading byte-order mark and Windows line endings are tolerated", () => {
  const r = readFrontMatter("﻿---\r\ntags: [a]\r\ngroup: G\r\n---\r\n");
  assert.deepEqual(r.tags, ["a"]);
  assert.equal(r.group, "G");
});

test("readFrontMatter: comments and blank lines inside the block are allowed", () => {
  const r = readFrontMatter("---\n# a comment\n\ntags: [a]\n---\n");
  assert.deepEqual(r.tags, ["a"]);
});

test("readFrontMatter: only the first 100 lines are read, so a closer past that is never found", () => {
  const filler = (n: number): string => Array.from({ length: n }, () => "# x").join("\n");
  // Line 0 opens, line 1 holds the tag, closer at line 99: the last line that is read.
  const within = `---\ntags: a\n${filler(97)}\n---\nbody`;
  assert.deepEqual(readFrontMatter(within).tags, ["a"]);
  // Closer at line 100 is cut off by the cap, so the block counts as unclosed.
  const beyond = `---\ntags: a\n${filler(98)}\n---\nbody`;
  assert.deepEqual(readFrontMatter(beyond).tags, []);
});
