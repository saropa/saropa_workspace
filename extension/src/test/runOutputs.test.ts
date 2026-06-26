// Unit tests for the per-pin last-two-runs capture (WOW #20 "Diff Last Two Runs").
// The registry is a pure in-memory, bounded ring of two entries per pin with no VS
// Code dependency, so its eviction, ordering, the "need two to diff" guard, and
// per-pin isolation are asserted directly under Node's built-in runner.
//
// runOutputs is a module-level singleton, so each test records under its own unique
// pin id and clears it at the end, leaving the registry empty for the next test.

import { test } from "node:test";
import assert from "node:assert/strict";
import { runOutputs, type CapturedRun } from "../exec/runOutputs";

// A captured run with a recognizable output and end-time, so eviction order is
// observable in the assertions.
function run(output: string, endedAt: number, exitCode: number | null = 0): CapturedRun {
  return { output, endedAt, exitCode };
}

test("a single recorded run is not diffable yet (needs two)", () => {
  const pinId = "ro-single";
  try {
    runOutputs.record(pinId, run("only", 1));
    assert.equal(runOutputs.lastTwo(pinId), undefined, "one run cannot be diffed");
  } finally {
    runOutputs.clear(pinId);
  }
});

test("two runs return as [older, newer] in arrival order", () => {
  const pinId = "ro-pair";
  try {
    runOutputs.record(pinId, run("first", 100, 0));
    runOutputs.record(pinId, run("second", 200, 1));
    const pair = runOutputs.lastTwo(pinId);
    assert.ok(pair, "two runs are diffable");
    assert.equal(pair![0].output, "first", "the older run leads");
    assert.equal(pair![1].output, "second", "the newer run trails");
    assert.equal(pair![1].exitCode, 1, "the captured exit code is preserved");
  } finally {
    runOutputs.clear(pinId);
  }
});

test("a third run evicts the oldest, keeping only the last two", () => {
  const pinId = "ro-evict";
  try {
    runOutputs.record(pinId, run("a", 1));
    runOutputs.record(pinId, run("b", 2));
    runOutputs.record(pinId, run("c", 3));
    const pair = runOutputs.lastTwo(pinId);
    assert.ok(pair);
    // "a" was evicted; the window is now [b, c].
    assert.equal(pair![0].output, "b", "the oldest of the kept pair is the second run");
    assert.equal(pair![1].output, "c", "the newest run trails");
  } finally {
    runOutputs.clear(pinId);
  }
});

test("captures are isolated per pin", () => {
  const pinA = "ro-iso-a";
  const pinB = "ro-iso-b";
  try {
    runOutputs.record(pinA, run("a1", 1));
    runOutputs.record(pinA, run("a2", 2));
    runOutputs.record(pinB, run("b1", 1));
    // pinA has two; pinB has only one — one pin's runs never leak into another's.
    assert.ok(runOutputs.lastTwo(pinA));
    assert.equal(runOutputs.lastTwo(pinB), undefined);
  } finally {
    runOutputs.clear(pinA);
    runOutputs.clear(pinB);
  }
});

test("clear drops a pin's captures so a removed pin leaves nothing behind", () => {
  const pinId = "ro-clear";
  runOutputs.record(pinId, run("x", 1));
  runOutputs.record(pinId, run("y", 2));
  assert.ok(runOutputs.lastTwo(pinId), "two runs are present before clear");
  runOutputs.clear(pinId);
  assert.equal(runOutputs.lastTwo(pinId), undefined, "clear removes the captures");
});

test("a null exit code (killed / spawn failure) is preserved", () => {
  const pinId = "ro-null-code";
  try {
    runOutputs.record(pinId, run("ok", 1, 0));
    runOutputs.record(pinId, run("killed", 2, null));
    const pair = runOutputs.lastTwo(pinId);
    assert.equal(pair![1].exitCode, null, "a signal-killed run keeps its null code");
  } finally {
    runOutputs.clear(pinId);
  }
});
