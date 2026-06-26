// Unit tests for the per-session run-status registry (roadmap 7.2) and its
// duration formatter. Both are free of the extension host: formatDuration is pure
// arithmetic, and RunStatusRegistry only exposes a vscode.EventEmitter (the test
// stub's faithful-enough EventEmitter), so the record / get / entries / clear
// contract and the change-event firing run under node --test.
//
// The registry is a MODULE singleton shared across the whole test process, so each
// test clears the ids it touched in a finally block — leaving it empty for the
// run-analytics test, which also reads it (see runAnalytics.test.ts).

import { test } from "node:test";
import assert from "node:assert/strict";
import { runStatusRegistry, formatDuration, RunResult } from "../exec/runStatus";

// A complete RunResult; callers override only the fields a case cares about.
function result(over: Partial<RunResult> = {}): RunResult {
  return { outcome: "success", exitCode: 0, durationMs: 1000, endedAt: 0, ...over };
}

test("formatDuration: sub-second runs read in whole milliseconds", () => {
  assert.equal(formatDuration(0), "0ms");
  assert.equal(formatDuration(1), "1ms");
  assert.equal(formatDuration(999), "999ms");
});

test("formatDuration: under a minute reads as one decimal of seconds", () => {
  // 1000ms is the boundary into the seconds branch; it is "1.0s", not "1000ms".
  assert.equal(formatDuration(1000), "1.0s");
  assert.equal(formatDuration(1500), "1.5s");
  // 59.9s is still under the minute boundary and stays in the seconds branch.
  assert.equal(formatDuration(59_900), "59.9s");
});

test("formatDuration: a minute or longer reads as minutes and zero-padded seconds", () => {
  assert.equal(formatDuration(60_000), "1m 00s");
  // 90s -> 1m 30s; the seconds component is rounded, not truncated.
  assert.equal(formatDuration(90_000), "1m 30s");
  // 1m 05s exercises the two-digit zero pad on a single-digit second.
  assert.equal(formatDuration(65_000), "1m 05s");
  assert.equal(formatDuration(2 * 60_000), "2m 00s");
});

test("formatDuration: seconds rounding can carry into the next whole minute", () => {
  // 119.6s rounds the remainder to 60, which Math.round on (seconds % 60) yields,
  // so the formatter reports "1m 60s" — documents the current rounding behavior so
  // a future change to it is a deliberate, visible decision.
  assert.equal(formatDuration(119_600), "1m 60s");
});

test("registry: record then get returns the stored result; an unknown pin is undefined", () => {
  try {
    assert.equal(runStatusRegistry.get("rs-a"), undefined, "nothing recorded yet");
    const r = result({ durationMs: 2500 });
    runStatusRegistry.record("rs-a", r);
    assert.deepEqual(runStatusRegistry.get("rs-a"), r);
    assert.equal(runStatusRegistry.get("rs-missing"), undefined);
  } finally {
    runStatusRegistry.clear("rs-a");
  }
});

test("registry: record overwrites — only the LAST result per pin is kept", () => {
  try {
    runStatusRegistry.record("rs-b", result({ outcome: "failure", exitCode: 1 }));
    runStatusRegistry.record("rs-b", result({ outcome: "success", exitCode: 0 }));
    assert.equal(runStatusRegistry.get("rs-b")?.outcome, "success", "the newer run wins");
    assert.equal(runStatusRegistry.get("rs-b")?.exitCode, 0);
  } finally {
    runStatusRegistry.clear("rs-b");
  }
});

test("registry: entries snapshots every recorded result and cannot mutate the backing map", () => {
  try {
    runStatusRegistry.record("rs-c", result());
    runStatusRegistry.record("rs-d", result({ outcome: "failure", exitCode: 2 }));
    const snapshot = runStatusRegistry.entries();
    const ids = snapshot.map(([id]) => id).sort();
    assert.deepEqual(ids, ["rs-c", "rs-d"]);
    // Mutating the returned array must not affect the registry (it is a copy).
    snapshot.length = 0;
    assert.equal(runStatusRegistry.entries().length, 2, "the registry kept both entries");
  } finally {
    runStatusRegistry.clear("rs-c");
    runStatusRegistry.clear("rs-d");
  }
});

test("registry: onDidChange fires on record and on a clear that removed something", () => {
  let fires = 0;
  const sub = runStatusRegistry.onDidChange(() => {
    fires++;
  });
  try {
    runStatusRegistry.record("rs-e", result());
    assert.equal(fires, 1, "record repaints the tree");
    // Clearing a present shortcut removes it and fires once.
    runStatusRegistry.clear("rs-e");
    assert.equal(fires, 2, "a real removal repaints the tree");
    // Clearing an absent shortcut is a no-op and must NOT fire (no stale repaint).
    runStatusRegistry.clear("rs-e");
    assert.equal(fires, 2, "clearing nothing does not fire");
  } finally {
    sub.dispose();
    runStatusRegistry.clear("rs-e");
  }
});
