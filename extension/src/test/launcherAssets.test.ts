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
import { LAUNCHER_STYLE } from "../views/launcherAssets";
import { LAUNCHER_SCRIPT } from "../views/launcherScript";

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

test("LAUNCHER_STYLE: the panes reflow via flex-wrap, not a fixed grid track", () => {
  // The panes sit side by side when the Panel is wide and wrap to stacked when narrow.
  // flex-wrap (not a grid track) is used deliberately so a COLLAPSED pane can shed its
  // width — a grid track keeps its minmax width even when folded, a flex item can shrink.
  const panes = LAUNCHER_STYLE.match(/\.panes\s*\{[^}]*\}/);
  assert.ok(panes, ".panes rule must exist");
  assert.ok(panes[0].includes("display: flex"), ".panes must lay out with flex");
  assert.ok(panes[0].includes("flex-wrap: wrap"), ".panes must wrap on a narrow Panel");
});

test("LAUNCHER_STYLE: a collapsed pane sheds its width when not searching", () => {
  // Collapsing a section must also collapse its width (developer feedback 2026-06-28): a
  // folded pane shrinks to flex:0 1 auto so the row frees up for the still-open sections.
  // It is gated to :not(.searching) because a search force-reveals a collapsed pane's body,
  // which then needs the full width again. Guards a regression that re-widened a folded pane.
  assert.ok(
    /\.root:not\(\.searching\)\s+\.pane\.collapsed\s*\{[^}]*flex:\s*0 1 auto/.test(LAUNCHER_STYLE),
    "a collapsed pane (outside search) must drop to flex: 0 1 auto"
  );
});

