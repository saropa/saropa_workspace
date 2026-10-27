// Unit tests for the configureRunAssets webview assets: the inlined stylesheet and client script
// must be well-formed and self-contained, since a mistake only shows up at runtime
// as a blank panel.

import { test } from "node:test";
import assert from "node:assert/strict";
import { CONFIGURE_RUN_STYLE, CONFIGURE_RUN_SCRIPT } from "../views/configureRunAssets";
import { assertScriptParses, assertCssBalanced, assertNoRemoteLoads, assertSingleApiHandle } from "./assetChecks";

test("the stylesheet has balanced braces and loads nothing remote", () => {
  assertCssBalanced("CONFIGURE_RUN_STYLE", CONFIGURE_RUN_STYLE);
  assertNoRemoteLoads("CONFIGURE_RUN_STYLE", CONFIGURE_RUN_STYLE);
});

test("the stylesheet binds colors to VS Code theme variables", () => {
  assert.ok(CONFIGURE_RUN_STYLE.includes("var(--vscode-"));
});

test("the client script parses as JavaScript and loads nothing remote", () => {
  assertScriptParses("CONFIGURE_RUN_SCRIPT", CONFIGURE_RUN_SCRIPT);
  assertNoRemoteLoads("CONFIGURE_RUN_SCRIPT", CONFIGURE_RUN_SCRIPT);
});

test("the client script acquires the VS Code API once and listens for host messages", () => {
  assertSingleApiHandle("CONFIGURE_RUN_SCRIPT", CONFIGURE_RUN_SCRIPT);
  assert.ok(/addEventListener\((['"])message\1/.test(CONFIGURE_RUN_SCRIPT));
});
