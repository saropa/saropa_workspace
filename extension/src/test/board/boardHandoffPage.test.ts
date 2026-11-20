// The hand-off drawer of the board page, run for real: HANDOFF_SCRIPT executes in the fake DOM against the
// drawer, checkbox, pill and chosen-line markup the module renders. The existing boardHandoff and boardBringBack
// tests assert on the markup text and the host side; these tests drive the page: opening the drawer, choosing
// documents, switching task and format, the keyboard on the tabs, reading an answer back and reviewing it, and
// that every value shown arrives as text and every message carries the revision and ids only.

import { test } from "node:test";
import assert from "node:assert/strict";
import { HANDOFF_SCRIPT, chooseBox, chosenLine, handoffDrawer, hl, proposalCounts, proposalsPill, readyPill } from "../../board/boardHtmlHandoff";
import type { FakeElement, Page } from "../_stub/fakeDom";
import { EVIL, REV, ariaProblems, fill, isChecked, isHidden, keyWith, openBoardPage, setChecked, t } from "./boardWebviewFixture";

// The page: an opener button (so focus return can be checked), two choosable rows, the chosen line, the two
// pills that open the review tab, and the drawer itself.
function open(): Page {
  const rows = [4, 9].map((id) => `<div class="row">${chooseBox(t, id, `Doc ${id}`)}</div>`).join("");
  const page = openBoardPage(`<button type="button" id="opener">Hand off</button>${rows}${chosenLine(t)}${readyPill(t, 2)}${proposalsPill(t, 4)}${handoffDrawer(t)}`);
  page.run(HANDOFF_SCRIPT, "board-handoff.js");
  return page;
}

/** Opens the drawer the way the host does and drops the request the page makes for the document. */
function openItem(page: Page, extra: Record<string, unknown> = {}): void {
  page.receive({ type: "handoffOpen", scope: "item", i: 3, ...extra });
  page.takePosted();
}

const drawer = (page: Page): FakeElement => page.byId("hoDrawer");
const box = (page: Page, id: number): FakeElement => page.one(`input[data-choose="${id}"]`);
const pressed = (page: Page, selector: string): string[] => page.all(selector).filter((b) => b.getAttribute("aria-pressed") === "true").map((b) => b.dataset.task ?? b.dataset.fmt ?? "");
const choose = (page: Page, id: number, on: boolean): void => {
  setChecked(box(page, id), on);
  page.fire(box(page, id), "change");
};

test("the drawer starts hidden, is a labeled non-modal dialog, and every ARIA reference points at a real element", () => {
  const page = open();
  assert.equal(isHidden(drawer(page)), true);
  assert.equal(drawer(page).getAttribute("role"), "dialog");
  assert.equal(drawer(page).getAttribute("aria-modal"), "false");
  assert.deepEqual(ariaProblems(page), []);
});

test("the drawer's two tabs form a valid tab set: one selected, a panel each, the unselected one out of the tab order", () => {
  const page = open();
  const tabs = page.all("[role=tab]");
  assert.equal(tabs.length, 2);
  assert.equal(tabs.filter((x) => x.getAttribute("aria-selected") === "true").length, 1);
  assert.equal(page.all("[role=tablist]").length, 1);
  for (const tab of tabs) {
    const panel = page.byId(tab.getAttribute("aria-controls") ?? "");
    assert.equal(panel.getAttribute("role"), "tabpanel");
    assert.equal(panel.getAttribute("aria-labelledby"), tab.id);
  }
  assert.equal(page.byId("hoTabBack").getAttribute("tabindex"), "-1");
});

test("opening the drawer asks the host for the document with the default task and format, the revision and the item index", () => {
  const page = open();
  page.byId("opener").focus();
  page.receive({ type: "handoffOpen", scope: "item", i: 3 });
  assert.equal(isHidden(drawer(page)), false);
  assert.deepEqual(page.takePosted(), [{ type: "handoff", scope: "item", task: "fix", format: "md", rev: REV, i: 3 }]);
  assert.equal(page.document.activeElement, page.byId("hoClose"), "focus moves into the drawer");
});

