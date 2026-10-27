// Unit tests for the workflow-planner graph builder (nodes, edges, event nodes).

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildData } from "../views/plannerPanelData";
import { runStatusRegistry } from "../exec/runStatus";
import type { ShortcutStore } from "../model/shortcutStore";
import type { Shortcut } from "../model/shortcut";

function sh(id: string, extra: Partial<Shortcut> = {}): Shortcut {
  return { id, path: id, label: id, scope: "project", action: { kind: "shell", command: "echo" }, ...extra } as Shortcut;
}

function store(project: Shortcut[], global: Shortcut[] = []): ShortcutStore {
  return {
    getProjectShortcuts: () => project,
    getGlobalShortcuts: () => global,
    resolveUri: () => undefined,
  } as unknown as ShortcutStore;
}

test("auto shortcuts are excluded and both scopes are included", () => {
  const data = buildData(store([sh("a"), sh("auto", { isAuto: true })], [sh("g", { scope: "global" })]));
  assert.deepEqual(data.nodes.map((n) => n.id), ["a", "g"]);
  assert.equal(data.nodes[1].scope, "global");
});

test("a non-file shortcut is runnable without resolving a path", () => {
  const n = buildData(store([sh("a")])).nodes[0];
  assert.equal(n.runnable, true);
  assert.equal(n.shortcutKind, "shell");
  assert.equal(n.kind, "pin");
});

test("a file shortcut that cannot be resolved is not runnable", () => {
  const file = { id: "f", path: "f.txt", label: "f", scope: "project" } as Shortcut;
  assert.equal(buildData(store([file])).nodes[0].runnable, false);
});

test("pin triggers produce edges only when both ends exist", () => {
  const b = sh("b", { triggers: [{ kind: "pin", pinId: "a" }, { kind: "pin", pinId: "ghost" }] });
  const data = buildData(store([sh("a"), b]));
  assert.deepEqual(data.edges, [{ from: "a", to: "b", kind: "pin" }]);
});

test("event triggers add one shared event node per event with a readable label", () => {
  const a = sh("a", { triggers: [{ kind: "event", event: "gitPush" }] });
  const b = sh("b", { triggers: [{ kind: "event", event: "gitPush" }, { kind: "event", event: "build" }] });
  const data = buildData(store([a, b]));
  const events = data.nodes.filter((n) => n.kind === "event");
  assert.deepEqual(events.map((e) => e.id).sort(), ["event:build", "event:gitPush"]);
  assert.equal(events.find((e) => e.event === "gitPush")!.label, "git push");
  assert.equal(data.edges.filter((e) => e.kind === "event").length, 3);
});

test("idle triggers create no edges", () => {
  const a = sh("a", { triggers: [{ kind: "idle", minutes: 5 }] });
  assert.deepEqual(buildData(store([a])).edges, []);
});

test("the last run outcome is carried onto the node", () => {
  runStatusRegistry.record("planner-ok", { outcome: "failure", exitCode: 2, durationMs: 5, endedAt: 1 });
  const n = buildData(store([sh("planner-ok")])).nodes[0];
  assert.equal(n.lastOutcome, "failure");
  runStatusRegistry.clear("planner-ok");
  assert.equal(buildData(store([sh("planner-ok")])).nodes[0].lastOutcome, undefined);
});
