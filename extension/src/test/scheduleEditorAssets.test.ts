// Unit tests for the scheduleEditorAssets webview assets: the inlined stylesheet and client script
// must be well-formed and self-contained, since a mistake only shows up at runtime
// as a blank panel.

import { test } from "node:test";
import assert from "node:assert/strict";
import { SCHEDULE_EDITOR_STYLE, SCHEDULE_EDITOR_SCRIPT } from "../views/scheduleEditorAssets";
import { assertScriptParses, assertCssBalanced, assertNoRemoteLoads, assertSingleApiHandle } from "./_stub/assetChecks";

test("the stylesheet has balanced braces and loads nothing remote", () => {
  assertCssBalanced("SCHEDULE_EDITOR_STYLE", SCHEDULE_EDITOR_STYLE);
  assertNoRemoteLoads("SCHEDULE_EDITOR_STYLE", SCHEDULE_EDITOR_STYLE);
});

test("the stylesheet binds colors to VS Code theme variables", () => {
  assert.ok(SCHEDULE_EDITOR_STYLE.includes("var(--vscode-"));
});

test("the client script parses as JavaScript and loads nothing remote", () => {
  assertScriptParses("SCHEDULE_EDITOR_SCRIPT", SCHEDULE_EDITOR_SCRIPT);
  assertNoRemoteLoads("SCHEDULE_EDITOR_SCRIPT", SCHEDULE_EDITOR_SCRIPT);
});

test("the client script acquires the VS Code API once and listens for host messages", () => {
  assertSingleApiHandle("SCHEDULE_EDITOR_SCRIPT", SCHEDULE_EDITOR_SCRIPT);
  assert.ok(/addEventListener\((['"])message\1/.test(SCHEDULE_EDITOR_SCRIPT));
});
