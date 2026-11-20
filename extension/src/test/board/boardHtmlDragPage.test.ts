// Drag and drop on the board page, run for real: DRAG_SCRIPT executes in the fake DOM against markup built by
// the module's own renderers (status bands, gaps, arrows), and the tests read the messages the page posts.
// The existing boardDrop and boardOrder tests cover what the host does with a drop; this file covers what the
// page itself sends, so a regression in the page script (a wrong zone, a text value sent instead of an id,
// a refused drop that still posts) is caught without a browser.

import { test } from "node:test";
import assert from "node:assert/strict";
import { DRAG_SCRIPT, dragAttrs, gapZone, groupZone, moveArrows, statusBands } from "../../board/boardHtmlDrag";
import { pl } from "../../board/boardHtmlUtil";
import { FakeDataTransfer, type FakeElement, type Page } from "../_stub/fakeDom";
import { EVIL, REV, keyWith, openBoardPage, t } from "./boardWebviewFixture";

// Three rows in one ordered group, a gap before each and after the last, as the board paints a group that
// keeps its order. The wrapper carries no data-drop: a drop on a row must fall through to the nearest gap.
const GROUP = "g1";
const rowsHtml = (): string => {
  const ids = [10, 11, 12];
  const body = ids.map((id, n) => `${gapZone(t, GROUP, "Launch", n)}<div class="row"${dragAttrs(id)}><a href="#">Doc ${id}</a>${moveArrows(t, `Doc ${id}`, n > 0, n < ids.length - 1, GROUP)}</div>`).join("");
  return `<div class="group">${body}${gapZone(t, GROUP, "Launch", ids.length)}</div>`;
};

const BANDS = [{ label: "Blocked", status: "red" }, { label: "Done", status: "green" }];

// The page: live region, bands, the ordered group, a waits slot per row, a group zone and a drop-nowhere area.
function open(extra = "", liveAttrs = ""): Page {
  const waits = [11, 12].map((id) => `<span class="slot" id="w${id}" data-drop="waits" data-to="${id}"></span>`).join("");
  const page = openBoardPage(`<div id="live" role="status" aria-live="polite"${liveAttrs}></div>${statusBands(t, BANDS)}${rowsHtml()}${waits}<div id="zone" ${groupZone(t, "g2", "Other")}></div><div id="outside"></div>${extra}`);
  page.run(DRAG_SCRIPT, "board-drag.js");
  return page;
}

const rowOf = (page: Page, id: number): FakeElement => page.one(`.row[data-drag="${id}"]`);
const band = (page: Page, status: string): FakeElement => page.one(`.sband[data-to="${status}"]`);
const live = (page: Page): string => page.byId("live").textContent;

/** Starts a drag on a row the way the browser does and returns the data object the page filled. */
function startDrag(page: Page, id: number): FakeDataTransfer {
  const dataTransfer = new FakeDataTransfer();
  page.fire(rowOf(page, id), "dragstart", { dataTransfer });
  return dataTransfer;
}

const control = (page: Page, id: number, selector: string): FakeElement => rowOf(page, id).querySelector(selector) as FakeElement;

test("dropping a row on a status band posts one drop message that carries ids and the revision only", () => {
  const page = open();
  startDrag(page, 11);
  const ev = page.fire(band(page, "red"), "drop", {});
  assert.deepEqual(page.takePosted(), [{ type: "drop", zone: "band", id: 11, to: "red", at: null, rev: REV }]);
  assert.equal(ev.defaultPrevented, true, "the drop is claimed so the browser does not navigate");
});

test("a drag puts the row id in the data object, marks the page and the row, and announces the start", () => {
  const page = open();
  const data = startDrag(page, 11);
  assert.equal(data.getData("text/plain"), "11");
  assert.equal(data.effectAllowed, "move");
  assert.equal(page.document.body.classList.contains("dragging"), true);
  assert.equal(live(page), pl(t, "dropStart"));
  assert.equal(rowOf(page, 11).classList.contains("dragging"), false, "the row is dimmed a tick later, after the browser takes its drag image");
  page.timers.advance(0);
  assert.equal(rowOf(page, 11).classList.contains("dragging"), true);
});

test("ending a drag clears the page mark, the row mark, the highlighted zone and the announcement", () => {
  const page = open();
  startDrag(page, 11);
  page.timers.advance(0);
  page.fire(band(page, "green"), "dragover", { dataTransfer: new FakeDataTransfer() });
  assert.equal(band(page, "green").classList.contains("over"), true);
  page.fire(rowOf(page, 11), "dragend", {});
  assert.equal(page.document.body.classList.contains("dragging"), false);
  assert.equal(rowOf(page, 11).classList.contains("dragging"), false);
  assert.equal(page.all(".over").length, 0);
  assert.equal(live(page), "");
});

