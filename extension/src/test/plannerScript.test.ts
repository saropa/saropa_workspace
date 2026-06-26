// Invariant tests for the Planner webview's inlined client renderer
// (PLANNER_SCRIPT). The script is a string injected under the panel's nonce and
// run in the webview; it has no host here, so these assert the contract the host
// (plannerPanel.ts) depends on rather than executing the DOM code:
//   - the postMessage protocol: every intent string the host's onMessage switch
//     handles must be emitted by the script, and the inbound 'data' message it
//     consumes must be the one the host posts;
//   - HTML escaping: the esc() map neutralizes the five markup-significant
//     characters before any payload string reaches innerHTML (nothing trusts the
//     graph as markup — the security posture the panel comment states);
//   - theming: the inline SVG arrow marker fills from a --vscode-* derived token,
//     not a raw color, so the workflow edges follow the editor theme.
// Pure string constant (no vscode host), so it bundles and runs under node --test.

import { test } from "node:test";
import assert from "node:assert/strict";
import { PLANNER_SCRIPT } from "../views/plannerScript";

test("acquires the webview API and announces 'ready' on boot", () => {
  // The renderer must obtain the messaging handle and tell the host it is ready so
  // the host pushes the first graph payload (see plannerPanel push()).
  assert.ok(PLANNER_SCRIPT.includes("acquireVsCodeApi()"));
  assert.ok(
    PLANNER_SCRIPT.includes("send({ type:'ready' })"),
    "the boot sequence must post a 'ready' intent"
  );
});

test("emits every outbound intent the host's onMessage switch handles", () => {
  // The host (plannerPanel onMessage) routes on these type strings. If the script
  // stopped sending one, that gesture would silently do nothing — so each must
  // appear as a posted message shape in the renderer.
  for (const type of [
    "refresh",
    "run",
    "open",
    "configureSchedule",
    "configureTriggers",
    "toggleEnabled",
    "retime",
    "addTrigger",
    "removeTrigger",
    "savePositions",
  ]) {
    assert.ok(
      PLANNER_SCRIPT.includes(`type:'${type}'`),
      `renderer should emit a {type:'${type}'} message`
    );
  }
});

test("consumes the inbound 'data' message the host posts", () => {
  // plannerPanel.push() posts { type:'data', data, positions, nowMin }. The renderer
  // must branch on that type and read those three payload fields to repaint.
  assert.ok(PLANNER_SCRIPT.includes("m.type==='data'"));
  assert.ok(PLANNER_SCRIPT.includes("m.data"), "reads the graph payload");
  assert.ok(PLANNER_SCRIPT.includes("m.positions"), "reads saved node positions");
  assert.ok(PLANNER_SCRIPT.includes("m.nowMin"), "reads the now-minute marker");
});

test("retime carries the day move and snapped time the host expects", () => {
  // The host retime() reads id / atTime / fromDay / toDay. Assert the drag handler
  // posts all four so a week-block drag can both retime and move weekday.
  assert.ok(PLANNER_SCRIPT.includes("type:'retime'"));
  for (const field of ["fromDay:", "toDay:", "atTime:"]) {
    assert.ok(
      PLANNER_SCRIPT.includes(field),
      `retime message should carry ${field}`
    );
  }
});

test("esc() escapes all five markup-significant characters", () => {
  // The escaping map is the security boundary: a pin label is untrusted text and is
  // run through esc() before reaching innerHTML. All five of & < > " ' must be
  // mapped, or an injected label could break out into markup.
  for (const pair of [
    "'&':'&amp;'",
    "'<':'&lt;'",
    "'>':'&gt;'",
    "'\"':'&quot;'",
    `"'":'&#39;'`,
  ]) {
    assert.ok(
      PLANNER_SCRIPT.includes(pair),
      `esc() must map ${pair}`
    );
  }
  // And esc must coerce null/undefined to an empty string rather than the literal
  // word "null" leaking into the DOM.
  assert.ok(
    PLANNER_SCRIPT.includes("s == null ? '' : s"),
    "esc() should null-guard before stringifying"
  );
});

test("context-menu item labels use textContent, not innerHTML", () => {
  // The node context menu renders a pin's label into a button. The comment in the
  // source flags it must use textContent so a crafted label cannot inject markup;
  // assert that contract holds (textContent assignment for the menu-item text).
  assert.ok(
    PLANNER_SCRIPT.includes("b.textContent = it[0]"),
    "menu item text must be assigned via textContent"
  );
});

test("the inline SVG arrow marker fills from a theme token, not a raw color", () => {
  // The workflow edges' arrowhead is drawn in inline SVG. Its fill must reference a
  // --vscode-* derived token (var(--border-strong)) so the marker follows the
  // editor theme like the rest of the graph — a hardcoded fill would clash in dark
  // mode.
  assert.ok(
    PLANNER_SCRIPT.includes('fill="var(--border-strong)"'),
    "the arrow marker should fill from the themed border token"
  );
});

test("addTrigger distinguishes pin links from event links", () => {
  // The host addTrigger() branches on kind ('pin' records a source pin id; 'event'
  // records an event). Both link kinds must be emitted by the renderer (plug-drag /
  // autocomplete produce pin links; the toolbox drop produces event links).
  assert.ok(PLANNER_SCRIPT.includes("type:'addTrigger'"));
  assert.ok(PLANNER_SCRIPT.includes("kind:'pin'"), "pin-link trigger");
  assert.ok(PLANNER_SCRIPT.includes("kind:'event'"), "event-link trigger");
});

test("the detail inspector closes by clearing the selection", () => {
  // The inspector's (x) carries data-act="close"; the act() handler maps that to
  // select(null), which hides the panel and drops every selection highlight. Without
  // this, the close button would be inert and the column could not be dismissed.
  assert.ok(PLANNER_SCRIPT.includes('data-act="close"'), "close button must emit the close act");
  assert.ok(PLANNER_SCRIPT.includes("select(null)"), "close must clear the selection");
});

test("the detail inspector surfaces the recipe description and a pause/resume toggle", () => {
  // The inspector explains a seeded/paused recipe in place (the .dinfo note from the
  // node's description) and lets a schedule be paused/resumed without the context menu.
  assert.ok(PLANNER_SCRIPT.includes("n.description"), "renders the recipe description");
  assert.ok(PLANNER_SCRIPT.includes('class="dinfo"'), "description shows as an info note");
  assert.ok(PLANNER_SCRIPT.includes('data-act="toggle"'), "carries the pause/resume toggle");
});

test("the resizable columns persist their widths and drive the layout CSS vars", () => {
  // Both side columns (the right detail inspector and the Workflow toolbox) are
  // user-draggable. The renderer must own one resizer, write the chosen widths into
  // the --detail-w / --toolbox-w vars the stylesheet reads, and persist them so a
  // reload restores the sizes. A regression here silently freezes the columns.
  assert.ok(PLANNER_SCRIPT.includes("attachResizer"), "a shared resize helper must exist");
  assert.ok(PLANNER_SCRIPT.includes("--detail-w"), "applies the detail width var");
  assert.ok(PLANNER_SCRIPT.includes("--toolbox-w"), "applies the toolbox width var");
  for (const key of ["detailW", "toolboxW"]) {
    assert.ok(
      PLANNER_SCRIPT.includes(key),
      `saveState must persist ${key} so the width survives a reload`
    );
  }
});
