// Tests for the Launcher webview's cards: drawer buttons, tints and drag and drop.

import { test } from "node:test";
import assert from "node:assert/strict";
import { FakeDataTransfer } from "./_stub/fakeDom";
import { item, openWith, card, buttons, button, DND, head, wrap, drag } from "./launcherWebviewFixture";

test("a card shows its label and a sub line only when it differs from the label", () => {
  const page = openWith([item({ id: "x", label: "Same", sub: "Same" }), item({ id: "y", label: "Other", sub: "detail" })]);
  assert.deepEqual(page.all(".card").map((c) => c.querySelectorAll(".card-sub").map((s) => s.textContent)), [[], ["detail"]]);
});

test("card tints use the theme variable with the host's hex fallback", () => {
  const page = openWith(
    [item({ id: "a", label: "A", color: "charts.blue" }), item({ id: "b", label: "B", color: "charts.red" }), item({ id: "c", label: "C", color: "" })],
    { tintHexes: { "charts.blue": "#3794ff" } },
  );
  assert.deepEqual(page.all(".card").map((c) => c.style.getPropertyValue("--card-tint")), ["var(--vscode-charts-blue, #3794ff)", "var(--vscode-charts-red)", "var(--vscode-foreground)"]);
  assert.equal((page.one(".group-glyph").style as unknown as Record<string, string>).color, "var(--vscode-charts-blue)");
});

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
