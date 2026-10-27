// Tests for the Launcher webview's right-click menus, submenus and sort message.

import { test } from "node:test";
import assert from "node:assert/strict";
import { dataMessage, item, openWith, ITEMS, CATEGORIES, lastState, MENU, card, menus, focusedLabel, openMenu, withMenu } from "./launcherWebviewFixture";

test("the cycleSort message sorts every pane, or only the selected category", () => {
  const page = openWith(ITEMS, { categories: CATEGORIES });
  page.receive({ type: "cycleSort" });
  assert.deepEqual(lastState(page).sort, { mine: "asc", recipes: "asc", watches: "asc", files: "asc", scripts: "asc", notes: "asc", mobileRemote: "asc" });
  page.receive({ type: "cycleSort" });
  page.receive({ type: "cycleSort" });
  assert.deepEqual(lastState(page).sort, {});
  page.click(page.one('.cat-item[data-category="mine"]'));
  page.receive({ type: "cycleSort" });
  assert.deepEqual(lastState(page).sort, { mine: "asc" });
});

test("right-clicking a card with a menu opens it at the pointer, labeled, grouped and focused on the first row", () => {
  const page = withMenu();
  const ev = page.fire(card(page, "c"), "contextmenu", { clientX: 40, clientY: 50 });
  assert.equal(ev.defaultPrevented, true);
  const [menu] = menus(page);
  assert.equal(menu.getAttribute("role"), "menu");
  assert.equal(menu.getAttribute("aria-label"), "Actions for Deploy");
  assert.deepEqual(menu.children.map((c) => c.className), ["menu-item", "menu-sep", "menu-item", "menu-item has-sub", "menu-sep", "menu-item danger"]);
  const style = menu.style as unknown as Record<string, string>;
  assert.deepEqual([style.left, style.top], ["40px", "50px"]);
  assert.equal(focusedLabel(page), "Run");
});

test("a menu opened near the edge is pulled back inside the window", () => {
  const page = withMenu();
  page.window.innerWidth = 300;
  page.window.innerHeight = 200;
  openMenu(page, 5000, 5000);
  const style = menus(page)[0].style as unknown as Record<string, string>;
  assert.deepEqual([style.left, style.top], ["298px", "198px"]);
});

test("cards without menu entries do not open one", () => {
  const page = withMenu();
  const ev = page.fire(card(page, "d"), "contextmenu");
  assert.equal(ev.defaultPrevented, false);
  assert.equal(menus(page).length, 0);
});

test("clicking a menu row posts its command with the card id and closes the menu", () => {
  const page = withMenu();
  openMenu(page);
  page.click(menus(page)[0].children.find((c) => c.textContent === "Delete")!);
  assert.deepEqual(page.takePosted(), [{ type: "command", command: "a.del", id: "c" }]);
  assert.equal(menus(page).length, 0);
});

test("the arrow keys move through the rows and wrap at both ends", () => {
  const page = withMenu();
  openMenu(page);
  const step = (key: string): string | undefined => {
    page.key(page.document.activeElement!, key);
    return focusedLabel(page);
  };
  assert.deepEqual(["ArrowDown", "ArrowDown", "ArrowDown", "ArrowDown"].map(step), ["Edit", "More", "Delete", "Run"]);
  assert.deepEqual(["ArrowUp", "ArrowUp"].map(step), ["Delete", "More"]);
});

test("Escape, an outside click and a window blur each close the menu; a click inside does not", () => {
  const page = withMenu();
  openMenu(page);
  page.key(page.document, "Escape");
  assert.equal(menus(page).length, 0);
  openMenu(page);
  page.click(menus(page)[0].querySelector(".menu-sep")!);
  assert.equal(menus(page).length, 1);
  page.click(page.document.body);
  assert.equal(menus(page).length, 0);
  openMenu(page);
  page.fire(page.window, "blur");
  assert.equal(menus(page).length, 0);
});

test("opening a menu on another card replaces the first one", () => {
  const page = openWith([item({ id: "c", label: "Deploy", menu: MENU }), item({ id: "d", label: "Other", menu: MENU })]);
  page.fire(card(page, "c"), "contextmenu");
  page.fire(card(page, "d"), "contextmenu");
  assert.deepEqual(menus(page).map((m) => m.getAttribute("aria-label")), ["Actions for Other"]);
});

