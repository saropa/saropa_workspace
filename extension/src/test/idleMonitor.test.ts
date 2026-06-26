// Unit tests for the editor-idle detector (WOW #18 run-on-idle trigger). The monitor
// uses `Date.now()` and `setInterval`, so the tests fake both through Node's built-in
// mock timers — `mock.timers.tick(ms)` advances the fake clock AND fires the poll
// interval, making the threshold-crossing behavior deterministic without real waiting.
// The window activity events are driven through the vscode stub's __fire* helpers.
//
// The bare "vscode" import inside the monitor is aliased to src/test/_stub/vscode.ts
// at bundle time (see esbuild.test.js); esbuild resolves that alias and the explicit
// "./_stub/vscode" import below to the SAME module, so firing the activity events here
// reaches the monitor's listeners. The stub-only __fire* helpers are imported from the
// stub path directly (they do not exist on the real vscode types, so a bare "vscode"
// import would not type-check), matching the convention in promptTokens.test.ts.

import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { IdleMonitor } from "../exec/idleMonitor";
import {
  __fireWindowState,
  __fireSelection,
  __fireActiveEditor,
} from "./_stub/vscode";

// Collect the thresholds the monitor fires so each test can assert the exact sequence.
function record(monitor: IdleMonitor): number[] {
  const fired: number[] = [];
  monitor.onDidGoIdle((minutes) => fired.push(minutes));
  return fired;
}

const MIN = 60_000;

test("fires each threshold once when its idle span is crossed, in order", () => {
  mock.timers.enable({ apis: ["setInterval", "Date"] });
  try {
    const monitor = new IdleMonitor();
    const fired = record(monitor);
    monitor.setThresholds([1, 3]);

    // Cross the 1-minute boundary: only the 1-minute threshold fires.
    mock.timers.tick(1 * MIN);
    assert.deepEqual(fired, [1]);

    // Keep idling to 3 minutes total: the 3-minute threshold fires; the 1-minute one
    // does NOT re-fire within the same idle period.
    mock.timers.tick(2 * MIN);
    assert.deepEqual(fired, [1, 3]);

    // Continued inactivity past the largest threshold fires nothing more.
    mock.timers.tick(5 * MIN);
    assert.deepEqual(fired, [1, 3]);

    monitor.dispose();
  } finally {
    mock.timers.reset();
  }
});

test("re-arms after activity so the next idle stretch fires again", () => {
  mock.timers.enable({ apis: ["setInterval", "Date"] });
  try {
    const monitor = new IdleMonitor();
    const fired = record(monitor);
    monitor.setThresholds([1]);

    mock.timers.tick(1 * MIN);
    assert.deepEqual(fired, [1]);

    // The user returns (a cursor/selection move): the period resets.
    __fireSelection();
    mock.timers.tick(1 * MIN);
    assert.deepEqual(fired, [1, 1]);

    // Switching the active editor counts as activity too.
    __fireActiveEditor();
    mock.timers.tick(1 * MIN);
    assert.deepEqual(fired, [1, 1, 1]);

    monitor.dispose();
  } finally {
    mock.timers.reset();
  }
});

test("regaining window focus is activity; losing focus is not", () => {
  mock.timers.enable({ apis: ["setInterval", "Date"] });
  try {
    const monitor = new IdleMonitor();
    const fired = record(monitor);
    monitor.setThresholds([1]);

    // Regained focus resets the clock: a focus event mid-way must defer the fire.
    mock.timers.tick(30_000);
    __fireWindowState(true);
    mock.timers.tick(30_000); // only 30s since the focus reset -> no fire yet
    assert.deepEqual(fired, []);
    mock.timers.tick(30_000); // now 60s since focus -> fires
    assert.deepEqual(fired, [1]);

    // Losing focus (the user stepped away) must NOT reset the clock — idle should
    // keep accruing so the run fires while they are gone. Start a fresh period, blur
    // mid-way, and confirm the threshold still fires on schedule.
    __fireSelection(); // reset to a known start
    mock.timers.tick(30_000);
    __fireWindowState(false); // blur — ignored as activity
    mock.timers.tick(30_000); // 60s of real inactivity despite the blur -> fires
    assert.deepEqual(fired, [1, 1]);

    monitor.dispose();
  } finally {
    mock.timers.reset();
  }
});

test("clearing all thresholds stops the monitor from firing", () => {
  mock.timers.enable({ apis: ["setInterval", "Date"] });
  try {
    const monitor = new IdleMonitor();
    const fired = record(monitor);
    monitor.setThresholds([1]);
    monitor.setThresholds([]); // e.g. the last idle pin was removed

    mock.timers.tick(10 * MIN);
    assert.deepEqual(fired, []);

    monitor.dispose();
  } finally {
    mock.timers.reset();
  }
});

test("duplicate and non-positive thresholds collapse to one valid firing", () => {
  mock.timers.enable({ apis: ["setInterval", "Date"] });
  try {
    const monitor = new IdleMonitor();
    const fired = record(monitor);
    // Two pins at 2 minutes plus a bogus 0 — distinct positive minutes only.
    monitor.setThresholds([2, 2, 0]);

    mock.timers.tick(2 * MIN);
    assert.deepEqual(fired, [2]);

    monitor.dispose();
  } finally {
    mock.timers.reset();
  }
});
