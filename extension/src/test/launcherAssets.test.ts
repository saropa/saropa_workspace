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

test("LAUNCHER_STYLE: the card grid is responsive (auto-fill columns)", () => {
  // The whole reason this is a webview and not a TreeView: the Panel is wide and short,
  // so each group's card grid must reflow into multiple columns to use the width. An
  // auto-fill / minmax track is what makes the column count follow the Panel width.
  assert.ok(/grid-template-columns:\s*repeat\(\s*auto-fill/.test(LAUNCHER_STYLE));
  assert.ok(/minmax\(/.test(LAUNCHER_STYLE));
});

test("LAUNCHER_STYLE: the two panes reflow (auto-fit columns)", () => {
  // My-shortcuts and Recipes sit side by side when the Panel is wide and stack when
  // narrow; an auto-fit track on .panes is what collapses two columns to one.
  assert.ok(/\.panes\s*\{[^}]*grid-template-columns:\s*repeat\(\s*auto-fit/.test(LAUNCHER_STYLE));
});

test("LAUNCHER_STYLE: hides filtered cards and empty groups/panes via the .hidden class", () => {
  // The client toggles `.hidden { display: none }` on non-matching cards and on a group
  // or pane left with no visible card; losing these rules would show everything during
  // a search.
  assert.ok(/\.card\.hidden\s*\{\s*display:\s*none/.test(LAUNCHER_STYLE));
  assert.ok(/\.group\.hidden\s*\{\s*display:\s*none/.test(LAUNCHER_STYLE));
  assert.ok(/\.pane\.hidden\s*\{\s*display:\s*none/.test(LAUNCHER_STYLE));
});

test("LAUNCHER_STYLE: the kind pill is neutral gray, not tinted with --card-tint", () => {
  // The SHELL/MACRO/COMMAND/ROUTINE pill must stay a muted gray so the board does not
  // read as over-colored — the card already signals its kind through the tinted left
  // stripe and icon. A regression that re-tinted .chip with --card-tint is what this
  // guards. Match the .chip block specifically (the only rule that styles the pill).
  const chip = LAUNCHER_STYLE.match(/\.chip\s*\{[^}]*\}/);
  assert.ok(chip, ".chip rule must exist");
  assert.ok(
    chip[0].includes("var(--vscode-descriptionForeground)"),
    ".chip must use the neutral description foreground"
  );
  assert.ok(
    !chip[0].includes("--card-tint"),
    ".chip must not borrow the card accent (--card-tint)"
  );
});

test("LAUNCHER_STYLE: an expanded card hides the head run button (no duplicate Run)", () => {
  // The drawer carries a full labeled Run button, so the head's compact play button must be
  // hidden once expanded — otherwise the same card shows two Run affordances. This guards a
  // regression that left the head .run visible in the expanded state.
  assert.ok(/\.card\.expanded\s+\.run\s*\{[^}]*display:\s*none/.test(LAUNCHER_STYLE));
});

test("LAUNCHER_STYLE: drawer actions are right-aligned", () => {
  // Open/Run sit at the card's trailing edge, away from the leading name/path column.
  const actions = LAUNCHER_STYLE.match(/\.drawer-actions\s*\{[^}]*\}/);
  assert.ok(actions, ".drawer-actions rule must exist");
  assert.ok(
    actions[0].includes("justify-content: flex-end"),
    ".drawer-actions must right-align with justify-content: flex-end"
  );
});

test("LAUNCHER_STYLE: the card grid sizes cards to content, never stretches a row", () => {
  // align-items:start keeps each card at its own content height. Without it the grid's
  // default stretch made every card in a row match the tallest, so expanding one card's
  // drawer stretched all its row-mates. This guards that regression.
  const grid = LAUNCHER_STYLE.match(/\.grid\s*\{[^}]*\}/);
  assert.ok(grid, ".grid rule must exist");
  assert.ok(
    grid[0].includes("align-items: start"),
    ".grid must use align-items: start so an expanded card does not stretch its row"
  );
});

test("LAUNCHER_STYLE: the card grid is indented under its group heading", () => {
  // .group-body carries a left padding so cards sit under the group label (past the
  // header chevron + glyph), making the group-to-cards hierarchy legible.
  assert.ok(/\.group-body\s*\{[^}]*padding-left:/.test(LAUNCHER_STYLE));
});

test("LAUNCHER_STYLE: the search group is width-capped, not full-width", () => {
  // The Panel is very wide; an uncapped search input stretched across the whole surface.
  // .search must carry a max-width so it stays a compact cluster on the leading edge.
  const search = LAUNCHER_STYLE.match(/\.search\s*\{[^}]*\}/);
  assert.ok(search, ".search rule must exist");
  assert.ok(
    search[0].includes("max-width:"),
    ".search must cap its width so it does not span the wide Panel"
  );
});

test("LAUNCHER_SCRIPT: recipe cards expose Pin and Schedule drawer buttons", () => {
  // A recipe is detected, not adopted. The drawer must surface Pin (promoteRecipe) and
  // Schedule (scheduleRecipe) on the recipes pane so those actions are discoverable on the
  // card rather than only in the right-click menu. Guards a regression that dropped either
  // button or the pane gate.
  assert.ok(LAUNCHER_SCRIPT.includes("it.pane === 'recipes'"));
  assert.ok(LAUNCHER_SCRIPT.includes("saropaWorkspace.promoteRecipe"));
  assert.ok(LAUNCHER_SCRIPT.includes("saropaWorkspace.scheduleRecipe"));
});

test("LAUNCHER_SCRIPT: routes right-click menu choices as command messages", () => {
  // A right-click posts the chosen command id back to the host, which re-resolves the
  // shortcut and executes it. Both halves (the 'command' type and the contextmenu hook)
  // must stay present or the menu silently does nothing.
  assert.ok(LAUNCHER_SCRIPT.includes("'command'"));
  assert.ok(LAUNCHER_SCRIPT.includes("contextmenu"));
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
