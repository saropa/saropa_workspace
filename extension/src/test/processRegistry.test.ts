// Unit tests for the background-process registry (roadmap 2.3): the in-memory map
// that lets the tree show a pin as running and offer a Stop / Force-kill action. The
// registry wraps a VS Code EventEmitter (modeled by the stub) and child_process
// handles. The tests drive a FAKE ChildProcess — a Node EventEmitter carrying a `pid`
// — so the running / stopping state machine, the close-handler cleanup, the
// replaced-child guard, and the change-event firing are asserted without spawning a
// real OS process. The OS-level killTree (taskkill / SIGTERM) is not exercised; on a
// non-Windows host child.kill() on the fake is a harmless no-op, and the tests assert
// on the registry's state transitions, not the signal delivery.

import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter as NodeEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { processRegistry } from "../exec/processRegistry";

// A minimal stand-in for a spawned child: a Node EventEmitter with a pid and a no-op
// kill, which is all the registry reads (child.pid, child.on("close"/"error"), and —
// on non-Windows — child.kill). exit() fires the close event the way a real process
// does when it terminates, so the registry's cleanup path runs.
class FakeChild extends NodeEmitter {
  killed = false;
  constructor(public readonly pid: number | undefined) {
    super();
  }
  kill(_signal?: NodeJS.Signals | number): boolean {
    this.killed = true;
    return true;
  }
  exit(): void {
    this.emit("close");
  }
}

const asChild = (c: FakeChild): ChildProcess => c as unknown as ChildProcess;

test("a registered pin reads as running until its process closes", () => {
  const pinId = "pr-run";
  const child = new FakeChild(1234);
  processRegistry.register(pinId, asChild(child));
  assert.equal(processRegistry.isRunning(pinId), true, "registered -> running");
  // The process exits: its close handler clears the registry entry.
  child.exit();
  assert.equal(processRegistry.isRunning(pinId), false, "close clears running state");
});

test("onDidChange fires on register and on close", () => {
  const pinId = "pr-events";
  let fires = 0;
  const sub = processRegistry.onDidChange(() => fires++);
  try {
    const child = new FakeChild(20);
    processRegistry.register(pinId, asChild(child));
    assert.equal(fires, 1, "register fires a repaint");
    child.exit();
    assert.equal(fires, 2, "close fires a repaint");
  } finally {
    sub.dispose();
  }
});

test("a relaunch that replaces a child does not let the old child's exit clear it", () => {
  const pinId = "pr-relaunch";
  const first = new FakeChild(1);
  const second = new FakeChild(2);
  processRegistry.register(pinId, asChild(first));
  // A new run replaces the handle for the same pin.
  processRegistry.register(pinId, asChild(second));
  assert.equal(processRegistry.isRunning(pinId), true);
  // The FIRST (replaced) child now exits late: its close handler must NOT remove the
  // newer run that took its place.
  first.exit();
  assert.equal(processRegistry.isRunning(pinId), true, "the live replacement stays running");
  // The current child exiting does clear it.
  second.exit();
  assert.equal(processRegistry.isRunning(pinId), false);
});

test("stop marks the pin stopping and arms an escalation timer; returns false when nothing runs", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  const pinId = "pr-stop";
  try {
    // Nothing registered yet: stop reports there was nothing to stop.
    assert.equal(processRegistry.stop(pinId), false, "stop on an idle pin is false");

    const child = new FakeChild(99);
    processRegistry.register(pinId, asChild(child));
    assert.equal(processRegistry.stop(pinId), true, "stop on a running pin is true");
    assert.equal(processRegistry.isStopping(pinId), true, "the pin shows a stopping state");
    // The graceful request went out (non-Windows path calls child.kill).
    if (process.platform !== "win32") {
      assert.equal(child.killed, true, "a graceful stop signals the child");
    }
    // The close handler clears both running and stopping state.
    child.exit();
    assert.equal(processRegistry.isStopping(pinId), false, "close clears the stopping flag");
    assert.equal(processRegistry.isRunning(pinId), false);
  } finally {
    mock.timers.reset();
  }
});

test("stop is a no-op when the child has no pid", () => {
  const pinId = "pr-nopid";
  const child = new FakeChild(undefined);
  processRegistry.register(pinId, asChild(child));
  // A child with no pid cannot be signalled; stop reports nothing to do.
  assert.equal(processRegistry.stop(pinId), false);
  assert.equal(processRegistry.isStopping(pinId), false);
  // Clean up the registry entry so it does not leak into another test.
  child.exit();
});

test("forceKill returns true on a running pin and false when idle", () => {
  const pinId = "pr-force";
  assert.equal(processRegistry.forceKill(pinId), false, "force-kill on an idle pin is false");
  const child = new FakeChild(77);
  processRegistry.register(pinId, asChild(child));
  assert.equal(processRegistry.forceKill(pinId), true);
  assert.equal(processRegistry.isStopping(pinId), true, "force-kill also shows a stopping state");
  child.exit();
  assert.equal(processRegistry.isRunning(pinId), false);
});

test("an error event clears the pin the same way a close does", () => {
  const pinId = "pr-error";
  const child = new FakeChild(55);
  processRegistry.register(pinId, asChild(child));
  assert.equal(processRegistry.isRunning(pinId), true);
  // A spawn / runtime error terminates the run just like a close.
  child.emit("error", new Error("boom"));
  assert.equal(processRegistry.isRunning(pinId), false, "an error clears running state");
});
