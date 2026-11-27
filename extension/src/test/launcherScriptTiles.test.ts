// Tests for the launcher's tile view, run through the real shell and client script.

import { test } from "node:test";
import assert from "node:assert/strict";
import { item, openWith, card, lastState, open, dataMessage, MENU } from "./launcherWebviewFixture";
import { LAUNCHER_STYLE } from "../views/launcherAssets";

const tint = (page: ReturnType<typeof openWith>, id: string): string => card(page, id).style.getPropertyValue("--tile-tint");
const isTiles = (page: ReturnType<typeof openWith>): boolean => page.document.body.classList.contains("tiles");

test("the toggle message switches to tiles and back, saving the mode and reporting it", () => {
  const page = openWith([item({ id: "a", label: "A" })]);
  assert.equal(isTiles(page), false);
  page.receive({ type: "toggleTileView" });
  assert.equal(isTiles(page), true);
  assert.equal(lastState(page).tiles, true);
  page.receive({ type: "toggleTileView" });
  assert.equal(isTiles(page), false);
  assert.equal(lastState(page).tiles, false);
  assert.deepEqual(page.takePosted(), [
    { type: "tileViewState", enabled: true },
    { type: "tileViewState", enabled: false },
  ]);
});

test("rows mode is reported on load too, so the title icon cannot stay stale", () => {
  assert.deepEqual(open().takePosted()[1], { type: "tileViewState", enabled: false });
});

test("a saved tile mode is applied and reported on load", () => {
  const page = open({ state: { collapsed: {}, tiles: true } });
  assert.equal(isTiles(page), true);
  assert.deepEqual(page.takePosted(), [
    { type: "rightPanelVisibility", visible: false },
    { type: "tileViewState", enabled: true },
    { type: "ready" },
  ]);
});

test("a tile keeps the item's color; a neutral item gets a stable theme chart color", () => {
  const items = [
    item({ id: "own", label: "Own", color: "charts.red" }),
    item({ id: "plain", label: "Plain", color: "charts.foreground" }),
    item({ id: "note", label: "Note", color: "foreground" }),
  ];
  const page = openWith(items);
  assert.equal(tint(page, "own"), "var(--vscode-charts-red)");
  // Never a chart token: those read as watch/error/pass/warning status on this board.
  for (const id of ["plain", "note"]) {
    assert.match(tint(page, id), /^var\(--vscode-saropaWorkspace-tint-(teal|violet|purple|magenta|pink|brown)\)$/);
  }
  assert.equal(tint(openWith(items), "plain"), tint(page, "plain"));
});