test("an open request with no scope text is ignored, and a task the page does not know is not taken", () => {
  const page = open();
  page.receive({ type: "handoffOpen", scope: 5 });
  assert.equal(isHidden(drawer(page)), true);
  assert.deepEqual(page.takePosted(), []);
  page.receive({ type: "handoffOpen", scope: "group", i: 2, task: "bogus" });
  assert.equal((page.takePosted()[0] as { task: string }).task, "fix");
  page.receive({ type: "handoffOpen", scope: "group", i: 2, task: "review" });
  assert.equal((page.takePosted()[0] as { task: string }).task, "review");
  assert.deepEqual(pressed(page, "[data-task]"), ["review"]);
});

test("choosing a task or a format re-asks with the new value and moves the pressed state", () => {
  const page = open();
  openItem(page);
  page.click(page.one('[data-task="plan"]'));
  page.click(page.one('[data-fmt="json"]'));
  assert.deepEqual(page.takePosted(), [
    { type: "handoff", scope: "item", task: "plan", format: "md", rev: REV, i: 3 },
    { type: "handoff", scope: "item", task: "plan", format: "json", rev: REV, i: 3 },
  ]);
  assert.deepEqual(pressed(page, "[data-task]"), ["plan"]);
  assert.deepEqual(pressed(page, "[data-fmt]"), ["json"]);
});

test("an action button sends the current request with the action name; with no drawer open it sends nothing", () => {
  const page = open();
  page.click(page.one('[data-hoact="copy"]'));
  assert.deepEqual(page.takePosted(), [], "no document is open");
  openItem(page);
  page.click(page.one('[data-hoact="save"]'));
  assert.deepEqual(page.takePosted(), [{ type: "handoffAct", act: "save", scope: "item", task: "fix", format: "md", rev: REV, i: 3 }]);
});

test("the document, its size and the scope buttons arrive as text, and the size tooltip names the count without its tilde", () => {
  const page = open();
  openItem(page);
  page.receive({ type: "handoffDoc", text: `# ${EVIL}`, tokens: "~120", count: 2, avail: [{ scope: "project", i: 0 }, { scope: "item", i: 3 }] });
  assert.equal(page.byId("hoPre").textContent, `# ${EVIL}`);
  assert.equal(page.all("#hoPre img").length, 0, "the text is not parsed as markup");
  assert.equal(page.byId("hoTok").textContent, "~120");
  assert.equal(page.byId("hoTok").title, fill(hl(t, "tokenTip"), { count: "120" }));
  const scopes = page.all("#hoScope button");
  assert.equal(scopes.length, 2);
  assert.deepEqual(scopes.map((b) => b.getAttribute("aria-pressed")), ["true", "false"], "item first, in the fixed order, and it is the current one");
});

test("choosing another scope asks again for that scope and moves the pressed state", () => {
  const page = open();
  openItem(page);
  page.receive({ type: "handoffDoc", text: "x", tokens: "~1", count: 1, avail: [{ scope: "item", i: 3 }, { scope: "project", i: 0 }] });
  page.click(page.all("#hoScope button")[1]);
  assert.deepEqual(page.takePosted(), [{ type: "handoff", scope: "project", task: "fix", format: "md", rev: REV, i: 0 }]);
  assert.deepEqual(page.all("#hoScope button").map((b) => b.getAttribute("aria-pressed")), ["false", "true"]);
});

test("a document answer is ignored while the drawer is closed", () => {
  const page = open();
  page.receive({ type: "handoffDoc", text: "late", tokens: "~1", count: 1 });
  assert.equal(page.byId("hoPre").textContent, "");
});

test("the status word and its tooltip show as text", () => {
  const page = open();
  openItem(page);
  page.receive({ type: "handoffStatus", word: EVIL, tip: "Saved to <file>" });
  assert.equal(page.byId("hoMsg").textContent, EVIL);
  assert.equal(page.byId("hoMsg").title, "Saved to <file>");
  assert.equal(page.all("#hoMsg img").length, 0);
});

