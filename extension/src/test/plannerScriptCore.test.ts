// Tests for the Planner webview's saved view settings, density and detail pane sizing.

import { test } from "node:test";
import assert from "node:assert/strict";
import { open, openWith, strings, style, lastState, SCHEDULED } from "./plannerWebviewFixture";

test("saved view settings are restored, and invalid ones fall back to the defaults", () => {
  const saved = open({ state: { view: "day", density: "comfortable", shelfOpen: false, detailW: 400, toolboxW: 200 } });
  assert.deepEqual(saved.all(".tab").map((t) => t.getAttribute("aria-selected")), ["true", "false", "false"]);
  assert.equal(saved.document.documentElement.style.getPropertyValue("--hour-h"), "60px");
  assert.equal(saved.document.documentElement.style.getPropertyValue("--detail-w"), "400px");
  assert.equal(saved.document.documentElement.style.getPropertyValue("--toolbox-w"), "200px");
  const bad = open({ state: { density: "huge", detailW: "wide" } });
  assert.equal(bad.document.documentElement.style.getPropertyValue("--hour-h"), "30px");
  assert.equal(bad.document.documentElement.style.getPropertyValue("--detail-w"), "300px");
});

test("the density button toggles hour height, its label and the saved setting", () => {
  const page = openWith("week", SCHEDULED);
  const s = strings(page);
  page.click(page.byId("density"));
  assert.equal(page.document.documentElement.style.getPropertyValue("--hour-h"), "60px");
  assert.equal(page.byId("density").textContent, `↕ ${s.densityComfortable}`);
  assert.equal(lastState(page).density, "comfortable");
  assert.equal(style(page.one(".block")).top, "570px");
  page.click(page.byId("density"));
  assert.equal(page.byId("density").textContent, `≡ ${s.densityCompact}`);
  assert.equal(style(page.one(".block")).top, "285px");
});

test("dragging the detail handle resizes the detail pane within its limits and saves on release", () => {
  const page = open();
  const width = (): string => page.document.documentElement.style.getPropertyValue("--detail-w");
  page.fire(page.byId("rsz-detail"), "mousedown", { button: 0, clientX: 500 });
  page.fire(page.document, "mousemove", { clientX: 450 });
  assert.equal(width(), "350px");
  page.fire(page.document, "mousemove", { clientX: 0 });
  assert.equal(width(), "560px");
  page.fire(page.document, "mouseup");
  assert.equal(lastState(page).detailW, 560);
  assert.equal(page.document.listenerCount("mousemove"), 0);
});
