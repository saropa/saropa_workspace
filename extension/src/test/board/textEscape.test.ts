import assert from "node:assert/strict";
import { test } from "node:test";
import { escapeCell, escapeRegExp } from "../../board/textEscape";

test("escapeRegExp escapes backslashes and metacharacters", () => {
  assert.equal(escapeRegExp("a\\b"), "a\\\\b");
  assert.equal(escapeRegExp("tool.poetry"), "tool\\.poetry");
  assert.equal(escapeRegExp("C:\\dir\\x+y"), "C:\\\\dir\\\\x\\+y");
});

test("escapeRegExp output matches only the literal text", () => {
  for (const name of ["a\\b", "my.crate", "x(1)", "a|b", "[z]"]) {
    const re = new RegExp(`^${escapeRegExp(name)}$`);
    assert.equal(re.test(name), true);
  }
  assert.equal(new RegExp(`^${escapeRegExp("a\\b")}$`).test("ab"), false);
  assert.equal(new RegExp(`^${escapeRegExp("a.c")}$`).test("abc"), false);
});

test("escapeCell escapes backslash before pipe and flattens line breaks", () => {
  assert.equal(escapeCell("a\\b"), "a\\\\b");
  assert.equal(escapeCell("a\\|b"), "a\\\\\\|b");
  assert.equal(escapeCell("C:\\dir\\f.md"), "C:\\\\dir\\\\f.md");
  assert.equal(escapeCell("x`y\nz"), "x y z");
});
