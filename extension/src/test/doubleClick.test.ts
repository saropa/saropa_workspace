// Unit tests for the double-click discriminator (doubleClick.ts). It reads the
// doubleClickMs setting via vscode.workspace.getConfiguration — esbuild aliases
// that to the test stub, which returns the default (400ms) — and uses Date.now()
// + setTimeout, which node:test's mock timers drive deterministically. So the
// open-vs-run timing is testable without the extension host (4.1).

import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { DoubleClickDispatcher } from "../exec/doubleClick";

// The stub config returns the default doubleClickMs, so the window is 400ms.
const WINDOW = 400;

function makeDispatcher(): {
  d: DoubleClickDispatcher;
  singles: string[];
  doubles: string[];
} {
  const singles: string[] = [];
  const doubles: string[] = [];
  const d = new DoubleClickDispatcher(
    (id) => singles.push(id),
    (id) => doubles.push(id)
  );
  return { d, singles, doubles };
}

// Run a body with Date + setTimeout mocked, always resetting afterward so one
// test's virtual clock never leaks into the next.
function withMockTimers(body: () => void): void {
  mock.timers.enable({ apis: ["setTimeout", "Date"] });
  try {
    body();
  } finally {
    mock.timers.reset();
  }
}

test("a single click defers, then fires onSingle once the window elapses", () => {
  withMockTimers(() => {
    const { d, singles, doubles } = makeDispatcher();
    d.activate("a");
    // The open is deferred by the window so a fast second click can cancel it.
    assert.deepEqual(singles, []);
    mock.timers.tick(WINDOW);
    assert.deepEqual(singles, ["a"]);
    assert.deepEqual(doubles, []);
  });
});

test("a second click within the window fires onDouble and cancels the open", () => {
  withMockTimers(() => {
    const { d, singles, doubles } = makeDispatcher();
    d.activate("a");
    mock.timers.tick(WINDOW - 100); // still inside the window
    d.activate("a");
    assert.deepEqual(doubles, ["a"]);
    // The deferred open must NOT fire afterward — the double-click canceled it.
    mock.timers.tick(WINDOW * 3);
    assert.deepEqual(singles, []);
  });
});

test("a second click beyond the window is a fresh single, not a double", () => {
  withMockTimers(() => {
    const { d, singles, doubles } = makeDispatcher();
    d.activate("a");
    mock.timers.tick(WINDOW); // the first open fires here
    assert.deepEqual(singles, ["a"]);
    d.activate("a"); // too late to pair — a brand new first click
    assert.deepEqual(doubles, []);
    mock.timers.tick(WINDOW);
    assert.deepEqual(singles, ["a", "a"]);
  });
});

test("clicking a different pin replaces the pending open (no double)", () => {
  withMockTimers(() => {
    const { d, singles, doubles } = makeDispatcher();
    d.activate("a");
    mock.timers.tick(100); // within the window, but on a different id next
    d.activate("b");
    // Different id -> not a double; only one open is pending at a time, so the
    // earlier "a" open is replaced by "b" rather than both firing.
    assert.deepEqual(doubles, []);
    mock.timers.tick(WINDOW);
    assert.deepEqual(singles, ["b"]);
  });
});
