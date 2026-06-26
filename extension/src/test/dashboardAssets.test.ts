// Unit tests for the dashboard webview assets (dashboardAssets.ts): the inlined CSS
// (PANEL_STYLE) and client script (PANEL_SCRIPT) the panel injects under its per-load
// nonce. These are plain exported string constants with no VS Code dependency, so they
// run under Node's built-in runner with the vscode stub. The tests guard the invariants
// the panel host relies on — theme-bound colors only (no hardcoded palette), no remote
// resource loads, and the script placeholders the host substitutes are present — since
// a silent regression here would only surface as a broken webview at runtime.

import { test } from "node:test";
import assert from "node:assert/strict";
import { PANEL_STYLE, PANEL_SCRIPT } from "../views/dashboardAssets";

// --- PANEL_STYLE --------------------------------------------------------

test("PANEL_STYLE: is a non-empty stylesheet", () => {
  assert.equal(typeof PANEL_STYLE, "string");
  assert.ok(PANEL_STYLE.length > 0);
});

test("PANEL_STYLE: every color binds to a --vscode-* theme variable", () => {
  // The dashboard must match the editor in light/dark/high-contrast, which only
  // holds when colors come from theme variables rather than a hardcoded palette. A
  // stray hex literal (e.g. "#fff") in a color/background declaration would break
  // that, so assert there is no 3/6-digit hex anywhere in the sheet.
  assert.ok(
    !/#[0-9a-fA-F]{3,6}\b/.test(PANEL_STYLE),
    "PANEL_STYLE must not hardcode a hex color"
  );
  // And it must actually use the theme variables (a sanity check that the binding
  // mechanism is present, not just that hexes are absent).
  assert.ok(PANEL_STYLE.includes("var(--vscode-"));
});

test("PANEL_STYLE: hides an inactive tab panel via the .hidden class", () => {
  // The client toggles `.tab-panel.hidden { display: none }` to switch tabs locally;
  // losing this rule would render every tab at once.
  assert.ok(/\.tab-panel\.hidden\s*\{\s*display:\s*none/.test(PANEL_STYLE));
});

// --- PANEL_SCRIPT -------------------------------------------------------

test("PANEL_SCRIPT: is a non-empty client script", () => {
  assert.equal(typeof PANEL_SCRIPT, "string");
  assert.ok(PANEL_SCRIPT.length > 0);
});

test("PANEL_SCRIPT: references the host-injected INITIAL_TAB / STRINGS placeholders", () => {
  // The host injects `const INITIAL_TAB = ...` and `const STRINGS = ...` ahead of
  // this script (see dashboardPanel.renderShell). The script reads both; if it
  // stopped referencing them the renamed host injection would go unused and the
  // initial tab / localized labels would be undefined at runtime.
  assert.ok(PANEL_SCRIPT.includes("INITIAL_TAB"));
  assert.ok(PANEL_SCRIPT.includes("STRINGS"));
});

test("PANEL_SCRIPT: acquires the webview API and posts messages to the host", () => {
  // The two halves of the host <-> webview contract: the script obtains the VS Code
  // API handle and posts back (activateTab / refresh / kill / openReport). Both
  // strings must survive or the panel goes inert.
  assert.ok(PANEL_SCRIPT.includes("acquireVsCodeApi"));
  assert.ok(PANEL_SCRIPT.includes("vscode.postMessage"));
});

test("PANEL_SCRIPT: posts an activateTab message so the host loads the tab's data", () => {
  // Tab switching is local (show/hide), but the data load is host-driven: selectTab
  // posts { type: 'activateTab' }. This is the trigger the host's onMessage switches
  // on, so the exact type string is load-bearing.
  assert.ok(PANEL_SCRIPT.includes("activateTab"));
});

test("PANEL_SCRIPT: escapes interpolated text through escapeHtml", () => {
  // Tool names, process names, and report labels are interpolated into innerHTML; an
  // escape helper is the injection guard. Its presence (and use) is the invariant.
  assert.ok(PANEL_SCRIPT.includes("escapeHtml"));
  // The helper maps the five HTML-significant characters; a regression that dropped
  // one (e.g. the double quote) would reopen an attribute-break, so spot-check it.
  assert.ok(PANEL_SCRIPT.includes("&quot;"));
});

test("PANEL_SCRIPT: charts bind to --vscode-chart variables, never a hardcoded palette", () => {
  // The line/spark charts cycle through CHART_VARS, all of which are --vscode-charts-*
  // theme variables, so the chart colors track the theme. A raw hex in the chart var
  // list would defeat that — the lone literal allowed is the '#888' cssVar fallback
  // for a variable that does not resolve. Assert the chart-variable list is present
  // and that no OTHER hex leaks in beyond that single guarded fallback.
  assert.ok(PANEL_SCRIPT.includes("--vscode-charts-blue"));
  const hexes = PANEL_SCRIPT.match(/#[0-9a-fA-F]{3,6}\b/g) ?? [];
  assert.deepEqual(
    hexes,
    ["#888"],
    `the only hex literal should be the cssVar fallback, found: ${hexes.join(", ")}`
  );
});

test("PANEL_SCRIPT: loads no remote resource (no http/https URL, no script src)", () => {
  // The panel runs under a strict CSP with no network; the charts are hand-drawn on a
  // canvas precisely so no external chart library is loaded. A literal remote URL or
  // an injected <script src> would break the CSP and add a supply-chain surface.
  assert.ok(!/https?:\/\//.test(PANEL_SCRIPT), "client script must not reference a remote URL");
  assert.ok(!/<script\s+src=/i.test(PANEL_SCRIPT), "client script must not inject a remote <script src>");
});