test("a palette color carries the host's hex fallback", () => {
  const names = ["teal", "violet", "purple", "magenta", "pink", "brown"];
  const tintHexes = Object.fromEntries(names.map((n) => [`saropaWorkspace.tint.${n}`, "#123456"]));
  const page = openWith([item({ id: "plain", label: "Plain", color: "foreground" })], { tintHexes });
  assert.match(tint(page, "plain"), /^var\(--vscode-saropaWorkspace-tint-[a-z]+, #123456\)$/);
});

test("tiles keep the card's actions, full-text tooltips and keyboard access", () => {
  const page = openWith([item({ id: "a", label: "A long name", sub: "a/long/path", headAction: "run", menu: MENU })]);
  page.receive({ type: "toggleTileView" });
  page.takePosted();
  const a = card(page, "a");
  assert.equal(a.querySelector(".card-name")!.title, "A long name");
  assert.equal(a.querySelector(".card-sub")!.title, "a/long/path");
  const toggle = a.querySelector(".card-body")!;
  assert.equal(toggle.getAttribute("tabindex"), "0");
  page.key(toggle, "Enter");
  assert.equal(a.classList.contains("expanded"), true);
  page.key(toggle, " ");
  assert.equal(a.classList.contains("expanded"), false);
  page.click(a.querySelector("button.run")!);
  assert.deepEqual(page.takePosted(), [{ type: "run", id: "a" }]);
  page.fire(a, "contextmenu", { clientX: 1, clientY: 1 });
  assert.equal(page.all(".menu").length, 1);
});

test("the tile rules draw a full colored border and ellipsize inside the tile", () => {
  assert.match(LAUNCHER_STYLE, /body\.tiles \.card \{[^}]*border: 2px solid var\(--tile-tint/);
  assert.match(LAUNCHER_STYLE, /body\.tiles \.card-body \{[^}]*align-self: stretch/);
});

test("the toggle is an inner role=button whose aria-expanded follows the card", () => {
  const page = openWith([item({ id: "a", label: "A", headAction: "run" })]);
  const a = card(page, "a");
  const toggle = a.querySelector(".card-body")!;
  assert.equal(a.getAttribute("role"), null);
  assert.equal(a.getAttribute("tabindex"), null);
  assert.equal(toggle.getAttribute("role"), "button");
  assert.equal(toggle.querySelectorAll("button").length, 0, "no control nested in the toggle");
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
  page.click(a);
  assert.equal(toggle.getAttribute("aria-expanded"), "true");
  page.key(toggle, "Enter");
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
});

test("keys on a card's buttons and a held key do not toggle the card", () => {
  const page = openWith([item({ id: "a", label: "A", headAction: "run" })]);
  const a = card(page, "a");
  page.key(a.querySelector("button.run")!, "Enter");
  page.key(a.querySelector(".drawer-actions .btn")!, " ");
  assert.equal(a.classList.contains("expanded"), false);
  const held = page.fire(a.querySelector(".card-body")!, "keydown", Object.assign({ key: " " }, { repeat: true }));
  assert.equal(held.defaultPrevented, true);
  assert.equal(a.classList.contains("expanded"), false);
});

test("Escape and a menu action return focus to what opened the menu", () => {
  const page = openWith([item({ id: "a", label: "A", menu: MENU })]);
  const toggle = card(page, "a").querySelector(".card-body")!;
  const openFromKeyboard = (): void => {
    toggle.focus();
    page.fire(toggle, "contextmenu", { clientX: 1, clientY: 1 });
    assert.notEqual(page.document.activeElement, toggle);
  };
  openFromKeyboard();
  page.key(page.document.activeElement!, "Escape");
  assert.equal(page.all(".menu").length, 0);
  assert.equal(page.document.activeElement, toggle);
  openFromKeyboard();
  page.click(page.document.activeElement!);
  assert.equal(page.document.activeElement, toggle);
});

test("a repaint keeps focus on the same pane's card, also while its menu is open", () => {
  // The same id in two panes: the pane has to decide which one gets focus back.
  const items = [
    item({ id: 'p"\\q', label: "Mine", menu: MENU }),
    item({ id: 'p"\\q', label: "Recipe", pane: "recipes", menu: MENU }),
  ];
  const page = openWith(items);
  const toggleIn = (pane: string) => page.one(`.card[data-pane="${pane}"] .card-body`);
  const before = toggleIn("recipes");
  before.focus();
  page.receive(dataMessage(items));
  assert.notEqual(page.document.activeElement, before);
  assert.equal(page.document.activeElement, toggleIn("recipes"));
  page.fire(toggleIn("recipes"), "contextmenu", { clientX: 1, clientY: 1 });
  page.receive(dataMessage(items));
  assert.equal(page.document.activeElement, toggleIn("recipes"));
});

test("a repaint does not take focus from elsewhere or when the webview is unfocused", () => {
  const items = [item({ id: "a", label: "A" })];
  const page = openWith(items);
  page.byId("q").focus();
  page.receive(dataMessage(items));
  assert.equal(page.document.activeElement, page.byId("q"));
  const stale = card(page, "a").querySelector(".card-body")!;
  stale.focus();
  Object.assign(page.document, { hasFocus: () => false });
  page.receive(dataMessage(items));
  assert.equal(page.document.activeElement, stale, "focus() was not called on the new card");
});

test("a saved tile mode of the wrong type loads as rows and still toggles", () => {
  const page = open({ state: { collapsed: {}, tiles: "yes" } });
  assert.equal(isTiles(page), false);
  assert.deepEqual(page.takePosted()[1], { type: "tileViewState", enabled: false });
  page.receive({ type: "toggleTileView" });
  assert.equal(isTiles(page), true);
});

test("the tile rules cope with a narrow grid, unclipped long text and a drop target", () => {
  assert.match(LAUNCHER_STYLE, /minmax\(min\(100%, 128px\), 128px\)/);
  assert.match(LAUNCHER_STYLE, /container-type: inline-size/);
  assert.match(LAUNCHER_STYLE, /@container \(min-width: 266px\) \{\s*body\.tiles \.card\.expanded \{ grid-column: span 2; \}/);
  assert.equal(LAUNCHER_STYLE.match(/grid-column: span 2/g)?.length, 1, "no unconditional span");
  assert.match(LAUNCHER_STYLE, /@supports \(color: color-mix/);
  assert.match(LAUNCHER_STYLE, /body\.tiles \.drawer-desc \{ overflow-wrap: anywhere; \}/);
  const drop = LAUNCHER_STYLE.indexOf("body.tiles .card.drop-over {");
  assert.ok(drop > LAUNCHER_STYLE.indexOf("body.tiles .card.expanded {\n    background"), "drop rule comes after the tint rules");
  assert.match(LAUNCHER_STYLE.slice(drop), /^[^}]*background: var\(--vscode-list-dropBackground/);
});


const sizes = (page: ReturnType<typeof openWith>): string[] =>
  ["small", "medium", "large"].filter((s) => page.document.body.classList.contains(`tiles-${s}`));

test("tiles start large, cycle through the sizes and keep the size across rows mode", () => {
  const page = openWith([item({ id: "a", label: "A" })]);
  assert.deepEqual(sizes(page), ["large"]);
  page.receive({ type: "toggleTileView" });
  for (const next of ["small", "medium", "large", "small"]) {
    page.receive({ type: "cycleTileSize" });
    assert.deepEqual(sizes(page), [next]);
    assert.equal(lastState(page).tileSize, next);
  }
  page.receive({ type: "toggleTileView" });
  // Ignored in rows mode, where there is nothing to resize.
  page.receive({ type: "cycleTileSize" });
  page.receive({ type: "toggleTileView" });
  assert.deepEqual(sizes(page), ["small"]);
});

test("a saved size is applied on load and an unknown one loads as large", () => {
  const load = (tileSize: unknown) => openWith([], {}, { state: { collapsed: {}, tiles: true, tileSize } });
  assert.deepEqual(sizes(load("medium")), ["medium"]);
  for (const bad of ["huge", 2, null]) {
    assert.deepEqual(sizes(load(bad)), ["large"]);
  }
});

test("the toggle's tooltip holds name and subtitle, and it still works in a small tile", () => {
  const items = [item({ id: "a", label: "A", sub: "a/path" }), item({ id: "b", label: "B", sub: "B" })];
  const page = openWith(items, {}, { state: { collapsed: {}, tiles: true, tileSize: "small" } });
  const toggle = card(page, "a").querySelector(".card-body")!;
  assert.equal(toggle.title, "A\na/path");
  assert.equal(card(page, "b").querySelector(".card-body")!.title, "B", "an echoing subtitle is not repeated");
  page.key(toggle, "Enter");
  assert.equal(toggle.getAttribute("aria-expanded"), "true");
});

test("the compact sizes hide text without removing it, only while collapsed", () => {
  assert.match(LAUNCHER_STYLE, /body\.tiles\.tiles-small \.card:not\(\.expanded\) \.card-name,[^{]*\{[^}]*clip-path: inset\(50%\)/);
  assert.match(LAUNCHER_STYLE, /body\.tiles\.tiles-small \.card:not\(\.expanded\) \.card-body \{ position: absolute; inset: 0; \}/);
  assert.match(LAUNCHER_STYLE, /body\.tiles\.tiles-small \.card\.expanded \{ grid-column: 1 \/ -1; \}/);
  assert.doesNotMatch(LAUNCHER_STYLE, /tiles-(small|medium)[^{}]*\{[^}]*display: none/);
});

test("a small tile's corner button is shown where there is no hover, and a collapsed drop target stays put", () => {
  // A transparent button still takes a tap, so it must be visible on touch.
  assert.match(LAUNCHER_STYLE, /@media \(hover: none\) \{\s*body\.tiles\.tiles-small \.card:not\(\.expanded\) \.run \{ opacity: 1; \}/);
  // Only an open tile may be offset: a collapsed one has a fixed height and would move.
  assert.match(LAUNCHER_STYLE, /body\.tiles \.card\.drop-over \{[^}]*margin-top: 0;/);
  assert.match(LAUNCHER_STYLE, /body\.tiles \.card\.expanded\.drop-over \{ margin-top: -3px; \}/);
});

test("a view or size change keeps the open card and the focused control", () => {
  const page = openWith([item({ id: "a", label: "A", headAction: "run" })]);
  const run = card(page, "a").querySelector("button.run")!;
  page.click(card(page, "a"));
  run.focus();
  for (const type of ["toggleTileView", "cycleTileSize", "cycleTileSize", "cycleTileSize", "toggleTileView"]) {
    page.receive({ type });
    assert.equal(card(page, "a").classList.contains("expanded"), true, type);
    // Same node: the switch is classes only, so nothing is rebuilt under the focus.
    assert.equal(page.document.activeElement, run, type);
  }
});
