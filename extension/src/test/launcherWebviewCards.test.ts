// Behavior tests for the Launcher webview's cards, right-click menus and drag and drop.

import { test } from "node:test";
import assert from "node:assert/strict";
import { FakeDataTransfer, type FakeElement, type Page } from "./_stub/fakeDom";
import { dataMessage, item, openWith } from "./launcherWebviewFixture";

const MENU = [
  { command: "a.run", label: "Run", icon: "play", group: "run" },
  { command: "a.edit", label: "Edit", icon: "edit", group: "change" },
  {
    command: "a.more", label: "More", icon: "ellipsis", group: "change",
    children: [{ command: "a.c1", label: "Child 1", icon: "x" }, { command: "a.c2", label: "Child 2", icon: "x", danger: true }],
  },
  { command: "a.del", label: "Delete", icon: "trash", group: "danger", danger: true },
];

const card = (page: Page, id: string): FakeElement => page.one(`.card[data-shortcut-id="${id}"]`);
const buttons = (page: Page, id: string): string[] => card(page, id).querySelectorAll(".drawer-actions .btn").map((b) => b.textContent);
const button = (page: Page, id: string, text: string): FakeElement => {
  const found = card(page, id).querySelectorAll(".drawer-actions .btn").find((b) => b.textContent === text);
  assert.ok(found, `no "${text}" button on ${id}`);
  return found;
};
const menus = (page: Page): FakeElement[] => page.all(".menu");
const focusedLabel = (page: Page): string | undefined => page.document.activeElement?.textContent;

test("clicking a card expands and collapses its drawer", () => {
  const page = openWith([item({ id: "a", label: "A", desc: "Details" })]);
  page.click(card(page, "a"));
  assert.equal(card(page, "a").classList.contains("expanded"), true);
  page.click(card(page, "a"));
  assert.equal(card(page, "a").classList.contains("expanded"), false);
  assert.equal(page.one(".drawer-desc").textContent, "Details");
});

test("a run head button posts run and does not expand the card; an open head button routes by pane", () => {
  const page = openWith([
    item({ id: "a", label: "A", headAction: "run" }),
    item({ id: "/p/f.txt", label: "F", pane: "files", groupId: "proj", headAction: "open" }),
  ]);
  const runBtn = card(page, "a").querySelector("button.run")!;
  assert.equal(runBtn.title, "Run");
  page.click(runBtn);
  assert.equal(card(page, "a").classList.contains("expanded"), false);
  const openBtn = card(page, "/p/f.txt").querySelector("button.run")!;
  assert.equal(openBtn.getAttribute("aria-label"), "Open");
  page.click(openBtn);
  assert.deepEqual(page.takePosted(), [{ type: "run", id: "a" }, { type: "openFile", path: "/p/f.txt" }]);
});

test("a card without a head action has no head button", () => {
  const page = openWith([item({ id: "a", label: "A" })]);
  assert.equal(page.all("button.run").length, 0);
});

test("the Open drawer button routes each pane to its own message", () => {
  const page = openWith([
    item({ id: "m1", label: "Mine" }),
    item({ id: "r1", label: "Recipe", pane: "recipes", groupId: "r" }),
    item({ id: "w1", label: "Watch", pane: "watches", groupId: "w" }),
    item({ id: "/p/a.md", label: "File", pane: "files", groupId: "f" }),
    item({ id: "/p/n.md", label: "Note", pane: "notes", groupId: "n" }),
    item({ id: "s1", label: "Script", pane: "scripts", groupId: "s" }),
  ]);
  for (const id of ["m1", "r1", "w1", "/p/a.md", "/p/n.md", "s1"]) {
    page.click(button(page, id, "Open"));
  }
  assert.deepEqual(page.takePosted(), [
    { type: "open", id: "m1" },
    { type: "open", id: "r1" },
    { type: "openWatch", id: "w1" },
    { type: "openFile", path: "/p/a.md" },
    { type: "openNote", path: "/p/n.md" },
    { type: "open", id: "s1" },
  ]);
});