test("Escape and the close button close an open drawer and give focus back to what opened it; Escape on a closed drawer does nothing", () => {
  const page = open();
  page.byId("opener").focus();
  openItem(page);
  const ev = keyWith(page, page.byId("hoClose"), "Escape");
  assert.equal(isHidden(drawer(page)), true);
  assert.equal(ev.defaultPrevented, true);
  assert.equal(page.document.activeElement, page.byId("opener"));
  const again = keyWith(page, page.document.body, "Escape");
  assert.equal(again.defaultPrevented, false);
  openItem(page);
  page.click(page.byId("hoClose"));
  assert.equal(isHidden(drawer(page)), true);
});

test("the arrow keys, Home and End move between the two tabs, wrap around and focus the new tab", () => {
  const page = open();
  openItem(page);
  const hand = page.byId("hoTabHand");
  const back = page.byId("hoTabBack");
  const ev = keyWith(page, hand, "ArrowRight");
  assert.equal(ev.defaultPrevented, true);
  assert.equal(back.getAttribute("aria-selected"), "true");
  assert.equal(hand.getAttribute("aria-selected"), "false");
  assert.equal(isHidden(page.byId("hoPanelHand")), true);
  assert.equal(isHidden(page.byId("hoPanelBack")), false);
  assert.equal(page.document.activeElement, back);
  keyWith(page, back, "ArrowLeft");
  assert.equal(hand.getAttribute("aria-selected"), "true", "left from the back tab");
  keyWith(page, hand, "End");
  assert.equal(back.getAttribute("aria-selected"), "true");
  keyWith(page, back, "Home");
  assert.equal(hand.getAttribute("aria-selected"), "true");
  const other = keyWith(page, hand, "x");
  assert.equal(other.defaultPrevented, false, "other keys keep their default");
});

test("returning to the first tab asks again for the document; leaving it does not", () => {
  const page = open();
  openItem(page);
  page.click(page.byId("hoTabBack"));
  assert.deepEqual(page.takePosted(), []);
  page.click(page.byId("hoTabHand"));
  assert.deepEqual(page.takePosted(), [{ type: "handoff", scope: "item", task: "fix", format: "md", rev: REV, i: 3 }]);
});

test("ticking rows shows the count line; unticking all hides it; Clear unticks every box", () => {
  const page = open();
  const line = page.byId("hoChosen");
  assert.equal(isHidden(line), true);
  choose(page, 4, true);
  choose(page, 9, true);
  assert.equal(isHidden(line), false);
  assert.equal(page.byId("hoChosenN").textContent, fill(hl(t, "chosen"), { count: 2 }));
  choose(page, 9, false);
  assert.equal(page.byId("hoChosenN").textContent, fill(hl(t, "chosen"), { count: 1 }));
  choose(page, 4, false);
  assert.equal(isHidden(line), true);
  choose(page, 4, true);
  page.click(page.one('[data-hochosen="clear"]'));
  assert.equal(isChecked(box(page, 4)), false);
  assert.equal(isHidden(line), true);
});

test("a click or key press on a choose box does not reach the row behind it", () => {
  const page = open();
  assert.equal(page.click(box(page, 4)).propagationStopped, true);
  assert.equal(keyWith(page, box(page, 4), " ").propagationStopped, true);
});

test("opening the chosen documents sends their ids and no item index", () => {
  const page = open();
  choose(page, 9, true);
  choose(page, 4, true);
  page.click(page.one('[data-hochosen="go"]'));
  const [message] = page.takePosted() as Array<Record<string, unknown>>;
  assert.equal(message.type, "handoff");
  assert.equal(message.scope, "chosen");
  assert.equal(message.rev, REV);
  assert.deepEqual([...(message.ids as number[])].sort(), [4, 9]);
  assert.equal("i" in message, false);
});

