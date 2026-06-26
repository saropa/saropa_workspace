// Invariant tests for the Schedule & Workflow Planner webview stylesheet
// (PLANNER_STYLE) and the re-export of its client script (PLANNER_SCRIPT). The
// asset is a single inlined CSS string injected under the panel's per-load nonce,
// so it has no DOM to render here — instead these assert the contract the design
// system requires of it:
//   - it themes through --vscode-* variables (so light / dark / high-contrast all
//     work) rather than hardcoding editor colors;
//   - the ONLY fixed colors are the documented Saropa brand orange tokens, so a
//     stray hex literal (which would not follow the theme) is caught at write time;
//   - it ships the prefers-reduced-motion guard the accessibility bar mandates;
//   - it re-exports PLANNER_SCRIPT from one place so plannerPanel.ts keeps a single
//     import site.
// These are pure string constants (no vscode host), so they bundle and run under
// node --test against the vscode stub.

import { test } from "node:test";
import assert from "node:assert/strict";
import { PLANNER_STYLE, PLANNER_SCRIPT } from "../views/plannerAssets";

// The brand tokens are the documented exception to "theme everything": the only
// fixed (non --vscode-*) colors allowed in the sheet. Any other bare hex would be a
// color that ignores the editor theme — exactly what this file is meant to forbid.
const BRAND_HEXES = ["#f97316", "#ea580c"];

test("PLANNER_STYLE binds surfaces to --vscode-* theme variables", () => {
  // A representative set of theme bindings the hero / inset / foreground rely on.
  // If the sheet stopped theming through these, the panel would clash with the
  // editor in dark / high-contrast — the regression this guards.
  for (const token of [
    "--vscode-editor-background",
    "--vscode-foreground",
    "--vscode-focusBorder",
    "--vscode-button-foreground",
    "--vscode-descriptionForeground",
  ]) {
    assert.ok(
      PLANNER_STYLE.includes(token),
      `stylesheet should bind to ${token}`
    );
  }
});

test("the only raw fixed colors are the documented Saropa brand hexes", () => {
  // Two color patterns are sanctioned in the sheet:
  //   1. a --vscode-* var() FALLBACK hex, e.g. var(--vscode-charts-green, #3fb950) —
  //      the theme value with a safety default, which is the correct pattern; and
  //   2. the brand orange tokens (#f97316 / #ea580c) plus the white-on-orange
  //      button text (#fff).
  // Strip the legitimate var() fallbacks, then assert every REMAINING hex is a
  // sanctioned brand/white literal. A new raw hex slipped in at a call site (a
  // theme-ignoring color) would survive the strip and fail here.
  const withoutFallbacks = PLANNER_STYLE.replace(
    /var\([^()]*?,\s*#[0-9a-fA-F]{3,8}\s*\)/g,
    "var()"
  );
  const rawHexes = (withoutFallbacks.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).map((h) =>
    h.toLowerCase()
  );
  const stray = rawHexes.filter(
    (h) => !BRAND_HEXES.includes(h) && h !== "#fff"
  );
  assert.deepEqual(
    stray,
    [],
    `unexpected hardcoded colors (theme through --vscode-* instead): ${stray.join(", ")}`
  );
  // Sanity: the brand orange itself IS present as a raw token (proving the strip
  // did not over-match and erase everything).
  assert.ok(rawHexes.includes("#f97316"), "brand orange should remain after the strip");
});

test("the brand orange tokens are defined exactly once in :root", () => {
  // Single source of truth: --brand / --brand-2 carry the orange, so a call site
  // never re-spells the hex. Each definition should appear once (the `--brand:`
  // declaration), proving the value is centralized in the token block.
  assert.equal(
    (PLANNER_STYLE.match(/--brand:\s*#f97316/g) ?? []).length,
    1,
    "--brand should be declared once"
  );
  assert.equal(
    (PLANNER_STYLE.match(/--brand-2:\s*#ea580c/g) ?? []).length,
    1,
    "--brand-2 should be declared once"
  );
});

test("PLANNER_STYLE ships the prefers-reduced-motion accessibility guard", () => {
  // The motion guard is a hard accessibility requirement: under reduced-motion the
  // sheet must disable its animations/transitions. Assert both the media query and
  // that it neutralizes animation, not just transition.
  assert.ok(
    PLANNER_STYLE.includes("@media (prefers-reduced-motion: reduce)"),
    "reduced-motion media query must be present"
  );
  const guard = PLANNER_STYLE.slice(
    PLANNER_STYLE.indexOf("prefers-reduced-motion")
  );
  assert.ok(
    /animation:\s*none/.test(guard),
    "the guard must cancel animations under reduced motion"
  );
});

test("PLANNER_STYLE declares the color-scheme so the panel honors light and dark", () => {
  // color-scheme: light dark lets form controls and scrollbars match the active
  // theme; without it a dark editor would render light native widgets.
  assert.ok(PLANNER_STYLE.includes("color-scheme: light dark"));
});

test("plannerAssets re-exports PLANNER_SCRIPT from one place", () => {
  // plannerPanel.ts imports both PLANNER_STYLE and PLANNER_SCRIPT from this module;
  // the re-export keeps that single import site valid even though the script lives
  // in its own file. A non-empty string proves the re-export resolved.
  assert.equal(typeof PLANNER_SCRIPT, "string");
  assert.ok(PLANNER_SCRIPT.length > 0);
});
