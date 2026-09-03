// Unit tests for the bounded background-run output accumulator (item 2.2: cap
// background output accumulation). Pure logic, no VS Code dependency, so the head/
// tail split, the truncation marker, and the "untouched under the cap" fast path are
// asserted directly under Node's built-in runner.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createBoundedCapture } from "../exec/outputCapture";

test("output under the cap is returned unchanged, chunk by chunk", () => {
  const capture = createBoundedCapture();
  capture.append("hello ");
  capture.append("world");
  assert.equal(capture.getCaptured(), "hello world", "small output is never truncated");
});

test("output at exactly the cap is returned unchanged", () => {
  const capture = createBoundedCapture();
  // 512KB head + 512KB tail = 1MB exactly; the boundary itself must not truncate.
  capture.append("a".repeat(512 * 1024));
  capture.append("b".repeat(512 * 1024));
  const result = capture.getCaptured();
  assert.equal(result.length, 1024 * 1024, "exactly-at-cap output is kept in full");
  assert.ok(!result.includes("truncated"), "no marker is inserted at the exact boundary");
});

test("output past the cap keeps the first and last bytes with a marker in between", () => {
  const capture = createBoundedCapture();
  capture.append("HEAD".repeat(200 * 1024)); // 800KB of head-only text
  capture.append("MIDDLE".repeat(200 * 1024)); // pushes well past the cap
  capture.append("TAIL".repeat(200 * 1024)); // 800KB of tail-only text
  const result = capture.getCaptured();
  assert.ok(result.startsWith("HEAD"), "the earliest output survives at the front");
  assert.ok(result.endsWith("TAIL"), "the most recent output survives at the back");
  assert.ok(result.includes("truncated"), "a marker is inserted for the dropped middle");
  // 1MB kept + the (short) marker text, well under the 800KB*3 raw total.
  assert.ok(result.length < 1024 * 1024 + 200, "the capture stays bounded near 1MB");
});

test("a single chunk larger than the whole cap still yields a bounded head+tail", () => {
  const capture = createBoundedCapture();
  // One 2MB chunk in a single append() call — must still split correctly rather than
  // only bounding on subsequent calls.
  capture.append("x".repeat(1024 * 1024) + "y".repeat(1024 * 1024));
  const result = capture.getCaptured();
  assert.ok(result.length < 2 * 1024 * 1024, "a single oversized chunk is still capped");
  assert.ok(result.includes("truncated"), "an oversized single chunk reports a marker");
});

test("the tail keeps sliding as more output arrives after the head is full", () => {
  const capture = createBoundedCapture();
  capture.append("H".repeat(512 * 1024)); // fills the head exactly
  capture.append("1".repeat(512 * 1024)); // fills the tail
  capture.append("2".repeat(10)); // pushes the tail window forward by 10 chars
  const result = capture.getCaptured();
  assert.ok(result.endsWith("2222222222"), "the newest 10 chars survive at the very end");
  // The tail is a fixed-size sliding window: pushing 10 fresh chars in must evict 10
  // of the oldest tail chars, so the kept text stays at (or under) the 1MB cap rather
  // than growing past it.
  assert.ok(result.length <= 1024 * 1024 + 100, "the tail window did not grow past the cap");
});