test("the review tab lists each change as text with a named checkbox; a stale change is shown but cannot be applied", () => {
  const page = open();
  page.receive({
    type: "patchReview",
    rows: [
      { i: 0, op: "set", item: EVIL, before: "amber", after: "red", reason: "why <b>" },
      { i: 1, op: "set", item: "Old", stale: true },
    ],
    refused: [{ text: EVIL }],
  });
  assert.equal(isHidden(drawer(page)), false, "a review opens the drawer on its own");
  assert.equal(isHidden(page.byId("hoPanelBack")), false);
  assert.equal(page.all("#boList [role=listitem]").length, 3, "two changes and one refusal");
  assert.equal(page.all("#boList img").length, 0);
  const [first, second] = page.all("#boList input");
  assert.equal(isChecked(first), true);
  assert.equal(first.getAttribute("aria-label"), fill(hl(t, "backPick"), { op: "set", item: EVIL }));
  assert.equal(second.disabled, true);
  assert.equal(isChecked(second), false);
  assert.equal(page.byId("boApply").disabled, false);
});

test("Apply sends the ids of the ticked changes only; with none ticked it sends nothing", () => {
  const page = open();
  page.receive({ type: "patchReview", rows: [{ i: 0, op: "a", item: "A" }, { i: 5, op: "b", item: "B" }] });
  setChecked(page.all("#boList input")[0], false);
  page.fire(page.all("#boList input")[0], "change");
  page.click(page.byId("boApply"));
  assert.deepEqual(page.takePosted(), [{ type: "patchApply", ids: [5], rev: REV }]);
  setChecked(page.all("#boList input")[1], false);
  page.fire(page.all("#boList input")[1], "change");
  assert.equal(page.byId("boApply").disabled, true);
  page.click(page.byId("boApply"));
  assert.deepEqual(page.takePosted(), []);
});

test("Reject sends the ticked ids and empties the list", () => {
  const page = open();
  page.receive({ type: "patchReview", rows: [{ i: 2, op: "a", item: "A" }] });
  page.click(page.byId("boReject"));
  assert.deepEqual(page.takePosted(), [{ type: "patchReject", ids: [2], rev: REV }]);
  assert.equal(page.all("#boList [role=listitem]").length, 0);
});

test("a review that carries an error shows it and lists nothing", () => {
  const page = open();
  page.receive({ type: "patchReview", error: EVIL, rows: [{ i: 0, op: "a", item: "A" }] });
  assert.equal(isHidden(page.byId("boErr")), false);
  assert.equal(page.byId("boErr").textContent, EVIL);
  assert.equal(page.all("#boList [role=listitem]").length, 0);
  assert.equal(page.all("#boErr img").length, 0);
});

test("a row without a numeric index is skipped, and rows that are not a list are ignored", () => {
  const page = open();
  page.receive({ type: "patchReview", rows: [{ i: "0", op: "a", item: "A" }, null, { i: 1, op: "b", item: "B" }] });
  assert.equal(page.all("#boList [role=listitem]").length, 1);
  page.receive({ type: "patchReview", rows: "no", refused: 3 });
  assert.equal(page.all("#boList [role=listitem]").length, 0);
});

test("link proposals start unticked, can be dismissed one by one, and show their counters only when there is something to show", () => {
  const page = open();
  page.receive({ type: "patchReview", source: "links", links: { low: 2, undo: 1, shared: 0, lowOn: false }, rows: [{ i: 7, key: "k7", op: "link", item: "A", conf: "high" }] });
  assert.equal(isChecked(page.all("#boList input")[0]), false, "links are opt-in");
  assert.equal(page.byId("boApply").disabled, true);
  assert.equal(isHidden(page.byId("boLow")), false);
  assert.equal(page.byId("boLow").textContent, fill(hl(t, "linkLow"), { count: 2 }));
  assert.equal(isHidden(page.byId("boUnrej")), false);
  assert.equal(isHidden(page.byId("boShared")), true);
  setChecked(page.all("#boList input")[0], true);
  page.fire(page.all("#boList input")[0], "change");
  assert.equal(page.byId("boApply").disabled, false);
  page.click(page.byId("boLow"));
  page.click(page.byId("boUnrej"));
  page.click(page.all("#boList [role=listitem] button")[0]);
  assert.deepEqual(page.takePosted(), [
    { type: "linksOpen", low: true, rev: REV },
    { type: "linksUnreject", rev: REV },
    { type: "linksNot", i: 7, rev: REV },
  ]);
  assert.equal(page.all("#boList [role=listitem]").length, 0, "the dismissed proposal leaves the list");
});

