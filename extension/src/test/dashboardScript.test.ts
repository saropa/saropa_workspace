// Unit tests for the assembled dashboard client script and its tab fragments.

import { test } from "node:test";
import assert from "node:assert/strict";
import { PANEL_SCRIPT } from "../views/dashboardScript";
import { DASHBOARD_CORE } from "../views/dashboard/dashboardScriptCore";
import { DASHBOARD_PROCESSES } from "../views/dashboard/dashboardScriptProcesses";
import { DASHBOARD_ANALYTICS } from "../views/dashboard/dashboardScriptAnalytics";
import { DASHBOARD_TRENDS } from "../views/dashboard/dashboardScriptTrends";
import { DASHBOARD_BOOTSTRAP } from "../views/dashboard/dashboardScriptBootstrap";
import { assertScriptParses, assertNoRemoteLoads, assertSingleApiHandle } from "./assetChecks";

// The host shell defines these two globals ahead of the script (see dashboardShell).
const PRELUDE = 'const INITIAL_TAB = "processes"; const STRINGS = {};\n';

const FRAGMENTS = {
  core: DASHBOARD_CORE,
  processes: DASHBOARD_PROCESSES,
  analytics: DASHBOARD_ANALYTICS,
  trends: DASHBOARD_TRENDS,
  bootstrap: DASHBOARD_BOOTSTRAP,
};

test("the assembled script parses with the shell's globals in front of it", () => {
  assertScriptParses("PANEL_SCRIPT", PRELUDE + PANEL_SCRIPT);
  assertNoRemoteLoads("PANEL_SCRIPT", PANEL_SCRIPT);
});

test("the VS Code API is acquired once, in the core fragment", () => {
  assertSingleApiHandle("PANEL_SCRIPT", PANEL_SCRIPT);
  assert.ok(DASHBOARD_CORE.includes("acquireVsCodeApi()"));
});

test("every fragment is non-empty and appears in the assembled script, in order", () => {
  let from = 0;
  for (const [name, fragment] of Object.entries(FRAGMENTS)) {
    assert.ok(fragment.trim().length > 0, `${name} is empty`);
    const at = PANEL_SCRIPT.indexOf(fragment, from);
    assert.ok(at >= 0, `${name} missing or out of order`);
    from = at + fragment.length;
  }
});

test("the bootstrap fragment listens for host messages", () => {
  assert.ok(/addEventListener\((['"])message\1/.test(DASHBOARD_BOOTSTRAP));
});
