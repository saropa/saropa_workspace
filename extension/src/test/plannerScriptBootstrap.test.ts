// Tests for the Planner webview's boot messages, tab and refresh buttons.

import { test } from "node:test";
import assert from "node:assert/strict";
import { open, openWith, lastState, SCHEDULED } from "./plannerWebviewFixture";

test("loading tells the host it is ready and saves the default view settings", () => {
  const page = open();
  assert.deepEqual(page.takePosted(), [{ type: "ready" }]);
  assert.deepEqual(lastState(page), { view: "week", density: "compact", shelfOpen: true, detailW: 300, toolboxW: 168 });
  assert.deepEqual(page.all(".tab").map((t) => `${t.dataset.v}:${t.getAttribute("aria-selected")}`), ["day:false", "week:true", "workflow:false"]);
  assert.equal(page.document.documentElement.style.getPropertyValue("--hour-h"), "30px");
});

test("clicking a tab switches the view, marks the tab and saves the choice", () => {
  const page = openWith("week", SCHEDULED);
  page.click(page.one('.tab[data-v="day"]'));
  assert.deepEqual(page.all(".tab").map((t) => t.getAttribute("aria-selected")), ["true", "false", "false"]);
  assert.equal(lastState(page).view, "day");
  assert.equal(page.all(".day-wrap").length, 1);
  assert.equal(page.all(".week").length, 0);
});

test("the refresh button asks the host to refresh", () => {
  const page = open();
  page.takePosted();
  page.click(page.byId("refresh"));
  assert.deepEqual(page.takePosted(), [{ type: "refresh" }]);
});
