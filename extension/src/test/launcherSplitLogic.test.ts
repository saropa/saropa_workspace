// Unit tests for the pure width/visibility math backing the Launcher's resizable +
// collapsible side panels (src/views/launcher/launcherSplitLogic.ts). These are the only
// pieces of the panel-restructure step 1 work that are pure functions runnable under
// Node's test runner — the actual drag-resize interaction and DOM layout have no test
// harness in this codebase (no webview/DOM harness) and are verified by code inspection
// instead (see launcherScriptSplit.ts's header comment and the PR report).

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clampPanelWidth,
  resolvePanelWidth,
  isPanelVisible,
  withHidden,
  withWidth,
  type PanelLimits,
} from "../views/launcher/launcherSplitLogic";

const LEFT_LIMITS: PanelLimits = { min: 160, max: 400, defaultWidth: 220 };
const RIGHT_LIMITS: PanelLimits = { min: 200, max: 480, defaultWidth: 260 };

test("clampPanelWidth: passes a value already inside [min,max] through unchanged", () => {
  assert.equal(clampPanelWidth(250, LEFT_LIMITS), 250);
});

test("clampPanelWidth: clamps below min and above max", () => {
  assert.equal(clampPanelWidth(10, LEFT_LIMITS), 160);
  assert.equal(clampPanelWidth(10000, LEFT_LIMITS), 400);
});

test("clampPanelWidth: min and max themselves pass through", () => {
  assert.equal(clampPanelWidth(160, LEFT_LIMITS), 160);
  assert.equal(clampPanelWidth(400, LEFT_LIMITS), 400);
});

test("resolvePanelWidth: falls back to the panel's default when never dragged", () => {
  assert.equal(resolvePanelWidth({}, LEFT_LIMITS), 220);
  assert.equal(resolvePanelWidth({ hidden: true }, RIGHT_LIMITS), 260);
});

test("resolvePanelWidth: uses the persisted width once one exists", () => {
  assert.equal(resolvePanelWidth({ width: 300 }, LEFT_LIMITS), 300);
});

test("resolvePanelWidth: re-clamps a persisted width outside the current range", () => {
  // Guards against a width saved under an older/different min-max (or a corrupted
  // getState() blob) rendering a panel wider or narrower than its current limits allow.
  assert.equal(resolvePanelWidth({ width: 5 }, LEFT_LIMITS), 160);
  assert.equal(resolvePanelWidth({ width: 9999 }, LEFT_LIMITS), 400);
});

test("isPanelVisible: falls back to the panel's own default posture when never toggled", () => {
  // The left panel defaults to visible (defaultHidden=false); the right panel defaults to
  // collapsed (defaultHidden=true) — per PLAN_Launcher_Restructure.md's target layout.
  assert.equal(isPanelVisible({}, false), true, "left panel default: visible");
  assert.equal(isPanelVisible({}, true), false, "right panel default: collapsed");
});

test("isPanelVisible: an explicit persisted hidden flag always wins over the default", () => {
  assert.equal(isPanelVisible({ hidden: false }, true), true);
  assert.equal(isPanelVisible({ hidden: true }, false), false);
});

test("withHidden: toggling collapse never touches the stored width", () => {
  // The plan calls this out explicitly: re-showing a panel restores the LAST DRAGGED width,
  // not a fixed default, so collapsing/expanding must be a no-op on the width field.
  const dragged = withWidth({}, 350, LEFT_LIMITS);
  const collapsed = withHidden(dragged, true);
  assert.equal(collapsed.width, 350, "width must survive a collapse");
  const expanded = withHidden(collapsed, false);
  assert.equal(expanded.width, 350, "width must survive a re-expand");
  assert.equal(expanded.hidden, false);
});

test("withWidth: dragging never touches the stored hidden flag", () => {
  const hidden = withHidden({}, true);
  const resized = withWidth(hidden, 300, RIGHT_LIMITS);
  assert.equal(resized.hidden, true, "hidden flag must survive a resize");
  assert.equal(resized.width, 300);
});

test("withWidth: clamps the stored width to the given limits", () => {
  const resized = withWidth({}, 10, LEFT_LIMITS);
  assert.equal(resized.width, 160);
});
