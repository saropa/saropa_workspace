// The leaf of the rules-file editing code (ruleText) read directly: the object check, the indent
// finder, the parse for an edit and the write back. ruleAssign.test and losesData.test cover
// docGlob and losesData; this file covers the rest, plus the override key built on top of it.
// Pure text in, text out; no host needed.

import { test } from "node:test";
import assert from "node:assert/strict";
import { indentOf, isObject, parseForEdit, serialize } from "../../board/ruleText";
import { overrideKey } from "../../board/ruleSeverity";

test("isObject accepts plain objects and refuses null, arrays and scalars", () => {
  assert.equal(isObject({}), true);
  assert.equal(isObject({ a: 1 }), true);
  assert.equal(isObject(null), false);
  assert.equal(isObject([]), false);
  assert.equal(isObject("x"), false);
  assert.equal(isObject(3), false);
  assert.equal(isObject(undefined), false);
});

test("indentOf returns the first indented line's indent, else two spaces", () => {
  assert.equal(indentOf('{\n    "a": 1\n}'), "    ");
  assert.equal(indentOf('{\n\t"a": 1\n}'), "\t");
  assert.equal(indentOf('{"a":1}'), "  ");
  assert.equal(indentOf(""), "  ");
  // The first indented line wins even when a later one is indented differently.
  assert.equal(indentOf('{\n  "a": {\n      "b": 1\n  }\n}'), "  ");
});

test("parseForEdit treats a missing or whitespace-only file as a new file with a version", () => {
  for (const text of [undefined, "", "  \n\t "]) {
    const p = parseForEdit(text);
    assert.equal(p.ok, true);
    if (p.ok) {
      assert.deepEqual(p.doc, { version: 1 });
      assert.equal(p.blank, true);
      assert.equal(p.source, "");
    }
  }
});

test("parseForEdit keeps the source text and the parsed object of a valid file", () => {
  const text = '{\n  "version": 1,\n  "projects": []\n}\n';
  const p = parseForEdit(text);
  assert.equal(p.ok, true);
  if (p.ok) {
    assert.equal(p.blank, false);
    assert.equal(p.source, text);
    assert.deepEqual(p.doc, { version: 1, projects: [] });
  }
});

test("parseForEdit names why a file cannot be edited", () => {
  assert.deepEqual(parseForEdit("{ not json"), { ok: false, reason: "parse" });
  // Valid JSON that is not an object is the wrong shape, never overwritten.
  assert.deepEqual(parseForEdit("[1, 2]"), { ok: false, reason: "shape" });
  assert.deepEqual(parseForEdit('"text"'), { ok: false, reason: "shape" });
  assert.deepEqual(parseForEdit("null"), { ok: false, reason: "shape" });
  // A repeated key would lose the first value on a rewrite.
  assert.deepEqual(parseForEdit('{"a": 1, "a": 2}'), { ok: false, reason: "lossy" });
  // A whole number beyond the safe range cannot round-trip through a double.
  assert.deepEqual(parseForEdit('{"n": 12345678901234567890}'), { ok: false, reason: "lossy" });
});

test("serialize writes a new file with two-space indent and a final line end", () => {
  const out = serialize({ doc: { version: 1 }, blank: true, source: "" });
  assert.equal(out, '{\n  "version": 1\n}\n');
});

test("serialize keeps the indent of the source file", () => {
  const source = '{\n    "version": 1\n}\n';
  const out = serialize({ doc: { version: 2 }, blank: false, source });
  assert.equal(out, '{\n    "version": 2\n}\n');
});

test("serialize keeps Windows line ends and the final one", () => {
  const source = '{\r\n    "a": 1\r\n}\r\n';
  const out = serialize({ doc: { a: 2, b: { c: 3 } }, blank: false, source });
  assert.equal(out, '{\r\n    "a": 2,\r\n    "b": {\r\n        "c": 3\r\n    }\r\n}\r\n');
  // No bare line feed is left behind in a CRLF file.
  assert.equal(/[^\r]\n/.test(out), false);
});

test("serialize adds no final line end when the source had none", () => {
  const out = serialize({ doc: { a: 1 }, blank: false, source: '{"a":0}' });
  assert.equal(out.endsWith("\n"), false);
  assert.equal(out, '{\n  "a": 1\n}');
});

test("overrideKey joins project and path with a tab, which an id cannot hold", () => {
  assert.equal(overrideKey("app", "docs/a.md"), "app\tdocs/a.md");
  // Two different splits of the same text never collide.
  assert.notEqual(overrideKey("a", "b/c.md"), overrideKey("a/b", "c.md"));
});
