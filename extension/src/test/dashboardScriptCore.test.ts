// Tests for the Dashboard webview script's tab chrome: the real shell and script run together in the fake DOM.

import { test } from "node:test";
import assert from "node:assert/strict";
import { open } from "./dashboardWebviewFixture";

test("loading asks the host for the initial tab and marks only that tab active", () => {
  const page = open("analytics");
  assert.deepEqual(page.takePosted(), [{ type: "activateTab", tab: "analytics" }]);
  assert.deepEqual(page.all(".tab.active").map((b) => b.dataset.tab), ["analytics"]);
  assert.deepEqual(page.all(".tab-panel").filter((p) => !p.classList.contains("hidden")).map((p) => p.id), ["tab-analytics"]);
});

test("clicking a tab shows its panel and asks the host for that tab's data", () => {
  const page = open();
  page.takePosted();
  page.click(page.one('.tab[data-tab="trends"]'));
  assert.deepEqual(page.takePosted(), [{ type: "activateTab", tab: "trends" }]);
  assert.deepEqual(page.all(".tab.active").map((b) => b.dataset.tab), ["trends"]);
  assert.equal(page.byId("tab-trends").classList.contains("hidden"), false);
  assert.equal(page.byId("tab-processes").classList.contains("hidden"), true);
});

test("a selectTab message from the host switches tabs the same way", () => {
  const page = open();
  page.takePosted();
  page.receive({ type: "selectTab", tab: "analytics" });
  assert.deepEqual(page.takePosted(), [{ type: "activateTab", tab: "analytics" }]);
  assert.equal(page.byId("tab-analytics").classList.contains("hidden"), false);
});

test("the refresh and copy buttons post their messages", () => {
  const page = open();
  page.takePosted();
  page.click(page.byId("refresh"));
  page.click(page.byId("copy"));
  assert.deepEqual(page.takePosted(), [{ type: "refresh" }, { type: "copy" }]);
});
