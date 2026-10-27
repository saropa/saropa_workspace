// Tests for the Dashboard webview's host message handling and resize redraw.

import { test } from "node:test";
import assert from "node:assert/strict";
import { open, strings, dataMessage, CPU } from "./dashboardWebviewFixture";

test("a sampling message shows the sampling text and a data message clears it", () => {
  const page = open();
  page.receive({ type: "sampling" });
  assert.equal(page.byId("status").textContent, strings(page).sampling);
  page.receive(dataMessage([]));
  assert.equal(page.byId("status").textContent, "");
});

test("a resize redraws the trends tab after a short pause, but only while it is the active tab", () => {
  const page = open("trends");
  page.receive({ type: "trends", cpu: CPU, debt: { counts: [] }, reports: [] });
  const first = page.byId("cpuChart");
  page.fire(page.window, "resize");
  page.timers.advance(149);
  assert.equal(page.byId("cpuChart"), first);
  page.timers.advance(1);
  assert.notEqual(page.byId("cpuChart"), first);
  page.click(page.one('.tab[data-tab="processes"]'));
  const second = page.byId("cpuChart");
  page.fire(page.window, "resize");
  page.timers.runAll();
  assert.equal(page.byId("cpuChart"), second);
});

test("repeated resizes inside the pause collapse into one redraw", () => {
  const page = open("trends");
  page.receive({ type: "trends", cpu: CPU, debt: { counts: [] }, reports: [] });
  page.fire(page.window, "resize");
  page.timers.advance(100);
  page.fire(page.window, "resize");
  assert.equal(page.timers.pending, 1);
});
