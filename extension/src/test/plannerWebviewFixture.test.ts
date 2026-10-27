// Tests for the planner webview test fixture.

import { test } from "node:test";
import assert from "node:assert/strict";
import { dataMessage, daily, event, openWith, pin, tpl } from "./plannerWebviewFixture";

test("tpl fills every occurrence of each placeholder and leaves unknown ones alone", () => {
  assert.equal(tpl("{a}-{a}-{b}-{c}", { a: 1, b: "x" }), "1-1-x-{c}");
});

test("pin, event and daily build the node and schedule shapes the script reads", () => {
  assert.deepEqual(pin("p", "P", { scope: "global" }), { id: "p", kind: "pin", label: "P", scope: "global", shortcutKind: "shell", runnable: true });
  assert.deepEqual(event("e", "build", "B"), { id: "e", kind: "event", event: "build", label: "B" });
  assert.deepEqual(daily("09:00", { days: [1] }), { atTime: "09:00", enabled: true, days: [1] });
});

test("dataMessage defaults the edges, positions and clock", () => {
  assert.deepEqual(dataMessage({ nodes: [] }), { type: "data", data: { nodes: [], edges: [] }, positions: {}, nowMin: 0 });
});

test("openWith opens on the requested view with the data rendered and the boot messages taken", () => {
  const page = openWith("day", { nodes: [pin("p", "P", { schedule: daily("09:00") })] });
  assert.deepEqual(page.posted, []);
  assert.equal(page.all(".marker").length, 1);
  assert.equal(page.one('.tab[aria-selected="true"]').dataset.v, "day");
});
