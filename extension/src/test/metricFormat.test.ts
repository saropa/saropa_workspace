// Unit tests for the pure live-metric helpers (formatBytes / countLines / parseSize).
// These carry NO VS Code dependency by design, so they run under Node's built-in test
// runner without the extension host — the test entry is esbuild-bundled to out/test
// and executed with `node --test` (see the test:unit script).

import { test } from "node:test";
import assert from "node:assert/strict";
import { formatBytes, countLines, parseSize } from "../exec/metricFormat";

// Build a byte buffer from a string for the line-count cases.
function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

test("formatBytes: under 1 KB stays in bytes", () => {
  assert.equal(formatBytes(0), "0 B");
  assert.equal(formatBytes(512), "512 B");
  assert.equal(formatBytes(1023), "1023 B");
});

test("formatBytes: KB/MB/GB use binary 1024 steps", () => {
  assert.equal(formatBytes(1024), "1.0 KB");
  assert.equal(formatBytes(250 * 1024), "250 KB");
  assert.equal(formatBytes(5 * 1024 * 1024), "5.0 MB");
  assert.equal(formatBytes(1024 * 1024 * 1024), "1.0 GB");
});

test("formatBytes: one decimal below 10 of a unit, whole numbers above", () => {
  assert.equal(formatBytes(1536), "1.5 KB"); // 1.5 KB -> one decimal
  assert.equal(formatBytes(20 * 1024), "20 KB"); // >= 10 -> no decimal
});

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