test("LAUNCHER_STYLE: hides filtered cards and empty groups/panes via the .hidden class", () => {
  // The client toggles `.hidden { display: none }` on non-matching cards and on a group
  // or pane left with no visible card; losing these rules would show everything during
  // a search.
  assert.ok(/\.card\.hidden\s*\{\s*display:\s*none/.test(LAUNCHER_STYLE));
  assert.ok(/\.group\.hidden\s*\{\s*display:\s*none/.test(LAUNCHER_STYLE));
  assert.ok(/\.pane\.hidden\s*\{\s*display:\s*none/.test(LAUNCHER_STYLE));
});

test("LAUNCHER_SCRIPT: names the action kind on the card icon, not a standing pill", () => {
  // The SHELL/MACRO/COMMAND/ROUTINE pill was removed (developer feedback 2026-06-28): the
  // kind is already shown by the icon, its color, and the left-border tint, so it now reads
  // as a hover tooltip on the icon instead. Guards a regression that brings the pill back or
  // drops the tooltip wiring.
  assert.ok(
    !/\.chip\s*\{/.test(LAUNCHER_STYLE),
    "the .chip pill rule must be gone — the kind is shown on the icon tooltip"
  );
  assert.ok(
    LAUNCHER_SCRIPT.includes("ic.title = it.kindLabel"),
    "the card icon must carry the kind label as its tooltip"
  );
});

test("LAUNCHER_STYLE: the head action button reveals its text label only when expanded", () => {
  // The head's primary-action button (Run for a script or an action, Open for a document)
  // is icon-only in the compact grid and grows its text label when the card expands. The
  // label span is hidden by default and revealed under .card.expanded; no-duplicate-action is
  // now enforced by the drawer omitting whatever the head carries (see makeCard), not by
  // hiding the head — so the head must stay visible in both states. Guards a regression that
  // either always shows the label (crowding the grid) or hides the head on expand.
  assert.ok(/\.run-label\s*\{[^}]*display:\s*none/.test(LAUNCHER_STYLE));
  assert.ok(/\.card\.expanded\s+\.run-label\s*\{[^}]*display:\s*inline/.test(LAUNCHER_STYLE));
  assert.ok(
    !/\.card\.expanded\s+\.run\s*\{[^}]*display:\s*none/.test(LAUNCHER_STYLE),
    "the head action button must remain visible when the card is expanded"
  );
});

test("LAUNCHER_STYLE: all card buttons share one label size from one variable", () => {
  // The head Run/Open button (.run) and the drawer's action buttons (.btn) must both
  // declare font-family: inherit + font-size: var(--launcher-btn-font). Without the
  // explicit declaration a native <button> keeps the UA's own font at 1em, so the head
  // label rendered larger than the drawer labels on the same card (developer feedback
  // 2026-07-16). The size itself lives ONLY in the :root custom property, so the two
  // styles cannot drift apart and a retune is a single edit.
  assert.ok(
    /:root\s*\{[^}]*--launcher-btn-font:/.test(LAUNCHER_STYLE),
    "--launcher-btn-font must be defined on :root"
  );
  // Match EVERY block whose selector is exactly the bare class at a line start (not
  // .run:hover, .run .codicon, or .card.expanded .run-label) so a future duplicate rule
  // with the same selector is checked too, instead of the first match silently
  // shadowing it. Line-anchored because a rule may follow a comment end, not a brace.
  for (const cls of ["run", "btn"]) {
    const blocks = [...LAUNCHER_STYLE.matchAll(new RegExp(`^\\.${cls}\\s*\\{[^}]*\\}`, "gm"))];
    assert.ok(blocks.length > 0, `a bare .${cls} rule must exist`);
    for (const block of blocks) {
      assert.ok(
        block[0].includes("font-family: inherit"),
        `.${cls} must inherit the body font (a native <button> does not)`
      );
      assert.ok(
        block[0].includes("font-size: var(--launcher-btn-font)"),
        `.${cls} must read the shared --launcher-btn-font size`
      );
    }
  }
  // Single source of truth: the literal size appears only in the :root definition.
  // A second literal means a rule hardcoded the size instead of reading the variable.
  const literals = LAUNCHER_STYLE.match(/0\.88em/g) ?? [];
  assert.strictEqual(
    literals.length,
    1,
    "the button label size literal must appear exactly once (the :root variable)"
  );
});

test("LAUNCHER_STYLE: the expanded head button shares the drawer buttons' padding", () => {
  // Collapsed, the head Run/Open button is icon-only and keeps a compact box; expanded,
  // its text label appears directly above the drawer's .btn row, so it must adopt the
  // same --launcher-btn-pad box or the two read as mismatched buttons (developer
  // feedback 2026-07-17). The padding literal lives ONLY in the :root custom property.
  assert.ok(
    /:root\s*\{[^}]*--launcher-btn-pad:/.test(LAUNCHER_STYLE),
    "--launcher-btn-pad must be defined on :root"
  );
  // Every bare .btn block reads the shared padding (line-anchored matchAll, same
  // rationale as the font test above).
  const btnBlocks = [...LAUNCHER_STYLE.matchAll(/^\.btn\s*\{[^}]*\}/gm)];
  assert.ok(btnBlocks.length > 0, "a bare .btn rule must exist");
  for (const block of btnBlocks) {
    assert.ok(
      block[0].includes("padding: var(--launcher-btn-pad)"),
      ".btn must read the shared --launcher-btn-pad box"
    );
  }
  assert.ok(
    /\.card\.expanded\s+\.run\s*\{[^}]*padding:\s*var\(--launcher-btn-pad\)/.test(LAUNCHER_STYLE),
    "the expanded head button must read the shared --launcher-btn-pad box"
  );
  // Single source of truth: the padding literal appears only in the :root definition.
  const padLiterals = LAUNCHER_STYLE.match(/4px 9px 3px/g) ?? [];
  assert.strictEqual(
    padLiterals.length,
    1,
    "the button padding literal must appear exactly once (the :root variable)"
  );
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

test("LAUNCHER_STYLE: a collapsed pane folds its body but keeps the head visible", () => {
  // A whole pane (My shortcuts / Recipes / Watches / Project files) collapses to just its
  // head: .pane.collapsed hides the .pane-body and rotates the chevron. Losing the body rule
  // would leave a "collapsed" pane fully expanded.
  assert.ok(/\.pane\.collapsed\s+\.pane-body\s*\{[^}]*display:\s*none/.test(LAUNCHER_STYLE));
  assert.ok(/\.pane\.collapsed\s+\.pane-chevron\s*\{[^}]*transform:/.test(LAUNCHER_STYLE));
});

test("LAUNCHER_STYLE: a search reveals a collapsed pane's body", () => {
  // While a query is active, a folded pane must still show its matching cards; the
  // .root.searching override re-displays .pane-body. It must be declared after the collapsed
  // rule to win at equal specificity.
  const collapsedIdx = LAUNCHER_STYLE.indexOf(".pane.collapsed .pane-body");
  const searchIdx = LAUNCHER_STYLE.indexOf(".root.searching .pane .pane-body");
  assert.ok(collapsedIdx !== -1, "collapsed pane-body rule must exist");
  assert.ok(searchIdx !== -1, "searching pane-body reveal rule must exist");
  assert.ok(
    searchIdx > collapsedIdx,
    "the search-reveal rule must come after the collapsed rule so it wins"
  );
});

test("LAUNCHER_SCRIPT: the pane head toggles a persisted pane-level collapse", () => {
  // The pane head is a button that folds the whole section; its posture persists under a
  // 'pane:'-prefixed key so a pane id can never collide with an inner group id. Guards a
  // regression that dropped the toggle or the key namespace.
  assert.ok(LAUNCHER_SCRIPT.includes("pane-chevron"));
  assert.ok(LAUNCHER_SCRIPT.includes("'pane:' + pane.id"));
  assert.ok(LAUNCHER_SCRIPT.includes("setCollapsed(paneKey"));
});

test("LAUNCHER_STYLE: the card grid is indented under its group heading", () => {
  // .group-body carries a left padding so cards sit under the group label (past the
  // header chevron + glyph), making the group-to-cards hierarchy legible.
  assert.ok(/\.group-body\s*\{[^}]*padding-left:/.test(LAUNCHER_STYLE));
});

test("LAUNCHER_STYLE: the search group is width-capped, not full-width", () => {
  // The Panel is very wide; an uncapped search input stretched across the whole surface.
  // .search must carry a max-width so it stays a compact cluster on the trailing edge.
  const search = LAUNCHER_STYLE.match(/\.search\s*\{[^}]*\}/);
  assert.ok(search, ".search rule must exist");
  assert.ok(
    search[0].includes("max-width:"),
    ".search must cap its width so it does not span the wide Panel"
  );
});

test("LAUNCHER_STYLE: the header is a space-between bar so search trails and project leads", () => {
  // .head-bar splits the project block (leading) from the search group (trailing). A
  // regression that dropped space-between would re-stack them and lose the moved layout.
  const bar = LAUNCHER_STYLE.match(/\.head-bar\s*\{[^}]*\}/);
  assert.ok(bar, ".head-bar rule must exist");
  assert.ok(
    bar[0].includes("justify-content: space-between"),
    ".head-bar must push the project block and search to opposite edges"
  );
  assert.ok(bar[0].includes("flex-wrap: wrap"), ".head-bar must wrap on a narrow Panel");
});

test("LAUNCHER_STYLE: the project name ellipsizes and the version reads in the foreground", () => {
  // The project name is a single line that must clip rather than overflow; the version is
  // the headline fact, so it uses the regular foreground while the counts stay dimmed.
  assert.ok(/\.project-name\s*\{[^}]*text-overflow:\s*ellipsis/.test(LAUNCHER_STYLE));
  const version = LAUNCHER_STYLE.match(/\.meta-item\.version\s*\{[^}]*\}/);
  assert.ok(version, ".meta-item.version rule must exist");
  assert.ok(
    version[0].includes("var(--vscode-foreground)"),
    "the version must read in the regular foreground, not the dimmed description color"
  );
});

test("LAUNCHER_STYLE: the project block lays its parts on one row", () => {
  // The name + version + counts read as a single line (developer feedback 2026-06-28),
  // which only holds when .project is a flex row rather than the earlier name-over-meta
  // column. A regression back to a column would re-stack the header.
  const project = LAUNCHER_STYLE.match(/\.project\s*\{[^}]*\}/);
  assert.ok(project, ".project rule must exist");
  assert.ok(
    project[0].includes("flex-direction: row"),
    ".project must be a row so the name and counts share one line"
  );
});

test("LAUNCHER_STYLE: a header stat is a clickable filter chip", () => {
  // Each count is a filter toggle (a <button class='meta-item filter'>); the .filter rule
  // gives it the hover/active affordance and an .active highlight for the engaged filter.
  // Losing either rule would make the stat look like plain text, not a control.
  assert.ok(
    /\.meta-item\.filter\s*\{/.test(LAUNCHER_STYLE),
    ".meta-item.filter rule must exist so a stat reads as clickable"
  );
  assert.ok(
    /\.meta-item\.filter\.active\s*\{/.test(LAUNCHER_STYLE),
    ".meta-item.filter.active rule must exist so the engaged filter stays highlighted"
  );
});

test("LAUNCHER_SCRIPT: renders the header from the host-posted header object", () => {
  // The host posts { project, version, stats }; renderHeader writes the name, version chip,
  // and per-pane counts. Both the call from the data handler and the function must persist.
  assert.ok(LAUNCHER_SCRIPT.includes("renderHeader(msg.header)"));
  assert.ok(LAUNCHER_SCRIPT.includes("function renderHeader"));
  // The header text is set via textContent, never innerHTML — the no-innerHTML test already
  // guards the file, but the project name/version are untrusted host values too.
  assert.ok(LAUNCHER_SCRIPT.includes("projName.textContent"));
});

test("LAUNCHER_SCRIPT: a header stat filters the board to its pane", () => {
  // A stat carries a pane; clicking it sets activePane to narrow the board to that pane's
  // cards, and the card filter must combine the pane match with the text match (a card shows
  // only when it passes both). Guards a regression that dropped the filter wiring or let the
  // pane filter and the search diverge.
  assert.ok(LAUNCHER_SCRIPT.includes("activePane"), "the filter state must exist");
  assert.ok(
    LAUNCHER_SCRIPT.includes("matchText && matchPane"),
    "a card must match both the text needle and the active pane filter"
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

test("LAUNCHER_SCRIPT: drawer action buttons use the primary (blue) style", () => {
  // The drawer's Open/Copy path/Pin/Schedule actions must render as .btn.primary, not the
  // secondary gray .btn, which read as flat labels rather than tappable buttons (developer
  // feedback 2026-06-28). actionButton's third argument is the `primary` flag; every drawer
  // call passes true, so no secondary-style drawer button slips back in.
  assert.ok(
    LAUNCHER_SCRIPT.includes("actionButton(strings.pin || 'Pin', 'star-full', true"),
    "Pin must be a primary button"
  );
  assert.ok(
    LAUNCHER_SCRIPT.includes("actionButton(strings.schedule || 'Schedule', 'clock', true"),
    "Schedule must be a primary button"
  );
  assert.ok(
    LAUNCHER_SCRIPT.includes("actionButton(strings.copyPath || 'Copy path', 'copy', true"),
    "Copy path must be a primary button"
  );
});

test("LAUNCHER_SCRIPT: suppresses the card subtitle when it only echoes the name", () => {
  // A root-level file shortcut carries its bare filename as both label and path (e.g.
  // CHANGELOG.md), so rendering the path under the title duplicated the text. makeCard must
  // gate the .card-sub element on the sub differing from the label, never render it blindly.
  assert.ok(
    LAUNCHER_SCRIPT.includes("it.sub !== it.label"),
    "makeCard must skip the subtitle when it equals the label"
  );
});

test("LAUNCHER_SCRIPT: routes right-click menu choices as command messages", () => {
  // A right-click posts the chosen command id back to the host, which re-resolves the
  // shortcut and executes it. Both halves (the 'command' type and the contextmenu hook)
  // must stay present or the menu silently does nothing.
  assert.ok(LAUNCHER_SCRIPT.includes("'command'"));
  assert.ok(LAUNCHER_SCRIPT.includes("contextmenu"));
});

test("LAUNCHER_SCRIPT: wires a flat 'scripts' pane into the pane model", () => {
  // paneModel() groups items by pane id; a card with pane:'scripts' only surfaces if
  // both the flat-pane bucket AND the returned pane array carry a matching 'scripts'
  // entry. Missing either half silently drops every script card from the board.
  assert.ok(
    LAUNCHER_SCRIPT.includes("id: 'scripts', title: strings.scripts"),
    "the flat pane bucket must exist"
  );
  assert.ok(
    LAUNCHER_SCRIPT.includes("id: 'scripts', icon: 'library'"),
    "the returned pane array must include the scripts pane"
  );
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
  // A document card opens, a script or action runs — the host's onMessage switches on
  // exactly these two types.
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
