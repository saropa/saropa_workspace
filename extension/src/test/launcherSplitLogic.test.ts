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
import { panelWidthMathJs } from "../views/webviewClientUtils";

const LEFT_LIMITS: PanelLimits = { min: 160, max: 400, defaultWidth: 220 };
const RIGHT_LIMITS: PanelLimits = { min: 200, max: 480, defaultWidth: 260 };

// Evaluates panelWidthMathJs()'s generated source and returns the named function, so a
// test can invoke the webview client's exact copy the same way webviewClientUtils.test.ts
// does for escapeHtmlJs/formatBytesJs (see that file's header for why `new Function` is
// safe here: the source is our own literal, not external input).
function compile(fnName: string): (...args: unknown[]) => unknown {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval -- intentional: compiles
  // our own generated-JS-text fixture, not external/user input.
  return new Function(`${panelWidthMathJs()}\nreturn ${fnName};`)() as (
    ...args: unknown[]
  ) => unknown;
}

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

test("clampPanelWidth: rejects a negative width by falling back to min", () => {
  // A negative width cannot come from a real drag, but a corrupted/edited getState()
  // blob could carry one; it must not pass straight through the Math.max/min clamp.
  assert.equal(clampPanelWidth(-50, LEFT_LIMITS), 160);
});

test("clampPanelWidth: rejects NaN and +/-Infinity by falling back to min", () => {
  // vscode.setState uses structured clone, which round-trips NaN unlike JSON, so a
  // persisted width can carry one; Number.isFinite must catch it before Math.max/min
  // would otherwise let it through unclamped.
  assert.equal(clampPanelWidth(NaN, LEFT_LIMITS), 160);
  assert.equal(clampPanelWidth(Infinity, LEFT_LIMITS), 160);
  assert.equal(clampPanelWidth(-Infinity, LEFT_LIMITS), 160);
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

// --- panelWidthMathJs (webview client copy) parity against these TS twins --------
//
// The webview's inline <script> cannot `import` this module, so webviewClientUtils.ts's
// panelWidthMathJs() generates a JS-text copy of clampPanelWidth/resolvePanelWidth/
// isPanelVisible from the same algorithm. These tests evaluate that generated text
// (see compile() above) and assert it agrees with the real TS functions for the same
// fixtures, so a future edit to either copy that drifts from the other fails a test
// instead of merely looking the same on a diff (see webviewClientUtils.ts's header,
// BUG-012).

test("panelWidthMathJs: clampPanelWidth matches the host function", () => {
  const clientClamp = compile("clampPanelWidth") as (w: number, l: PanelLimits) => number;
  const fixtures = [250, 10, 10000, 160, 400, -50, NaN, Infinity, -Infinity];
  for (const width of fixtures) {
    assert.equal(
      clientClamp(width, LEFT_LIMITS),
      clampPanelWidth(width, LEFT_LIMITS),
      `clampPanelWidth(${width}) diverged`
    );
  }
});

test("panelWidthMathJs: resolvePanelWidth matches the host function", () => {
  const clientResolve = compile("resolvePanelWidth") as (
    p: { width?: number },
    l: PanelLimits
  ) => number;
  const fixtures = [{}, { width: 300 }, { width: 5 }, { width: 9999 }];
  for (const persisted of fixtures) {
    assert.equal(
      clientResolve(persisted, LEFT_LIMITS),
      resolvePanelWidth(persisted, LEFT_LIMITS),
      `resolvePanelWidth(${JSON.stringify(persisted)}) diverged`
    );
  }
});

test("panelWidthMathJs: isPanelVisible matches the host function", () => {
  const clientVisible = compile("isPanelVisible") as (
    p: { hidden?: boolean },
    defaultHidden: boolean
  ) => boolean;
  const fixtures: Array<[{ hidden?: boolean }, boolean]> = [
    [{}, false],
    [{}, true],
    [{ hidden: false }, true],
    [{ hidden: true }, false],
  ];
  for (const [persisted, defaultHidden] of fixtures) {
    assert.equal(
      clientVisible(persisted, defaultHidden),
      isPanelVisible(persisted, defaultHidden),
      `isPanelVisible(${JSON.stringify(persisted)}, ${defaultHidden}) diverged`
    );
  }
});