test("drawer buttons depend on what the item can do", () => {
  const page = openWith([
    item({ id: "plain", label: "Plain", openable: false }),
    item({ id: "file", label: "File", copyable: true }),
    item({ id: "head", label: "Head", headAction: "open", copyable: true }),
    item({ id: "rec", label: "Rec", pane: "recipes", groupId: "r", openable: false }),
    item({ id: "mob", label: "Mob", pane: "mobileRemote", groupId: "m", openable: false }),
  ]);
  assert.deepEqual(buttons(page, "plain"), []);
  assert.deepEqual(buttons(page, "file"), ["Open", "Copy path"]);
  assert.deepEqual(buttons(page, "head"), ["Copy path"]);
  assert.deepEqual(buttons(page, "rec"), ["Pin", "Schedule"]);
  assert.deepEqual(buttons(page, "mob"), ["Pin"]);
});

test("copy, pin and schedule buttons post their exact messages without toggling the card", () => {
  const page = openWith([
    item({ id: "file", label: "File", copyable: true }),
    item({ id: "rec", label: "Rec", pane: "recipes", groupId: "r", openable: false }),
    item({ id: "mob", label: "Mob", pane: "mobileRemote", groupId: "m", openable: false }),
  ]);
  page.click(button(page, "file", "Copy path"));
  page.click(button(page, "rec", "Pin"));
  page.click(button(page, "rec", "Schedule"));
  page.click(button(page, "mob", "Pin"));
  assert.deepEqual(page.takePosted(), [
    { type: "copyPath", id: "file" },
    { type: "command", command: "saropaWorkspace.promoteRecipe", id: "rec" },
    { type: "command", command: "saropaWorkspace.scheduleRecipe", id: "rec" },
    { type: "pin", id: "mob" },
  ]);
  assert.equal(page.all(".card.expanded").length, 0);
});

test("the kind label names the card icon for assistive tech", () => {
  const page = openWith([item({ id: "a", label: "A", kindLabel: "Shell command" })]);
  const icon = page.one(".card-ic");
  assert.deepEqual([icon.title, icon.getAttribute("aria-label")], ["Shell command", "Shell command"]);
});

function openMenu(page: Page, x = 40, y = 50): void {
  page.fire(card(page, "c"), "contextmenu", { clientX: x, clientY: y });
}
const withMenu = (): Page => openWith([item({ id: "c", label: "Deploy", menu: MENU }), item({ id: "d", label: "Plain" })]);

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

// ---- drag and drop ---------------------------------------------------------

const DND = [
  item({ id: "a", label: "A", groupId: "g1" }),
  item({ id: "b", label: "B", groupId: "g1" }),
  item({ id: "c", label: "C", groupId: "g2", section: "Weekly" }),
  item({ id: "w", label: "W", pane: "watches", groupId: "watches" }),
];
const head = (page: Page, group: string): FakeElement => page.one(`.group[data-group-id="${group}"] .group-head`);
const wrap = (page: Page, group: string): FakeElement => page.one(`.group[data-group-id="${group}"]`);
const drag = (page: Page, id: string): FakeDataTransfer => {
  const dataTransfer = new FakeDataTransfer();
  page.fire(card(page, id), "dragstart", { dataTransfer });
  return dataTransfer;
};

test("dragging a shortcut card highlights the other groups of its pane as drop targets", () => {
  const page = openWith(DND);
  const dt = drag(page, "a");
  assert.deepEqual([dt.effectAllowed, dt.getData("text/plain")], ["copyMove", "A"]);
  assert.deepEqual(page.all(".group.can-drop").map((g) => g.dataset.groupId), ["g2"]);
  page.fire(card(page, "a"), "dragend");
  assert.equal(page.all(".group.can-drop").length, 0);
});

