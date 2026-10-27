// Unit tests for the host-side HTML escaper (text nodes and quoted attributes).

import { test } from "node:test";
import assert from "node:assert/strict";
import { escapeHtml } from "../utils/escapeHtml";

test("escapes all five HTML-significant characters", () => {
  assert.equal(escapeHtml(`&<>"'`), "&amp;&lt;&gt;&quot;&#39;");
});

test("leaves plain text untouched", () => {
  assert.equal(escapeHtml("hello world 123"), "hello world 123");
  assert.equal(escapeHtml(""), "");
});

test("text that already looks like an entity is escaped literally, so it displays as typed", () => {
  assert.equal(escapeHtml("&lt;"), "&amp;lt;");
});

test("each character is escaped exactly once in one pass", () => {
  assert.equal(escapeHtml("a&b<c"), "a&amp;b&lt;c");
  assert.equal(escapeHtml("<<"), "&lt;&lt;");
});

test("neutralizes a script tag and an attribute breakout", () => {
  assert.equal(escapeHtml("<script>alert(1)</script>"), "&lt;script&gt;alert(1)&lt;/script&gt;");
  assert.equal(escapeHtml(`" onload="x`), "&quot; onload=&quot;x");
});
