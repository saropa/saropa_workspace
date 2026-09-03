// Unit tests for the canonical byte-size formatter (utils/formatBytes.ts). Moved here
// as its own test file when the metric-badge and process-monitor copies were
// consolidated into one implementation (BUG-012) — these cases used to be split
// (and, for one value, disagreed) across metricFormat.test.ts and processPoll.test.ts.

import { test } from "node:test";
import assert from "node:assert/strict";
import { formatBytes } from "../utils/formatBytes";

test("formatBytes renders zero and bytes without a decimal", () => {
  assert.equal(formatBytes(0), "0 B");
  assert.equal(formatBytes(512), "512 B");
  assert.equal(formatBytes(1023), "1023 B");
});

test("formatBytes scales to KB / MB / GB with one decimal under 100", () => {
  assert.equal(formatBytes(1024), "1.0 KB");
  assert.equal(formatBytes(1536), "1.5 KB");
  assert.equal(formatBytes(250 * 1024), "250 KB");
  assert.equal(formatBytes(1024 * 1024 * 1.4), "1.4 MB");
  assert.equal(formatBytes(5 * 1024 * 1024), "5.0 MB");
  assert.equal(formatBytes(1024 * 1024 * 1024), "1.0 GB");
});

test("formatBytes drops the decimal at or above 100 of a unit", () => {
  // 150 KB reads "150 KB", not "150.0 KB" — the decimal is noise at that magnitude.
  assert.equal(formatBytes(1024 * 150), "150 KB");
  // The old metricFormat.ts copy used a <10 threshold and would have rendered this as
  // "20 KB"; the canonical >=100 threshold renders the decimal instead. Intentional
  // behavior pick during consolidation (see utils/formatBytes.ts's header comment).
  assert.equal(formatBytes(20 * 1024), "20.0 KB");
});

test("formatBytes falls back to 0 B for non-finite input", () => {
  // NaN <= 0 is false, so the old guard let a bad upstream measurement (e.g. a
  // failed stat() coerced to NaN) through to render the literal string "NaN B".
  // Infinity/-Infinity hit the same gap from the other direction.
  assert.equal(formatBytes(NaN), "0 B");
  assert.equal(formatBytes(Infinity), "0 B");
  assert.equal(formatBytes(-Infinity), "0 B");
});
