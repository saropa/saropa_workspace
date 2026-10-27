// Unit tests for the briefAssets webview assets: the inlined stylesheet and client script
// must be well-formed and self-contained, since a mistake only shows up at runtime
// as a blank panel.

import { test } from "node:test";
import assert from "node:assert/strict";
import { BRIEF_STYLE, BRIEF_SCRIPT } from "../views/brief/briefAssets";
import { assertScriptParses, assertCssBalanced, assertNoRemoteLoads, assertSingleApiHandle } from "./assetChecks";

test("the stylesheet has balanced braces and loads nothing remote", () => {
  assertCssBalanced("BRIEF_STYLE", BRIEF_STYLE);
  assertNoRemoteLoads("BRIEF_STYLE", BRIEF_STYLE);
});

test("the stylesheet binds colors to VS Code theme variables", () => {
  assert.ok(BRIEF_STYLE.includes("var(--vscode-"));
});

test("the client script parses as JavaScript and loads nothing remote", () => {
  assertScriptParses("BRIEF_SCRIPT", BRIEF_SCRIPT);
  assertNoRemoteLoads("BRIEF_SCRIPT", BRIEF_SCRIPT);
});

test("the client script acquires the VS Code API once and listens for host messages", () => {
  assertSingleApiHandle("BRIEF_SCRIPT", BRIEF_SCRIPT);
  assert.ok(/addEventListener\((['"])message\1/.test(BRIEF_SCRIPT));
});
