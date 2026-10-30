// The "Bring back" tab of the hand-off drawer: the markup, the ready pill, the menu entries, and the
// page script driven against the small fake DOM.

import { test } from "node:test";
import assert from "node:assert/strict";
import { renderBoard } from "../../board/boardHtml";
import { optsMenu } from "../../board/boardHtmlMenus";
import { HANDOFF_SCRIPT, handoffDrawer, readyPill } from "../../board/boardHtmlHandoff";
import { buildBoard } from "../../board/boardModel";
import { BoardConfig, Classified } from "../../board/types";
import { HANDOFF_LABEL_KEYS, strings } from "../../views/boardStrings";
import { runPage, type FakeElement, type Page } from "../_stub/fakeDom";

// The page script sets plain properties the fake element does not declare.
type El = FakeElement & { hidden: boolean; checked: boolean; tabIndex: number };
const by = (p: Page, id: string): El => p.byId(id) as El;

const t = strings();
const cfg: BoardConfig = { version: 1, ignore: [], ruleSets: {}, projects: [{ id: "app", name: "App", path: "app", roots: ["docs"], ruleSets: [] }] };
const row = (p: string): Classified => ({ project: "app", path: p, status: "amber", kind: "", note: "" });
const html = (ready?: number): string => renderBoard(buildBoard(cfg, [row("docs/a.md")], undefined, true), t, "n", 7, { patchReady: ready });
// Only the drawer and its script: the full page script uses selectors the small fake DOM lacks.
const open = (ready?: number): Page => runPage(`<html><body>${readyPill(t, ready)}${handoffDrawer(t)}<script>const vscode=acquireVsCodeApi();const REV=7;${HANDOFF_SCRIPT}</script></body></html>`);
const REVIEW = {
  type: "patchReview",
  source: "paste",
  rows: [
    { i: 0, op: "status", item: "A <b>", before: "amber", after: "green", reason: "done", stale: false },
    { i: 1, op: "severity", item: "B", before: "", after: "high", reason: "", stale: true },
    { i: 2, op: "group", item: "C", before: "x", after: "y", reason: "r", stale: false },
  ],
  refused: [{ n: 3, text: "bad op" }],
};

test("every new label resolves to real text", () => {
  for (const k of HANDOFF_LABEL_KEYS) {
    const v = t.handoffLabels?.[k] ?? "";
    assert.ok(v.length > 0 && !v.startsWith("releaseBoard."), k);
  }
});

test("the drawer has two tabs with matching panels, a labelled textarea and the Organize task", () => {
  const d = handoffDrawer(t);
  assert.ok(d.includes('role="tablist"') && d.includes('role="tab" id="hoTabHand" aria-selected="true" aria-controls="hoPanelHand" tabindex="0"'));
  assert.ok(d.includes('id="hoTabBack" aria-selected="false" aria-controls="hoPanelBack" tabindex="-1"'));
  assert.ok(d.includes('id="hoPanelHand" role="tabpanel" aria-labelledby="hoTabHand"') && d.includes('id="hoPanelBack" role="tabpanel" aria-labelledby="hoTabBack"'));
  assert.ok(/<textarea id="boText" aria-label="[^"]+" title="[^"]+"/.test(d));
  assert.ok(d.includes('data-task="organize"') && d.includes('role="note"'));
  assert.ok(d.indexOf('id="hoScope"') < d.indexOf('id="hoPanelBack"'));
});

test("the options menu offers Organize and Bring back after the board hand-off", () => {
  const acts = [...optsMenu(t).matchAll(/data-act="(\w+)"/g)].map((m) => m[1]);
  assert.deepEqual(acts.slice(0, 3), ["handBoard", "organize", "bringBack"]);
});

test("the ready pill is in the static page only with changes waiting, and escapes its text", () => {
  assert.equal(html().includes("class=\"ho-pill\" data-patchopen"), false);
  assert.equal(html(0).includes("class=\"ho-pill\" data-patchopen"), false);
  assert.ok(html(4).includes("class=\"ho-pill\" data-patchopen") && html(4).includes("AI result ready, 4 changes"));
  assert.equal(readyPill(t, Number("<b>")), "");
  const hostile = { ...t, handoffLabels: { ready: '<img src=x onerror="1"> {count}', readyTip: '"><script>' } } as typeof t;
  const p = readyPill(hostile, 2);
  assert.ok(!p.includes("<img") && !p.includes("<script") && p.includes("&#60;img") && p.includes("2"));
});