test("a change review hides the link counters", () => {
  const page = open();
  page.receive({ type: "patchReview", source: "links", links: { low: 1, undo: 1, shared: 1 }, rows: [] });
  page.receive({ type: "patchReview", rows: [] });
  for (const id of ["boLow", "boUnrej", "boShared"]) {
    assert.equal(isHidden(page.byId(id)), true, id);
  }
});

test("Read sends the pasted text exactly as typed, markup characters included", () => {
  const page = open();
  page.byId("boText").value = EVIL;
  page.click(page.byId("boRead"));
  assert.deepEqual(page.takePosted(), [{ type: "patchRead", text: EVIL, rev: REV }]);
});

test("after changes are applied the page says how many, clears the list and hides the ready pill", () => {
  const page = open();
  page.receive({ type: "patchReview", rows: [{ i: 0, op: "a", item: "A" }] });
  page.receive({ type: "patchDone", applied: 3, skipped: 1 });
  assert.equal(page.byId("boMsg").textContent, fill(hl(t, "backApplied"), { count: 3 }));
  assert.equal(page.all("#boList [role=listitem]").length, 0);
  assert.equal(isHidden(page.one("[data-patchopen]")), true);
});

test("the ready pill follows the count the host sends: shown with the number, hidden at zero", () => {
  const page = open();
  page.receive({ type: "patchPill", count: 5 });
  assert.equal(isHidden(page.one("[data-patchopen]")), false);
  assert.equal(page.one("[data-patchopen]").textContent, fill(hl(t, "ready"), { count: 5 }));
  page.receive({ type: "patchPill", count: 0 });
  assert.equal(isHidden(page.one("[data-patchopen]")), true);
  page.receive({ type: "patchPill", count: "x" });
  assert.equal(isHidden(page.one("[data-patchopen]")), true, "a count that is not a number counts as none");
});

test("the ready and proposals pills open the review tab and ask the host for the list", () => {
  const page = open();
  page.click(page.one("[data-patchopen]"));
  assert.equal(isHidden(drawer(page)), false);
  assert.equal(page.byId("hoTabBack").getAttribute("aria-selected"), "true");
  page.click(page.one("[data-linksopen]"));
  assert.deepEqual(page.takePosted(), [{ type: "patchOpen", rev: REV }, { type: "linksOpen", rev: REV }]);
});

test("the choose box names its row with the title as text and the tooltip from the table", () => {
  const page = openBoardPage(chooseBox(t, 12, EVIL));
  const input = page.one("input");
  assert.equal(page.all("img").length, 0);
  assert.equal(input.getAttribute("aria-label"), fill(hl(t, "choose"), { title: EVIL }));
  assert.equal(input.dataset.choose, "12");
  assert.equal(input.getAttribute("type"), "checkbox");
});

test("the ready and proposals pills are drawn only for a positive whole count", () => {
  for (const bad of [0, -1, undefined, Number.NaN]) {
    assert.equal(readyPill(t, bad as number | undefined), "", String(bad));
  }
  for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(proposalsPill(t, bad), "", String(bad));
  }
  // Read the pill back through the parser so the check does not depend on how the text was escaped.
  assert.equal(openBoardPage(readyPill(t, 2.9)).one("[data-patchopen]").textContent, fill(hl(t, "ready"), { count: 2 }), "a fraction is cut down");
});

test("proposal counts split the low ones from the rest", () => {
  assert.deepEqual(proposalCounts([]), { main: 0, low: 0 });
  assert.deepEqual(proposalCounts([{ confidence: "high" }, { confidence: "low" }, { confidence: "medium" }]), { main: 2, low: 1 });
});