test("a drop with no valid target, or with no drag in progress, posts nothing", () => {
  const page = open();
  startDrag(page, 11);
  const nowhere = page.fire(page.byId("outside"), "drop", {});
  assert.deepEqual(page.takePosted(), [], "a drop outside every zone");
  assert.equal(nowhere.defaultPrevented, false, "and the browser keeps its default");
  page.fire(rowOf(page, 11), "dragend", {});
  page.fire(band(page, "red"), "drop", {});
  assert.deepEqual(page.takePosted(), [], "a drop after the drag ended");
});

test("a drag that starts off any row, or without a data object, does not start", () => {
  const page = open();
  page.fire(page.byId("outside"), "dragstart", { dataTransfer: new FakeDataTransfer() });
  page.fire(rowOf(page, 11), "dragstart", {});
  assert.equal(page.document.body.classList.contains("dragging"), false);
  page.fire(band(page, "red"), "drop", {});
  assert.deepEqual(page.takePosted(), []);
});

test("dragging over a zone highlights only that zone and announces its words; moving on clears the old one", () => {
  const page = open();
  startDrag(page, 11);
  const over = page.fire(band(page, "red"), "dragover", { dataTransfer: new FakeDataTransfer() });
  assert.equal(over.defaultPrevented, true, "a valid zone accepts the drop");
  assert.equal(live(page), band(page, "red").dataset.say);
  page.fire(band(page, "green"), "dragover", { dataTransfer: new FakeDataTransfer() });
  assert.deepEqual(page.all(".over").map((z) => z.dataset.to), ["green"]);
  assert.equal(live(page), band(page, "green").dataset.say);
});

test("dragging over a zone with no drag in progress does nothing", () => {
  const page = open();
  const ev = page.fire(band(page, "red"), "dragover", { dataTransfer: new FakeDataTransfer() });
  assert.equal(ev.defaultPrevented, false);
  assert.equal(page.all(".over").length, 0);
});

test("a row cannot be dropped on its own waits slot, but can be dropped on another row's, which posts a numeric id", () => {
  const page = open();
  startDrag(page, 11);
  const own = page.fire(page.byId("w11"), "dragover", { dataTransfer: new FakeDataTransfer() });
  assert.equal(own.defaultPrevented, false, "no hover state on its own slot");
  page.fire(page.byId("w11"), "drop", {});
  assert.deepEqual(page.takePosted().length, 1, "the drop handler still reports it; the host refuses it as itself");
  startDrag(page, 11);
  page.fire(page.byId("w12"), "dragover", { dataTransfer: new FakeDataTransfer() });
  assert.equal(page.byId("w12").classList.contains("over"), true);
  page.fire(page.byId("w12"), "drop", {});
  assert.deepEqual(page.takePosted(), [{ type: "drop", zone: "waits", id: 11, to: 12, at: null, rev: REV }]);
});

test("a drop on a group zone posts the group id as text", () => {
  const page = open();
  startDrag(page, 10);
  page.fire(page.byId("zone"), "drop", {});
  assert.deepEqual(page.takePosted(), [{ type: "drop", zone: "group", id: 10, to: "g2", at: null, rev: REV }]);
});

test("a drop on a row lands in the gap above it in the upper half and the gap below it in the lower half", () => {
  const page = open();
  const target = rowOf(page, 11);
  target.rect = { left: 0, top: 100, right: 300, bottom: 120, width: 300, height: 20 };
  startDrag(page, 12);
  page.fire(target, "drop", { clientY: 105 });
  page.fire(target, "drop", { clientY: 115 });
  assert.deepEqual(page.takePosted(), [
    { type: "drop", zone: "gap", id: 12, to: GROUP, at: 1, rev: REV },
    { type: "drop", zone: "gap", id: 12, to: GROUP, at: 2, rev: REV },
  ]);
});

test("Alt+Up and Alt+Down on a row post a keyboard move with the pressed control, and claim the key", () => {
  const page = open();
  const up = control(page, 11, "[data-mv=\"-1\"]");
  const ev = keyWith(page, up, "ArrowUp", { alt: true });
  keyWith(page, control(page, 11, "a"), "ArrowDown", { alt: true });
  assert.equal(ev.defaultPrevented, true);
  assert.deepEqual(page.takePosted(), [
    { type: "drop", zone: "move", id: 11, to: -1, ctl: 2, rev: REV },
    { type: "drop", zone: "move", id: 11, to: 1, ctl: 0, rev: REV },
  ]);
});