test("the page script knows every message of the bring-back flow", () => {
  const h = html(1);
  for (const m of ["patchRead", "patchApply", "patchReject", "patchOpen", "patchReview", "patchDone", "handoffBack"]) {
    assert.ok(h.includes(m), m);
  }
});

test("pasting and pressing Read reply posts the text", () => {
  const page = open();
  page.receive({ type: "handoffBack" });
  by(page, "boText").value = "reply";
  page.click(by(page, "boRead"));
  assert.deepEqual(page.takePosted(), [{ type: "patchRead", text: "reply", rev: 7 }]);
});

test("a review lists the rows, disables the stale one, posts only the ticked ids and escapes host text", () => {
  const page = open();
  page.receive(REVIEW);
  assert.equal(by(page, "hoDrawer").hidden, false);
  assert.equal(by(page, "hoTabBack").getAttribute("aria-selected"), "true");
  const boxes = (page.all("#boList input") as El[]);
  assert.equal(boxes.length, 3);
  assert.equal(boxes[1].disabled, true);
  assert.equal(boxes[1].checked, false);
  assert.ok(boxes.every((b) => (b.getAttribute("aria-label") ?? "").length > 0));
  assert.ok(by(page, "boList").textContent.includes("A <b>") && by(page, "boList").textContent.includes("bad op"));
  assert.equal(page.all("#boList b").length, 0);
  assert.equal(by(page, "boApply").disabled, false);
  boxes[2].checked = false;
  page.fire(boxes[2], "change");
  page.click(by(page, "boApply"));
  assert.deepEqual(page.takePosted(), [{ type: "patchApply", ids: [0], rev: 7 }]);
  boxes[0].checked = false;
  page.fire(boxes[0], "change");
  assert.equal(by(page, "boApply").disabled, true);
});

test("an error shows as an alert with an empty list; Reject all posts patchReject; done shows the status", () => {
  const page = open();
  page.receive({ type: "patchReview", source: "paste", error: "No patch found", rows: [], refused: [] });
  assert.equal(by(page, "boErr").hidden, false);
  assert.equal(by(page, "boErr").textContent, "No patch found");
  assert.equal((page.all("#boList input") as El[]).length, 0);
  page.receive(REVIEW);
  page.click(by(page, "boReject"));
  assert.deepEqual(page.takePosted(), [{ type: "patchReject", rev: 7 }]);
  assert.equal((page.all("#boList input") as El[]).length, 0);
  page.receive({ type: "patchDone", applied: 2, skipped: 1 });
  assert.equal(by(page, "boMsg").textContent, "Applied 2");
  assert.ok((by(page, "boMsg").title ?? "").includes("1 skipped"));
});

test("the ready pill opens the Bring back tab and asks the host; arrow keys switch tabs; Esc closes", () => {
  const page = open(3);
  page.click(page.one("[data-patchopen]"));
  assert.deepEqual(page.takePosted(), [{ type: "patchOpen", rev: 7 }]);
  assert.equal(by(page, "hoPanelBack").hidden, false);
  assert.equal(by(page, "hoPanelHand").hidden, true);
  page.key(by(page, "hoTabBack"), "ArrowLeft");
  assert.equal(by(page, "hoTabHand").getAttribute("aria-selected"), "true");
  assert.equal(by(page, "hoTabHand").tabIndex, 0);
  page.takePosted();
  page.key(page.document, "Escape");
  assert.equal(by(page, "hoDrawer").hidden, true);
});

test("a hand-off open can carry the task and no request goes out while the Bring back tab is shown", () => {
  const page = open();
  page.receive({ type: "handoffOpen", scope: "board", task: "organize" });
  const sent = page.takePosted() as Array<{ type: string; task: string }>;
  assert.equal(sent[0].type, "handoff");
  assert.equal(sent[0].task, "organize");
  page.click(by(page, "hoTabBack"));
  assert.deepEqual(page.takePosted(), []);
});