test("dropping a card on another group's head moves it there and clears the highlights", () => {
  const page = openWith(DND);
  drag(page, "a");
  const dataTransfer = new FakeDataTransfer();
  const over = page.fire(head(page, "g2"), "dragover", { dataTransfer });
  assert.equal(over.defaultPrevented, true);
  assert.equal(dataTransfer.dropEffect, "move");
  assert.equal(wrap(page, "g2").classList.contains("drop-over"), true);
  page.fire(head(page, "g2"), "drop", { dataTransfer });
  assert.deepEqual(page.takePosted(), [{ type: "dropOnGroup", groupId: "g2", id: "a" }]);
  assert.equal(wrap(page, "g2").classList.contains("drop-over"), false);
  assert.equal(page.all(".group.can-drop").length, 0);
});

test("a card's own group does not accept it, and leaving a head clears the hover mark", () => {
  const page = openWith(DND);
  drag(page, "a");
  const own = page.fire(head(page, "g1"), "dragover", { dataTransfer: new FakeDataTransfer() });
  assert.equal(own.defaultPrevented, false);
  page.fire(head(page, "g2"), "dragover", { dataTransfer: new FakeDataTransfer() });
  page.fire(head(page, "g2"), "dragleave", { relatedTarget: head(page, "g2").children[0] });
  assert.equal(wrap(page, "g2").classList.contains("drop-over"), true);
  page.fire(head(page, "g2"), "dragleave", { relatedTarget: page.document.body });
  assert.equal(wrap(page, "g2").classList.contains("drop-over"), false);
  page.fire(head(page, "g1"), "drop", { dataTransfer: new FakeDataTransfer() });
  assert.deepEqual(page.takePosted(), []);
});

test("dropping a card on another card asks the host to reorder before it", () => {
  const page = openWith(DND);
  drag(page, "a");
  const onSelf = page.fire(card(page, "a"), "dragover", { dataTransfer: new FakeDataTransfer() });
  assert.equal(onSelf.defaultPrevented, false);
  const dataTransfer = new FakeDataTransfer();
  const onOther = page.fire(card(page, "b"), "dragover", { dataTransfer });
  assert.equal(onOther.defaultPrevented, true);
  assert.equal(card(page, "b").classList.contains("drop-over"), true);
  page.fire(card(page, "b"), "drop", { dataTransfer });
  assert.deepEqual(page.takePosted(), [{ type: "dropOnCard", groupId: "g1", targetId: "b", id: "a" }]);
  assert.equal(card(page, "b").classList.contains("drop-over"), false);
});

test("ending a drag clears every hover mark", () => {
  const page = openWith(DND);
  drag(page, "a");
  page.fire(card(page, "b"), "dragover", { dataTransfer: new FakeDataTransfer() });
  page.fire(head(page, "g2"), "dragover", { dataTransfer: new FakeDataTransfer() });
  page.fire(card(page, "a"), "dragend");
  assert.equal(page.all(".drop-over").length, 0);
  assert.equal(page.all(".can-drop").length, 0);
});

test("cards from other panes cannot be dropped on groups or cards", () => {
  const page = openWith(DND);
  drag(page, "w");
  assert.equal(page.all(".group.can-drop").length, 0);
  const over = page.fire(card(page, "a"), "dragover", { dataTransfer: new FakeDataTransfer() });
  assert.equal(over.defaultPrevented, false);
  page.fire(card(page, "a"), "drop", { dataTransfer: new FakeDataTransfer() });
  page.fire(head(page, "g2"), "drop", { dataTransfer: new FakeDataTransfer() });
  assert.deepEqual(page.takePosted(), []);
});

test("a drop with no drag in progress posts nothing", () => {
  const page = openWith(DND);
  const ev = page.fire(card(page, "b"), "drop", { dataTransfer: new FakeDataTransfer() });
  assert.equal(ev.defaultPrevented, true);
  assert.deepEqual(page.takePosted(), []);
});
