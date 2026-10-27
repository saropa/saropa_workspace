// Tests for the Launcher webview's side panels: boot visibility, the right panel toggle and the resize handles.

import { test } from "node:test";
import assert from "node:assert/strict";
import { LEFT_PANEL_LIMITS } from "../views/launcher/launcherSplitLogic";
import { open, openWith, ITEMS, lastState, button } from "./launcherWebviewFixture";

test("loading reports the right panel as hidden, then ready, and sizes the left panel to its default", () => {
  const page = open();
  assert.deepEqual(page.takePosted(), [{ type: "rightPanelVisibility", visible: false }, { type: "ready" }]);
  assert.equal(page.byId("rightPanel").classList.contains("hidden"), true);
  assert.equal(page.byId("leftPanel").classList.contains("hidden"), false);
  assert.equal(page.document.documentElement.style.getPropertyValue("--launcher-left-w"), `${LEFT_PANEL_LIMITS.defaultWidth}px`);
});

test("the toggleRightPanel message shows and hides the right panel and tells the host", () => {
  const page = openWith(ITEMS);
  page.receive({ type: "toggleRightPanel" });
  assert.equal(page.byId("rightPanel").classList.contains("hidden"), false);
  assert.deepEqual(page.takePosted(), [{ type: "rightPanelVisibility", visible: true }]);
  assert.deepEqual((lastState(page).panels as Record<string, unknown>).right, { hidden: false });
  page.receive({ type: "toggleRightPanel" });
  assert.equal(page.byId("rightPanel").classList.contains("hidden"), true);
  assert.deepEqual(page.takePosted(), [{ type: "rightPanelVisibility", visible: false }]);
});

test("a right panel left open last time opens again and is reported as visible", () => {
  const page = open({ state: { collapsed: {}, panels: { right: { hidden: false } } } });
  assert.deepEqual(page.takePosted(), [{ type: "rightPanelVisibility", visible: true }, { type: "ready" }]);
  assert.equal(page.byId("rightPanel").classList.contains("hidden"), false);
});

test("dragging the left handle resizes the panel live, clamps it, and saves the width on release", () => {
  const page = openWith(ITEMS);
  const handle = page.byId("rsz-left");
  const width = (): string => page.document.documentElement.style.getPropertyValue("--launcher-left-w");
  page.fire(handle, "mousedown", { button: 0, clientX: 100 });
  assert.equal(handle.classList.contains("dragging"), true);
  assert.equal(page.document.body.classList.contains("resizing"), true);
  page.fire(page.document, "mousemove", { clientX: 150 });
  assert.equal(width(), "270px");
  page.fire(page.document, "mousemove", { clientX: 5000 });
  assert.equal(width(), `${LEFT_PANEL_LIMITS.max}px`);
  assert.equal(page.states.length, 0, "nothing is saved mid-drag");
  page.fire(page.document, "mouseup");
  assert.deepEqual((lastState(page).panels as Record<string, unknown>).left, { width: LEFT_PANEL_LIMITS.max });
  assert.equal(handle.classList.contains("dragging"), false);
  assert.equal(page.document.body.classList.contains("resizing"), false);
  assert.equal(page.document.listenerCount("mousemove"), 0);
  assert.equal(page.document.listenerCount("mouseup"), 0);
});

test("the right handle grows leftward, and a non-primary button does not start a drag", () => {
  const page = openWith(ITEMS);
  page.receive({ type: "toggleRightPanel" });
  const handle = page.byId("rsz-right");
  page.fire(handle, "mousedown", { button: 2, clientX: 500 });
  assert.equal(handle.classList.contains("dragging"), false);
  page.fire(handle, "mousedown", { button: 0, clientX: 500 });
  page.fire(page.document, "mousemove", { clientX: 450 });
  assert.equal(page.document.documentElement.style.getPropertyValue("--launcher-right-w"), "310px");
});
