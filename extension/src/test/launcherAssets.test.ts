// Unit tests for the Saropa Launcher webview assets (launcherAssets.ts): the inlined
// CSS (LAUNCHER_STYLE) and client script (LAUNCHER_SCRIPT) the Panel view injects under
// its per-load nonce. These are plain exported string constants with no VS Code
// dependency, so they run under Node's runner. The tests guard the invariants the host
// relies on — theme-bound colors only (no hardcoded palette), a responsive grid (so the
// wide Panel is not wasted by a single column), the host-substituted count placeholders,
// and DOM construction via textContent rather than innerHTML — since a regression here
// would only surface as a broken or unsafe webview at runtime.

import { test } from "node:test";
import assert from "node:assert/strict";
import { LAUNCHER_STYLE, LAUNCHER_SCRIPT } from "../views/launcherAssets";

// --- LAUNCHER_STYLE -----------------------------------------------------

test("LAUNCHER_STYLE: is a non-empty stylesheet", () => {
  assert.equal(typeof LAUNCHER_STYLE, "string");
  assert.ok(LAUNCHER_STYLE.length > 0);
});

test("LAUNCHER_STYLE: every color binds to a --vscode-* theme variable", () => {
  // The launcher must match the editor in light/dark/high-contrast, which only holds
  // when colors come from theme variables rather than a hardcoded palette. A stray hex
  // literal would break that.
  assert.ok(
    !/#[0-9a-fA-F]{3,6}\b/.test(LAUNCHER_STYLE),
    "LAUNCHER_STYLE must not hardcode a hex color"
  );
  assert.ok(LAUNCHER_STYLE.includes("var(--vscode-"));
});

test("LAUNCHER_STYLE: the grid is responsive (auto-fill columns)", () => {
  // The whole reason this is a webview and not a TreeView: the Panel is wide and short,
  // so the grid must reflow into multiple columns to use the width. An auto-fill /
  // minmax track is what makes the column count follow the Panel width.
  assert.ok(/grid-template-columns:\s*repeat\(\s*auto-fill/.test(LAUNCHER_STYLE));
  assert.ok(/minmax\(/.test(LAUNCHER_STYLE));
});

test("LAUNCHER_STYLE: hides filtered cards and empty sections via the .hidden class", () => {
  // The client toggles `.hidden { display: none }` on non-matching cards and on a
  // section left with no visible card; losing these rules would show everything during
  // a search.
  assert.ok(/\.card\.hidden\s*\{\s*display:\s*none/.test(LAUNCHER_STYLE));
  assert.ok(/\.section\.hidden\s*\{\s*display:\s*none/.test(LAUNCHER_STYLE));
});

// --- LAUNCHER_SCRIPT ----------------------------------------------------

test("LAUNCHER_SCRIPT: is a non-empty client script", () => {
  assert.equal(typeof LAUNCHER_SCRIPT, "string");
  assert.ok(LAUNCHER_SCRIPT.length > 0);
});

test("LAUNCHER_SCRIPT: handles the host 'data' message and announces 'ready'", () => {
  // The host replies with a `data` message only after the webview posts `ready` (so the
  // post never races the listener). Both halves of that handshake must stay present.
  assert.ok(LAUNCHER_SCRIPT.includes("'data'"));
  assert.ok(LAUNCHER_SCRIPT.includes("'ready'"));
});

test("LAUNCHER_SCRIPT: emits run/open messages the host routes to the store", () => {
  // A file card opens, an action runs, the ▶ always runs — the host's onMessage
  // switches on exactly these two types.
  assert.ok(LAUNCHER_SCRIPT.includes("'open'"));
  assert.ok(LAUNCHER_SCRIPT.includes("'run'"));
});

test("LAUNCHER_SCRIPT: references the host-substituted count placeholders", () => {
  // The host posts the count strings with literal {n}/{shown}/{total}; the script
  // substitutes the live numbers. Renaming a token on one side without the other would
  // leave the placeholder showing through.
  assert.ok(LAUNCHER_SCRIPT.includes("{n}"));
  assert.ok(LAUNCHER_SCRIPT.includes("{shown}"));
  assert.ok(LAUNCHER_SCRIPT.includes("{total}"));
});

test("LAUNCHER_SCRIPT: builds rows with textContent, never innerHTML", () => {
  // Labels and paths are untrusted text; injecting them as HTML would be an XSS vector
  // inside the webview. The renderer must use textContent only.
  assert.ok(LAUNCHER_SCRIPT.includes("textContent"));
  assert.ok(
    !LAUNCHER_SCRIPT.includes("innerHTML"),
    "LAUNCHER_SCRIPT must not assign innerHTML"
  );
});