test("the arrow keys post nothing without Alt, or with another modifier held, or for another key", () => {
  const page = open();
  const link = control(page, 11, "a");
  keyWith(page, link, "ArrowUp");
  keyWith(page, link, "ArrowUp", { alt: true, shift: true });
  keyWith(page, link, "ArrowUp", { alt: true, ctrl: true });
  keyWith(page, link, "ArrowUp", { alt: true, meta: true });
  keyWith(page, link, "Enter", { alt: true });
  assert.deepEqual(page.takePosted(), []);
});

test("Alt+Up on a row of a group that keeps no order posts nothing and leaves the key alone", () => {
  // No gap sits above this row: its group is not ordered, so only the menu can move it.
  const page = open(`<div id="plain"><div class="row"${dragAttrs(40)}><a href="#">Plain</a></div></div>`);
  const ev = keyWith(page, rowOf(page, 40).querySelector("a") as FakeElement, "ArrowUp", { alt: true });
  assert.deepEqual(page.takePosted(), []);
  assert.equal(ev.defaultPrevented, false);
});

test("Alt+Up is ignored while a menu is open or the row's own menu button is expanded", () => {
  const open1 = open("<div class=\"menu\" id=\"menu-row\"></div>");
  keyWith(open1, control(open1, 11, "a"), "ArrowUp", { alt: true });
  assert.deepEqual(open1.takePosted(), [], "an open menu owns the arrow keys");
  const hiddenMenu = open("<div class=\"menu\" id=\"menu-row\" hidden></div>");
  keyWith(hiddenMenu, control(hiddenMenu, 11, "a"), "ArrowUp", { alt: true });
  assert.equal(hiddenMenu.takePosted().length, 1, "a closed menu does not");
  const expanded = open();
  // The row's menu button, expanded: built by hand because the row renderer here draws no menu button.
  const kb = expanded.document.createElement("button");
  kb.className = "kb";
  kb.setAttribute("aria-expanded", "true");
  rowOf(expanded, 11).appendChild(kb);
  keyWith(expanded, control(expanded, 11, "a"), "ArrowUp", { alt: true });
  assert.deepEqual(expanded.takePosted(), [], "an expanded row menu button owns the arrow keys");
});

test("Alt+Right chains a row with the one above it; the first row cannot be chained", () => {
  const page = open();
  keyWith(page, control(page, 11, "a"), "ArrowRight", { alt: true });
  keyWith(page, control(page, 11, "a"), "ArrowLeft", { alt: true });
  keyWith(page, control(page, 10, "a"), "ArrowRight", { alt: true });
  assert.deepEqual(page.takePosted(), [
    { type: "drop", zone: "chain", id: 11, to: 1, ctl: 0, rev: REV },
    { type: "drop", zone: "chain", id: 11, to: -1, ctl: 0, rev: REV },
  ]);
});

test("the arrow buttons post the same move as the keys; a button disabled at an end posts nothing", () => {
  const page = open();
  page.click(control(page, 11, "[data-mv=\"1\"]"));
  page.click(control(page, 12, "[data-mv=\"-1\"]"));
  page.click(control(page, 12, "[data-mv=\"1\"]"));
  page.click(control(page, 10, "[data-mv=\"-1\"]"));
  assert.deepEqual(page.takePosted(), [
    { type: "drop", zone: "move", id: 11, to: 1, ctl: 3, rev: REV },
    { type: "drop", zone: "move", id: 12, to: -1, ctl: 2, rev: REV },
  ]);
});

test("the chain buttons post a chain request; the first row's are disabled", () => {
  const page = open();
  page.click(control(page, 11, "[data-ch=\"1\"]"));
  page.click(control(page, 11, "[data-ch=\"-1\"]"));
  page.click(control(page, 10, "[data-ch=\"1\"]"));
  assert.deepEqual(page.takePosted(), [
    { type: "drop", zone: "chain", id: 11, to: 1, ctl: 4, rev: REV },
    { type: "drop", zone: "chain", id: 11, to: -1, ctl: 1, rev: REV },
  ]);
});

// A last loaded row followed by a "Show more" button: the move down must wait for the rest of the group.
const MORE = `<div class="gap" data-drop="gap" data-to="g9" data-at="0"></div><div class="row"${dragAttrs(50)}><button type="button" data-mv="1" data-mvg="g9">v</button></div><button type="button" data-rowsmore data-lid="other"></button>`;
const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

