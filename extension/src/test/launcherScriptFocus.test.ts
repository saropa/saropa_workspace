// Tests for what the launcher carries across a repaint (open cards, focus), menu dismissal,
// unknown icon names, the older-engine tile fallbacks and drag start on the name block.

import { test } from "node:test";
import assert from "node:assert/strict";
import { item, openWith, open, card, dataMessage, head, menus, DND, CATEGORIES, MENU } from "./launcherWebviewFixture";
import { FakeDataTransfer } from "./_stub/fakeDom";
import { LAUNCHER_STYLE } from "../views/launcherAssets";

type Page = ReturnType<typeof openWith>;
const toggle = (page: Page, id: string) => card(page, id).querySelector(".card-body")!;
const three = ["a", "b", "c"].map((id) => item({ id, label: id.toUpperCase(), headAction: "run", menu: MENU }));

test("a repaint keeps open cards open and announced as expanded", () => {
  const page = openWith(three);
  page.click(card(page, "b"));
  page.receive(dataMessage(three));
  assert.equal(card(page, "b").classList.contains("expanded"), true);
  assert.equal(toggle(page, "b").getAttribute("aria-expanded"), "true");
  assert.equal(card(page, "a").classList.contains("expanded"), false);
  page.click(card(page, "b"));
  page.receive(dataMessage(three));
  assert.equal(card(page, "b").classList.contains("expanded"), false);
});

test("focus returns to the same Run or drawer button after a repaint", () => {
  const page = openWith(three);
  page.click(card(page, "b"));
  for (const selector of ["button.run", ".drawer-actions .btn"]) {
    const before = card(page, "b").querySelector(selector)!;
    before.focus();
    page.receive(dataMessage(three));
    const after = card(page, "b").querySelector(selector)!;
    assert.notEqual(after, before);
    assert.equal(page.document.activeElement, after, selector);
  }
});

test("a removed or filtered-out card hands focus to the nearest neighbor", () => {
  const page = openWith(three);
  card(page, "b").querySelector("button.run")!.focus();
  page.receive(dataMessage([three[0], three[2]]));
  // The next card, and its toggle rather than its Run button.
  assert.equal(page.document.activeElement, toggle(page, "c"));
  page.receive(dataMessage([three[0]]));
  assert.equal(page.document.activeElement, toggle(page, "a"), "falls back to the previous card");
  page.type(page.byId("q"), "b");
  page.receive(dataMessage(three));
  toggle(page, "b").focus();
  page.receive(dataMessage([three[0], { ...three[1], label: "Z" }, { ...three[2], label: "bee" }]));
  assert.equal(page.document.activeElement, toggle(page, "c"), "the search filtered b out");
});

test("focus stays on a group header and a category row across a repaint", () => {
  const page = openWith(DND, { categories: CATEGORIES });
  const extra = { categories: CATEGORIES };
  const groupHead = head(page, "g2");
  groupHead.focus();
  page.receive(dataMessage(DND, extra));
  assert.notEqual(head(page, "g2"), groupHead);
  assert.equal(page.document.activeElement, head(page, "g2"));
  const row = () => page.one('.cat-item[data-category="mine"]');
  const before = row();
  before.focus();
  page.receive(dataMessage(DND, extra));
  assert.notEqual(row(), before);
  assert.equal(page.document.activeElement, row());
});

function openCardMenu(page: Page): void {
  toggle(page, "a").focus();
  page.fire(toggle(page, "a"), "contextmenu", { clientX: 1, clientY: 1 });
}

test("scrolling and Tab close the menu and return focus; Tab is not cancelled", () => {
  const page = openWith(three);
  openCardMenu(page);
  // A page scroll arrives at the window, not at the card list.
  page.fire(page.window, "scroll");
  assert.equal(menus(page).length, 0);
  assert.equal(page.document.activeElement, toggle(page, "a"));
  openCardMenu(page);
  const tab = page.key(page.document.activeElement!, "Tab");
  assert.equal(tab.defaultPrevented, false);
  assert.equal(menus(page).length, 0);
  assert.equal(page.document.activeElement, toggle(page, "a"));
});

test("Tab inside a submenu closes both menus", () => {
  const page = openWith(three);
  openCardMenu(page);
  page.click(page.one(".menu-item.has-sub"));
  page.key(page.document.activeElement!, "Tab");
  assert.equal(menus(page).length, 0);
  assert.equal(page.document.activeElement, toggle(page, "a"));
});

test("Escape closes a hover-opened submenu first, then the menu", () => {
  const page = openWith(three);
  openCardMenu(page);
  page.fire(page.one(".menu-item.has-sub"), "mouseenter");
  assert.equal(page.all(".menu-sub").length, 1);
  page.key(page.document.activeElement!, "Escape");
  assert.equal(page.all(".menu-sub").length, 0);
  assert.equal(menus(page).length, 1);
  page.key(page.document.activeElement!, "Escape");
  assert.equal(menus(page).length, 0);
  assert.equal(page.document.activeElement, toggle(page, "a"));
});

test("an icon name with no glyph falls back to the default icon", () => {
  const page = open();
  // Stands in for the codicon stylesheet: only the invented name has no ::before content.
  page.window.getComputedStyle = (el: { className: string }) => ({
    content: el.className.includes("codicon-nope") ? "none" : '"x"',
    getPropertyValue: () => "",
  });
  page.receive(dataMessage([
    item({ id: "typo", label: "Typo", icon: "nope", defaultIcon: "snake" }),
    item({ id: "spaced", label: "Spaced", icon: "not a name" }),
    item({ id: "ok", label: "Ok", icon: "rocket" }),
  ]));
  const classes = (id: string) => card(page, id).querySelector(".card-ic")!.className;
  assert.equal(classes("typo"), "codicon codicon-snake card-ic");
  assert.equal(classes("spaced"), "codicon codicon-file card-ic");
  assert.equal(classes("ok"), "codicon codicon-rocket card-ic");
});

test("a drag that starts on the name block still drags its card", () => {
  const page = openWith(DND);
  const dataTransfer = new FakeDataTransfer();
  page.fire(toggle(page, "a"), "dragstart", { dataTransfer });
  assert.equal(dataTransfer.getData("text/plain"), "A");
  page.fire(card(page, "b"), "drop", { dataTransfer });
  assert.deepEqual(page.takePosted(), [{ type: "dropOnCard", groupId: "g1", targetId: "b", id: "a" }]);
  // Nothing on the block may opt out of dragging.
  assert.equal(toggle(page, "a").getAttribute("draggable"), null);
  assert.equal(card(page, "a").draggable, true);
});

test("tiles degrade without container queries or color-mix", () => {
  // The unconditional full-row rule must precede the container query that narrows it.
  const full = LAUNCHER_STYLE.indexOf("body.tiles .card.expanded { grid-column: 1 / -1; }");
  assert.ok(full >= 0 && full < LAUNCHER_STYLE.indexOf("@container (min-width: 266px)"));
  assert.match(LAUNCHER_STYLE, /@supports not \(color: color-mix[^{]*\{[\s\S]*body\.tiles \.card::before \{[^}]*var\(--tile-tint/);
});
