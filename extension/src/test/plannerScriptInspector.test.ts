// Tests for the Planner webview's detail panel, right-click menus and link search.

import { test } from "node:test";
import assert from "node:assert/strict";
import { EVIL, pin, event, dataMessage, openWith, strings, tpl, style, SCHEDULED, press, firstBlock, rightClick, menu, rows, LINKABLE, openLinkSearch, options } from "./plannerWebviewFixture";

test("the detail panel lists the schedule and offers run, open, schedule, triggers and pause", () => {
  const page = openWith("week", SCHEDULED);
  const s = strings(page);
  press(page, firstBlock(page));
  const box = page.byId("detail");
  assert.equal(box.classList.contains("show"), true);
  assert.equal(page.one(".dl").textContent, `${tpl(s.detailDailyAt, { time: "09:30" })} · ${s.daysWeekdays}`);
  assert.deepEqual(page.all("#detail-body button[data-act]").map((b) => b.dataset.act), ["close", "run", "open", "schedule", "triggers", "toggle"]);
  assert.equal(page.one('button[data-act="toggle"]').textContent, `⏸ ${s.pause}`);
  const posted = ["run", "open", "schedule", "triggers", "toggle"].map((act) => {
    page.click(page.one(`button[data-act="${act}"]`));
    return page.takePosted()[0];
  });
  assert.deepEqual(posted, [
    { type: "run", id: "p1" }, { type: "open", id: "p1" }, { type: "configureSchedule", id: "p1" },
    { type: "configureTriggers", id: "p1" }, { type: "toggleEnabled", id: "p1" },
  ]);
});

test("a paused schedule says so and offers resume", () => {
  const page = openWith("week", SCHEDULED);
  const s = strings(page);
  press(page, firstBlock(page, "p2"));
  assert.equal(page.one(".dl").textContent, `${tpl(s.detailDailyAt, { time: "08:00" })} · ${s.daysEveryDay} ${s.detailPaused}`);
  assert.equal(page.one('button[data-act="toggle"]').textContent, `▶ ${s.resume}`);
});

test("a shortcut that cannot be opened has no open button, and an unscheduled one says none", () => {
  const page = openWith("day", { nodes: [pin("p", "Interval", { runnable: false, schedule: { everyMs: 3600000, enabled: true } })] });
  page.click(page.one(".interval-chip"));
  assert.deepEqual(page.all("#detail-body button[data-act]").map((b) => b.dataset.act), ["close", "run", "schedule", "triggers", "toggle"]);
  const plain = openWith("workflow", { nodes: [pin("a", "A"), pin("b", "B")], edges: [{ from: "a", to: "b", kind: "pin" }] });
  press(plain, plain.one('.node[data-id="a"]'));
  assert.equal(plain.one(".dl").textContent, strings(plain).detailNone);
  assert.deepEqual(plain.all("#detail-body button[data-act]").map((b) => b.dataset.act), ["close", "run", "open", "schedule", "triggers"]);
});

test("the detail panel names what a shortcut runs after and what it emits", () => {
  const nodes = [pin("p1", "Build"), event("ev1", "build", "Build finished"), pin("p3", "Deploy", { emits: ["done", "failed"] })];
  const page = openWith("workflow", { nodes, edges: [{ from: "p1", to: "p3", kind: "pin" }, { from: "ev1", to: "p3", kind: "event" }] });
  const s = strings(page);
  press(page, page.one('.node[data-id="p3"]'));
  const after = [tpl(s.detailAfter, { name: "Build" }), tpl(s.detailAfter, { name: "\u{1F528} Build finished" })].join(", ");
  assert.equal(page.one(".dl").textContent, [tpl(s.detailRuns, { list: after }), tpl(s.detailEmits, { list: "done, failed" })].join("  —  "));
});