test("re-rendering the cards closes an open menu", () => {
  const page = withMenu();
  openMenu(page);
  page.receive(dataMessage([item({ id: "c", label: "Deploy", menu: MENU })]));
  assert.equal(menus(page).length, 0);
});

test("a row with children opens a submenu on click, focused on its first child, and a child posts its command", () => {
  const page = withMenu();
  openMenu(page);
  const more = menus(page)[0].children.find((c) => c.textContent === "More")!;
  page.click(more);
  assert.equal(more.getAttribute("aria-expanded"), "true");
  const sub = page.one(".menu.menu-sub");
  assert.equal(sub.getAttribute("aria-label"), "More actions for More");
  assert.deepEqual(sub.children.map((c) => `${c.className}:${c.textContent}`), ["menu-item:Child 1", "menu-item danger:Child 2"]);
  assert.equal(focusedLabel(page), "Child 1");
  page.click(sub.children[1]);
  assert.deepEqual(page.takePosted(), [{ type: "command", command: "a.c2", id: "c" }]);
  assert.equal(menus(page).length, 0);
});

test("ArrowRight on a row with children opens its submenu", () => {
  const page = withMenu();
  openMenu(page);
  page.key(page.document.activeElement!, "ArrowDown");
  page.key(page.document.activeElement!, "ArrowDown");
  page.key(page.document.activeElement!, "ArrowRight");
  assert.equal(page.all(".menu-sub").length, 1);
  assert.equal(focusedLabel(page), "Child 1");
});

test("Escape inside a submenu closes only the submenu and returns focus to its row", () => {
  const page = withMenu();
  openMenu(page);
  const more = menus(page)[0].children.find((c) => c.textContent === "More")!;
  page.click(more);
  page.key(page.document.activeElement!, "Escape");
  assert.equal(page.all(".menu-sub").length, 0);
  assert.equal(more.getAttribute("aria-expanded"), "false");
  assert.equal(page.document.activeElement, more);
  assert.equal(menus(page).length, 1);
  page.key(page.document, "Escape");
  assert.equal(menus(page).length, 0);
});

test("hovering opens a submenu, leaving closes it after a short delay, and entering it keeps it open", () => {
  const page = withMenu();
  openMenu(page);
  const more = menus(page)[0].children.find((c) => c.textContent === "More")!;
  page.fire(more, "mouseenter");
  assert.equal(page.all(".menu-sub").length, 1);
  assert.equal(page.document.activeElement, more.parentNode!.children[0], "hover does not steal focus");
  page.fire(more, "mouseleave");
  page.timers.advance(199);
  assert.equal(page.all(".menu-sub").length, 1);
  page.fire(page.one(".menu-sub"), "mouseenter");
  page.timers.runAll();
  assert.equal(page.all(".menu-sub").length, 1);
  page.fire(page.one(".menu-sub"), "mouseleave");
  page.timers.advance(200);
  assert.equal(page.all(".menu-sub").length, 0);
});

test("hovering a plain row closes an open submenu", () => {
  const page = withMenu();
  openMenu(page);
  const rows = menus(page)[0].children;
  page.fire(rows.find((c) => c.textContent === "More")!, "mouseenter");
  page.fire(rows.find((c) => c.textContent === "Edit")!, "mouseenter");
  assert.equal(page.all(".menu-sub").length, 0);
});

test("a submenu sits beside its row, and flips or clamps when there is no room", () => {
  const page = withMenu();
  openMenu(page);
  const more = menus(page)[0].children.find((c) => c.textContent === "More")!;
  more.rect = { left: 10, top: 20, right: 110, bottom: 40, width: 100, height: 20 };
  page.fire(more, "mouseenter");
  let style = page.one(".menu-sub").style as unknown as Record<string, string>;
  assert.deepEqual([style.left, style.top], ["112px", "20px"]);
  page.window.innerWidth = 100;
  page.window.innerHeight = 10;
  page.fire(more, "mouseenter");
  style = page.one(".menu-sub").style as unknown as Record<string, string>;
  assert.deepEqual([style.left, style.top], ["8px", "8px"]);
});
