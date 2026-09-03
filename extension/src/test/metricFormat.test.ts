// Unit tests for the pure live-metric helpers (countLines / parseSize). formatBytes
// used to be tested here too; it moved to test/formatBytes.test.ts alongside the
// other consolidated call sites when the four near-identical implementations were
// merged into utils/formatBytes.ts (BUG-012). These carry NO VS Code dependency by
// design, so they run under Node's built-in test runner without the extension host —
// the test entry is esbuild-bundled to out/test and executed with `node --test` (see
// the test:unit script).

import { test } from "node:test";
import assert from "node:assert/strict";
import { countLines, parseSize } from "../exec/metricFormat";

// Build a byte buffer from a string for the line-count cases.
function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

test("countLines: empty file is zero", () => {
  assert.equal(countLines(bytes("")), 0);
});

test("countLines: a final line without a trailing newline still counts", () => {
  assert.equal(countLines(bytes("one")), 1);
  assert.equal(countLines(bytes("one\ntwo")), 2);
});

test("countLines: a trailing newline does not add a phantom line", () => {
  assert.equal(countLines(bytes("one\ntwo\n")), 2);
});

test("countLines: CRLF is counted by its LF", () => {
  assert.equal(countLines(bytes("a\r\nb\r\n")), 2);
});

test("parseSize: a bare number is bytes", () => {
  assert.equal(parseSize("250"), 250);
  assert.equal(parseSize("0"), 0);
});

test("parseSize: units use binary 1024 steps, case- and space-insensitive", () => {
  assert.equal(parseSize("250kb"), 250 * 1024);
  assert.equal(parseSize("250 KB"), 250 * 1024);
  assert.equal(parseSize("5mb"), 5 * 1024 * 1024);
  assert.equal(parseSize("1gb"), 1024 * 1024 * 1024);
  assert.equal(parseSize("1g"), 1024 * 1024 * 1024); // short unit form
});

test("parseSize: a fractional value rounds to whole bytes", () => {
  assert.equal(parseSize("1.5kb"), Math.round(1.5 * 1024));
});

test("parseSize: garbage and negatives are rejected", () => {
  assert.equal(parseSize(""), undefined);
  assert.equal(parseSize("abc"), undefined);
  assert.equal(parseSize("-5kb"), undefined);
  assert.equal(parseSize("5 zb"), undefined); // unknown unit
});