test("the close button hides the detail panel and clears the selection", () => {
  const page = openWith("week", SCHEDULED);
  press(page, firstBlock(page));
  page.click(page.one('button[data-act="close"]'));
  assert.equal(page.byId("detail").classList.contains("show"), false);
  assert.equal(page.byId("detail-body").innerHTML, "");
  assert.equal(page.all(".block.sel").length, 0);
});

test("a refresh that removes the selected shortcut hides its detail panel", () => {
  const page = openWith("week", SCHEDULED);
  press(page, firstBlock(page));
  page.receive(dataMessage({ nodes: [SCHEDULED.nodes[1]], nowMin: 0 }));
  assert.equal(page.byId("detail").classList.contains("show"), false);
});

test("right-clicking a block selects it and opens a menu at the pointer", () => {
  const page = openWith("week", SCHEDULED);
  const s = strings(page);
  assert.equal(page.fire(firstBlock(page), "contextmenu", { clientX: 30, clientY: 40 }).defaultPrevented, true);
  assert.deepEqual(rows(page), [
    `▶ ${s.runNow}`, s.open, "-", `\u{1F551} ${s.schedule}`, `\u{1F517} ${s.triggers}`, `\u{1F4E1} ${s.markEmits}`, `⏸ ${s.pauseSchedule}`, "-", `\u{1F517} ${s.addLinkFromHere}`,
  ]);
  assert.deepEqual([style(menu(page)!).left, style(menu(page)!).top], ["30px", "40px"]);
  assert.equal(page.byId("detail").classList.contains("show"), true);
  assert.equal(page.all(".menu").length, 1);
});

test("menu rows post the same messages as the detail buttons", () => {
  const page = openWith("week", SCHEDULED);
  const s = strings(page);
  const pick = (label: string): unknown => {
    rightClick(page, firstBlock(page));
    page.click(menu(page)!.children.find((c) => c.textContent === label)!);
    assert.equal(menu(page), null, "the menu closes after a pick");
    return page.takePosted()[0];
  };
  assert.deepEqual(pick(`▶ ${s.runNow}`), { type: "run", id: "p1" });
  assert.deepEqual(pick(s.open), { type: "open", id: "p1" });
  assert.deepEqual(pick(`\u{1F551} ${s.schedule}`), { type: "configureSchedule", id: "p1" });
  assert.deepEqual(pick(`\u{1F4E1} ${s.markEmits}`), { type: "configureTriggers", id: "p1" });
  assert.deepEqual(pick(`⏸ ${s.pauseSchedule}`), { type: "toggleEnabled", id: "p1" });
});

test("a menu opened near the corner is pulled back inside the window", () => {
  const page = openWith("week", SCHEDULED);
  page.window.innerWidth = 300;
  page.window.innerHeight = 200;
  rightClick(page, firstBlock(page), 5000, 5000);
  assert.deepEqual([style(menu(page)!).left, style(menu(page)!).top], ["292px", "192px"]);
});

test("a shortcut with incoming links lists a row to remove each, and the row posts the removal", () => {
  const page = openWith("workflow", { nodes: [pin("a", "Source"), pin("b", "Target")], edges: [{ from: "a", to: "b", kind: "pin" }] });
  const s = strings(page);
  rightClick(page, page.one('.node[data-id="b"]'));
  assert.equal(page.one(".mhead").textContent, s.removeTriggerHeading);
  const remove = menu(page)!.children[menu(page)!.children.length - 1];
  assert.equal(remove.className, "mi danger");
  assert.equal(remove.textContent, `✖ ${tpl(s.detailAfter, { name: "Source" })}`);
  page.click(remove);
  assert.deepEqual(page.takePosted(), [{ type: "removeTrigger", to: "b", from: "a" }]);
});

test("an event node's menu offers only the removal rows", () => {
  const page = openWith("workflow", { nodes: [event("ev", "build", "Build"), pin("b", "Target")], edges: [{ from: "ev", to: "b", kind: "event" }] });
  rightClick(page, page.one('.node[data-id="ev"]'));
  assert.equal(menu(page), null);
});

