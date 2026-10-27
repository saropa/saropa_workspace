// Unit tests for the settingsAssets webview assets: the inlined stylesheet and client script
// must be well-formed and self-contained, since a mistake only shows up at runtime
// as a blank panel.

import { test } from "node:test";
import assert from "node:assert/strict";
import { SETTINGS_STYLE, SETTINGS_SCRIPT } from "../views/settingsAssets";
import { assertScriptParses, assertCssBalanced, assertNoRemoteLoads, assertSingleApiHandle } from "./_stub/assetChecks";

test("the stylesheet has balanced braces and loads nothing remote", () => {
  assertCssBalanced("SETTINGS_STYLE", SETTINGS_STYLE);
  assertNoRemoteLoads("SETTINGS_STYLE", SETTINGS_STYLE);
});

test("the stylesheet binds colors to VS Code theme variables", () => {
  assert.ok(SETTINGS_STYLE.includes("var(--vscode-"));
});

test("the client script parses as JavaScript and loads nothing remote", () => {
  assertScriptParses("SETTINGS_SCRIPT", SETTINGS_SCRIPT);
  assertNoRemoteLoads("SETTINGS_SCRIPT", SETTINGS_SCRIPT);
});

test("the client script acquires the VS Code API once and listens for host messages", () => {
  assertSingleApiHandle("SETTINGS_SCRIPT", SETTINGS_SCRIPT);
  assert.ok(/addEventListener\((['"])message\1/.test(SETTINGS_SCRIPT));
});
