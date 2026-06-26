// Unit tests for the in-process pin-completion bus (the primitive recipe chaining
// rides on). The bus wraps a VS Code EventEmitter (modeled by the stub), so its
// subscribe / fire / payload contract runs under Node's built-in runner without the
// extension host.
//
// pinEvents is a module-level singleton; each test disposes its subscription so a
// listener never leaks into the next test and double-counts.

import { test } from "node:test";
import assert from "node:assert/strict";
import { pinEvents, type PinCompletion } from "../exec/pinEvents";

test("fireComplete delivers the pin id and outcome to a subscriber", () => {
  const seen: PinCompletion[] = [];
  const sub = pinEvents.onDidComplete((c) => seen.push(c));
  try {
    pinEvents.fireComplete("p1", "success");
    assert.deepEqual(seen, [{ pinId: "p1", outcome: "success" }]);
  } finally {
    sub.dispose();
  }
});

test("each of the three outcomes propagates verbatim", () => {
  // success / failure come from a tracked exit; dispatched is the terminal-state for a
  // run VS Code cannot follow to an exit code. All three must reach the chain engine.
  const outcomes: string[] = [];
  const sub = pinEvents.onDidComplete((c) => outcomes.push(c.outcome));
  try {
    pinEvents.fireComplete("a", "success");
    pinEvents.fireComplete("b", "failure");
    pinEvents.fireComplete("c", "dispatched");
    assert.deepEqual(outcomes, ["success", "failure", "dispatched"]);
  } finally {
    sub.dispose();
  }
});

test("multiple subscribers each receive a fired completion", () => {
  let first = 0;
  let second = 0;
  const subA = pinEvents.onDidComplete(() => first++);
  const subB = pinEvents.onDidComplete(() => second++);
  try {
    pinEvents.fireComplete("p", "success");
    assert.equal(first, 1, "the first subscriber is notified");
    assert.equal(second, 1, "the second subscriber is notified");
  } finally {
    subA.dispose();
    subB.dispose();
  }
});

test("a disposed subscriber stops receiving completions", () => {
  let count = 0;
  const sub = pinEvents.onDidComplete(() => count++);
  pinEvents.fireComplete("p", "success");
  sub.dispose();
  // After dispose the listener must not fire again — a leaked listener would survive
  // a reload and double-trigger the chain.
  pinEvents.fireComplete("p", "success");
  assert.equal(count, 1, "no further deliveries after dispose");
});