test("moving a last loaded row down asks for the rest of its group first, then posts the move once", async () => {
  const page = openBoardPage(`<div id="live"></div>${MORE}`);
  page.run(DRAG_SCRIPT, "board-drag.js");
  page.click(page.one("[data-mv=\"1\"]"));
  assert.deepEqual(page.posted, [], "nothing is posted before the rows are in");
  await flush();
  assert.deepEqual(page.takePosted(), [{ type: "drop", zone: "move", id: 50, to: 1, ctl: 0, rev: REV }]);
  keyWith(page, page.one("[data-mv=\"1\"]"), "ArrowDown", { alt: true });
  await flush();
  assert.equal(page.takePosted().length, 1, "the keyboard path waits the same way");
});

test("a say message sets the live region text; anything else is ignored", () => {
  const page = open();
  page.receive({ type: "say", text: "Moved Doc 11 down" });
  assert.equal(live(page), "Moved Doc 11 down");
  page.receive({ type: "say", text: 5 });
  page.receive({ type: "other", text: "no" });
  assert.equal(live(page), "Moved Doc 11 down");
});

test("after a saved move the page focuses the control that was used and announces the move", () => {
  const page = open("", ' data-focus="11" data-ctl="2" data-say="Moved Doc 11 up"');
  assert.equal(page.document.activeElement, control(page, 11, "[data-mv=\"-1\"]"));
  assert.equal(live(page), "Moved Doc 11 up");
});

test("when the used control is disabled after the move, focus goes to the neighbor that still works", () => {
  // Row 10 is first, so its up button is disabled; the next enabled control is the down button.
  const page = open("", ' data-focus="10" data-ctl="2" data-say="Moved"');
  assert.equal(page.document.activeElement, control(page, 10, "[data-mv=\"1\"]"));
});

test("status bands escape their labels, carry words for the announcer and a labeled group role", () => {
  const html = statusBands(t, [{ label: EVIL, status: "red" }, { label: "Duplicate", status: "red" }]);
  const page = openBoardPage(html);
  assert.equal(page.all("img").length, 0, "no element came out of the label");
  assert.equal(page.all(".sband").length, 1, "one band per status");
  assert.equal(page.one(".sband").textContent.includes(EVIL), true);
  assert.equal(page.one(".sband").dataset.say, pl(t, "dropBand", { status: EVIL }));
  const group = page.one("#sbands");
  assert.equal(group.getAttribute("role"), "group");
  assert.ok((group.getAttribute("aria-label") ?? "").length > 0);
  assert.equal(statusBands(t, []), "");
});

test("a band prefers the plain category of a status over one with a kind", () => {
  const page = openBoardPage(statusBands(t, [{ label: "Bug", status: "red", kind: "bug" }, { label: "Red", status: "red" }]));
  assert.equal(page.one(".sband").textContent.endsWith("Red"), true);
});

test("gap zones are hidden from assistive technology and escape the group name", () => {
  const page = openBoardPage(gapZone(t, "g<1>", EVIL, 3));
  const gap = page.one(".gap");
  assert.equal(gap.getAttribute("aria-hidden"), "true");
  assert.equal(gap.dataset.to, "g<1>");
  assert.equal(gap.dataset.at, "3");
  assert.equal(gap.dataset.say, pl(t, "dropGap", { name: EVIL }));
  assert.equal(page.all("img").length, 0);
});

test("group zones for no group use the ungroup words, and a name with markup stays text", () => {
  const none = openBoardPage(`<div id="z"${groupZone(t, "", "x")}></div>`).one("#z");
  assert.equal(none.dataset.to, "");
  assert.equal(none.dataset.say, pl(t, "dropUngroup", { name: "x" }));
  const evil = openBoardPage(`<div id="z"${groupZone(t, "g", EVIL)}></div>`);
  assert.equal(evil.one("#z").dataset.say, pl(t, "dropGroup", { name: EVIL }));
  assert.equal(evil.all("img").length, 0);
});

test("the arrow buttons are real buttons with a name, and the end buttons are disabled", () => {
  const page = openBoardPage(moveArrows(t, EVIL, false, true, "g<1>"));
  const buttons = page.all("button");
  assert.equal(buttons.length, 4);
  for (const b of buttons) {
    assert.equal(b.getAttribute("type"), "button");
    assert.ok((b.getAttribute("aria-label") ?? "").length > 0, "every arrow has an accessible name");
    assert.equal(b.getAttribute("aria-label"), b.getAttribute("title"));
  }
  assert.equal(page.one("[data-mv=\"-1\"]").hasAttribute("disabled"), true, "up is off on the first row");
  assert.equal(page.one("[data-mv=\"1\"]").hasAttribute("disabled"), false);
  assert.equal(page.one("[data-mv=\"1\"]").dataset.mvg, "g<1>");
  assert.equal(page.all("img").length, 0);
});
