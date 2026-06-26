// Run-dependency gating (roadmap WOW #13). dependencyState is pure over the
// in-memory, per-session runStatusRegistry plus an injected findPin lookup, so all
// four branches — no dependsOn, an unmet prerequisite, a satisfied prerequisite, and
// a dangling reference — are asserted directly without the extension host.
//
// runStatusRegistry is a module singleton; each test records into it and clears its
// own ids afterward so a session result never leaks into another test (the same
// discipline the run-analytics test follows).

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { dependencyState } from "../exec/dependencies";
import { runStatusRegistry } from "../exec/runStatus";
import type { Pin } from "../model/pin";

// Minimal pin builder: dependencyState reads only id and exec.dependsOn, so the rest
// is filler to satisfy the type.
function pin(id: string, dependsOn?: string): Pin {
  return {
    id,
    path: `${id}.sh`,
    scope: "project",
    order: 0,
    exec: dependsOn ? { dependsOn } : undefined,
  } as Pin;
}

// findPin map stand-in: the store's real findPin maps an id to a live pin; an absent
// id models a deleted prerequisite (the dangling-reference branch).
function lookup(pins: Record<string, Pin>): (id: string) => Pin | undefined {
  return (id: string): Pin | undefined => pins[id];
}

// Each test that records a success clears it here so the singleton starts empty for
// the next case.
const recorded: string[] = [];
afterEach(() => {
  for (const id of recorded.splice(0)) {
    runStatusRegistry.clear(id);
  }
});

test("a pin with no dependsOn is always cleared to run", () => {
  const target = pin("deploy");
  const state = dependencyState(target, lookup({}));
  assert.equal(
    state.pendingDependencyId,
    undefined,
    "no prerequisite means nothing is pending"
  );
});

test("an unmet prerequisite is reported pending by its id", () => {
  const build = pin("build");
  const deploy = pin("deploy", "build");
  // The prerequisite exists but has not succeeded this session, so it gates the run.
  const state = dependencyState(deploy, lookup({ build, deploy }));
  assert.equal(state.pendingDependencyId, "build");
});

test("a prerequisite that succeeded this session clears the pin", () => {
  const build = pin("build");
  const deploy = pin("deploy", "build");
  // Record a success for the prerequisite, the in-memory signal dependencyState reads.
  runStatusRegistry.record("build", {
    outcome: "success",
    exitCode: 0,
    durationMs: 10,
    endedAt: 1,
  });
  recorded.push("build");

  const state = dependencyState(deploy, lookup({ build, deploy }));
  assert.equal(
    state.pendingDependencyId,
    undefined,
    "a satisfied prerequisite leaves nothing pending"
  );
});

test("a prerequisite whose last run FAILED still gates the pin", () => {
  const build = pin("build");
  const deploy = pin("deploy", "build");
  // Only a "success" outcome satisfies the dependency; a recorded failure does not.
  runStatusRegistry.record("build", {
    outcome: "failure",
    exitCode: 1,
    durationMs: 10,
    endedAt: 1,
  });
  recorded.push("build");

  const state = dependencyState(deploy, lookup({ build, deploy }));
  assert.equal(
    state.pendingDependencyId,
    "build",
    "a failed prerequisite is not a satisfied one"
  );
});

test("a dangling prerequisite id (the pin was deleted) is treated as satisfied", () => {
  const deploy = pin("deploy", "gone");
  // findPin returns undefined for "gone": a deleted prerequisite must never lock a
  // pin forever, so the pin is cleared rather than pending.
  const state = dependencyState(deploy, lookup({ deploy }));
  assert.equal(
    state.pendingDependencyId,
    undefined,
    "a missing prerequisite cannot make a pin permanently unrunnable"
  );
});
