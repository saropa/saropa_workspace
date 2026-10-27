// Unit tests for the schedulePanelAssets webview assets: the inlined stylesheet and client script
// must be well-formed and self-contained, since a mistake only shows up at runtime
// as a blank panel.

import { test } from "node:test";
import assert from "node:assert/strict";
import { SCHEDULE_STYLE, SCHEDULE_SCRIPT } from "../views/schedulePanelAssets";
import { assertScriptParses, assertCssBalanced, assertNoRemoteLoads, assertSingleApiHandle } from "./assetChecks";

test("the stylesheet has balanced braces and loads nothing remote", () => {
  assertCssBalanced("SCHEDULE_STYLE", SCHEDULE_STYLE);
  assertNoRemoteLoads("SCHEDULE_STYLE", SCHEDULE_STYLE);
});

test("the stylesheet binds colors to VS Code theme variables", () => {
  assert.ok(SCHEDULE_STYLE.includes("var(--vscode-"));
});

test("the client script parses as JavaScript and loads nothing remote", () => {
  assertScriptParses("SCHEDULE_SCRIPT", SCHEDULE_SCRIPT);
  assertNoRemoteLoads("SCHEDULE_SCRIPT", SCHEDULE_SCRIPT);
});

test("the client script acquires the VS Code API once and listens for host messages", () => {
  assertSingleApiHandle("SCHEDULE_SCRIPT", SCHEDULE_SCRIPT);
  assert.ok(/addEventListener\((['"])message\1/.test(SCHEDULE_SCRIPT));
});
