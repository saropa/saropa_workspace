// Unit tests for the customizeAssets webview assets: the inlined stylesheet and client script
// must be well-formed and self-contained, since a mistake only shows up at runtime
// as a blank panel.

import { test } from "node:test";
import assert from "node:assert/strict";
import { CUSTOMIZE_STYLE, CUSTOMIZE_SCRIPT } from "../views/customizeAssets";
import { assertScriptParses, assertCssBalanced, assertNoRemoteLoads, assertSingleApiHandle } from "./assetChecks";

test("the stylesheet has balanced braces and loads nothing remote", () => {
  assertCssBalanced("CUSTOMIZE_STYLE", CUSTOMIZE_STYLE);
  assertNoRemoteLoads("CUSTOMIZE_STYLE", CUSTOMIZE_STYLE);
});

test("the stylesheet binds colors to VS Code theme variables", () => {
  assert.ok(CUSTOMIZE_STYLE.includes("var(--vscode-"));
});

test("the client script parses as JavaScript and loads nothing remote", () => {
  assertScriptParses("CUSTOMIZE_SCRIPT", CUSTOMIZE_SCRIPT);
  assertNoRemoteLoads("CUSTOMIZE_SCRIPT", CUSTOMIZE_SCRIPT);
});

test("the client script acquires the VS Code API once and listens for host messages", () => {
  assertSingleApiHandle("CUSTOMIZE_SCRIPT", CUSTOMIZE_SCRIPT);
  assert.ok(/addEventListener\((['"])message\1/.test(CUSTOMIZE_SCRIPT));
});
