// Unit tests for the in-process system-event bus (recipe chaining + special trigger
// events). The bus (SystemEventBus, exposed as the `systemEvents` singleton) wraps a
// vscode.EventEmitter — the test stub's faithful-enough EventEmitter — so its
// subscribe / fire / dispose-the-subscription contract runs under node --test.
//
// The sibling GitEventWatcher in the same module is NOT exercised here: it needs
// vscode.workspace.createFileSystemWatcher and onDidChangeWorkspaceFolders, neither
// modeled by the stub. The bus is the only host-independent surface, and it is the
// part the ChainRunner reads, so it is the part worth covering.

import { test } from "node:test";
import assert from "node:assert/strict";
import { systemEvents } from "../exec/systemEvents";
import type { SystemEventName } from "../model/pin";

test("a subscriber receives the exact event name the bus fires", () => {
  const received: SystemEventName[] = [];
  const sub = systemEvents.onDidFire((e) => received.push(e));
  try {
    systemEvents.fire("build");
    systemEvents.fire("gitPush");
    assert.deepEqual(received, ["build", "gitPush"], "events arrive in fire order");
  } finally {
    sub.dispose();
  }
});

test("every subscriber is notified for a single fire", () => {
  // The chain runner is the primary subscriber, but the bus must fan out to all,
  // so two listeners both see one fire.
  let a = 0;
  let b = 0;
  const subA = systemEvents.onDidFire(() => a++);
  const subB = systemEvents.onDidFire(() => b++);
  try {
    systemEvents.fire("publish");
    assert.equal(a, 1);
    assert.equal(b, 1);
  } finally {
    subA.dispose();
    subB.dispose();
  }
});

test("a disposed subscription stops receiving — a leaked listener would double-fire", () => {
  const received: SystemEventName[] = [];
  const sub = systemEvents.onDidFire((e) => received.push(e));
  systemEvents.fire("gitCommit");
  sub.dispose();
  // After dispose, further fires must not reach the listener (no survivor across the
  // watcher teardown the real GitEventWatcher performs on deactivation).
  systemEvents.fire("gitCommit");
  assert.deepEqual(received, ["gitCommit"], "only the pre-dispose fire is seen");
});

test("a fire with no subscribers is inert (does not throw)", () => {
  // The git watcher can fire before any chain runner has subscribed; that must be a
  // harmless no-op rather than an error on the run path.
  assert.doesNotThrow(() => systemEvents.fire("build"));
});