test("Escape and a press outside close the menu; a press inside does not", () => {
  const page = openWith("week", SCHEDULED);
  rightClick(page, firstBlock(page));
  page.fire(menu(page)!.children[0], "mousedown");
  assert.notEqual(menu(page), null);
  page.fire(page.document.body, "mousedown");
  assert.equal(menu(page), null);
  rightClick(page, firstBlock(page));
  page.key(page.document, "Escape");
  assert.equal(menu(page), null);
});

test("menu labels are plain text, so a shortcut name cannot inject markup", () => {
  const page = openWith("workflow", { nodes: [pin("a", EVIL), pin("b", "Target")], edges: [{ from: "a", to: "b", kind: "pin" }] });
  rightClick(page, page.one('.node[data-id="b"]'));
  assert.equal(page.all("img").length, 0);
  assert.equal(page.all(".mi").some((m) => m.textContent.includes(EVIL)), true);
});

test("Add link from here opens a search of the other shortcuts, focused, and Enter links to the first", () => {
  const page = openWith("workflow", LINKABLE);
  const input = openLinkSearch(page);
  assert.equal(input.placeholder, strings(page).linkPlaceholderTarget);
  page.timers.runAll();
  assert.equal(page.document.activeElement, input);
  assert.deepEqual(options(page), ["\u{1F4BB}Beta buildworkspace", "\u{1F4BB}Gamma buildglobal"]);
  assert.equal(page.all(".ac .opt")[0].classList.contains("active"), true);
  page.key(input, "Enter");
  assert.deepEqual(page.takePosted(), [{ type: "addTrigger", to: "b", kind: "pin", from: "a" }]);
  assert.equal(page.all(".ac").length, 0);
});

test("typing narrows the list, the arrow keys move the highlight, and no match says so", () => {
  const page = openWith("workflow", LINKABLE);
  const input = openLinkSearch(page);
  page.key(input, "ArrowDown");
  assert.deepEqual(page.all(".ac .opt").map((o) => o.classList.contains("active")), [false, true]);
  page.key(input, "ArrowDown");
  page.key(input, "ArrowUp");
  page.key(input, "ArrowUp");
  page.key(input, "ArrowUp");
  assert.deepEqual(page.all(".ac .opt").map((o) => o.classList.contains("active")), [true, false]);
  page.key(input, "ArrowDown");
  page.type(input, "GAMMA");
  assert.deepEqual(options(page), ["\u{1F4BB}Gamma buildglobal"]);
  page.key(input, "Enter");
  assert.deepEqual(page.takePosted(), [{ type: "addTrigger", to: "c", kind: "pin", from: "a" }]);
  const again = openLinkSearch(page);
  page.type(again, "zzz");
  assert.equal(page.one(".ac .none").textContent, strings(page).linkNoMatch);
  page.key(again, "Enter");
  assert.deepEqual(page.takePosted(), []);
});

test("hovering highlights an option and clicking it links; Escape closes the search", () => {
  const page = openWith("workflow", LINKABLE);
  openLinkSearch(page);
  page.fire(page.all(".ac .opt")[1], "mouseenter");
  assert.deepEqual(page.all(".ac .opt").map((o) => o.classList.contains("active")), [false, true]);
  page.click(page.all(".ac .opt")[1]);
  assert.deepEqual(page.takePosted(), [{ type: "addTrigger", to: "c", kind: "pin", from: "a" }]);
  const input = openLinkSearch(page);
  page.key(input, "Escape");
  assert.equal(page.all(".ac").length, 0);
});

test("option names are escaped", () => {
  const page = openWith("workflow", { nodes: [pin("a", "Alpha"), pin("b", EVIL, { scope: EVIL })] });
  openLinkSearch(page);
  assert.equal(page.all("img").length, 0);
  assert.equal(page.one(".ac .opt").children[1].textContent, EVIL);
});
