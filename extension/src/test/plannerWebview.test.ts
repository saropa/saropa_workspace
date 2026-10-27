// Behavior tests for the Planner webview's chrome, day and week views, detail panel,
// right-click menus and link search.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { FakeElement, Page } from "./_stub/fakeDom";
import { daily, dataMessage, EVIL, event, open, openWith, pin, strings, tpl, type Data } from "./plannerWebviewFixture";

const WEEK_ORDER = ["1", "2", "3", "4", "5", "6", "0"];
const WEEKDAYS = [1, 2, 3, 4, 5];
const text = (els: FakeElement[]): string[] => els.map((e) => e.textContent);
const style = (el: FakeElement): Record<string, string> => el.style as unknown as Record<string, string>;
const lastState = (page: Page): Record<string, unknown> => page.states[page.states.length - 1] as Record<string, unknown>;

const SCHEDULED: Data = {
  nodes: [
    pin("p1", "Morning build", { schedule: daily("09:30", { days: WEEKDAYS }) }),
    pin("p2", "Backup", { schedule: daily("08:00", { enabled: false }) }),
  ],
  nowMin: 600,
};

test("loading tells the host it is ready and saves the default view settings", () => {
  const page = open();
  assert.deepEqual(page.takePosted(), [{ type: "ready" }]);
  assert.deepEqual(lastState(page), { view: "week", density: "compact", shelfOpen: true, detailW: 300, toolboxW: 168 });
  assert.deepEqual(page.all(".tab").map((t) => `${t.dataset.v}:${t.getAttribute("aria-selected")}`), ["day:false", "week:true", "workflow:false"]);
  assert.equal(page.document.documentElement.style.getPropertyValue("--hour-h"), "30px");
});

test("saved view settings are restored, and invalid ones fall back to the defaults", () => {
  const saved = open({ state: { view: "day", density: "comfortable", shelfOpen: false, detailW: 400, toolboxW: 200 } });
  assert.deepEqual(saved.all(".tab").map((t) => t.getAttribute("aria-selected")), ["true", "false", "false"]);
  assert.equal(saved.document.documentElement.style.getPropertyValue("--hour-h"), "60px");
  assert.equal(saved.document.documentElement.style.getPropertyValue("--detail-w"), "400px");
  assert.equal(saved.document.documentElement.style.getPropertyValue("--toolbox-w"), "200px");
  const bad = open({ state: { density: "huge", detailW: "wide" } });
  assert.equal(bad.document.documentElement.style.getPropertyValue("--hour-h"), "30px");
  assert.equal(bad.document.documentElement.style.getPropertyValue("--detail-w"), "300px");
});

test("clicking a tab switches the view, marks the tab and saves the choice", () => {
  const page = openWith("week", SCHEDULED);
  page.click(page.one('.tab[data-v="day"]'));
  assert.deepEqual(page.all(".tab").map((t) => t.getAttribute("aria-selected")), ["true", "false", "false"]);
  assert.equal(lastState(page).view, "day");
  assert.equal(page.all(".day-wrap").length, 1);
  assert.equal(page.all(".week").length, 0);
});

test("the refresh button asks the host to refresh", () => {
  const page = open();
  page.takePosted();
  page.click(page.byId("refresh"));
  assert.deepEqual(page.takePosted(), [{ type: "refresh" }]);
});

test("the density button toggles hour height, its label and the saved setting", () => {
  const page = openWith("week", SCHEDULED);
  const s = strings(page);
  page.click(page.byId("density"));
  assert.equal(page.document.documentElement.style.getPropertyValue("--hour-h"), "60px");
  assert.equal(page.byId("density").textContent, `↕ ${s.densityComfortable}`);
  assert.equal(lastState(page).density, "comfortable");
  assert.equal(style(page.one(".block")).top, "570px");
  page.click(page.byId("density"));
  assert.equal(page.byId("density").textContent, `≡ ${s.densityCompact}`);
  assert.equal(style(page.one(".block")).top, "285px");
});

test("dragging the detail handle resizes the detail pane within its limits and saves on release", () => {
  const page = open();
  const width = (): string => page.document.documentElement.style.getPropertyValue("--detail-w");
  page.fire(page.byId("rsz-detail"), "mousedown", { button: 0, clientX: 500 });
  page.fire(page.document, "mousemove", { clientX: 450 });
  assert.equal(width(), "350px");
  page.fire(page.document, "mousemove", { clientX: 0 });
  assert.equal(width(), "560px");
  page.fire(page.document, "mouseup");
  assert.equal(lastState(page).detailW, 560);
  assert.equal(page.document.listenerCount("mousemove"), 0);
});

// ---- week ------------------------------------------------------------------

test("the week view has seven Monday-first columns with every scheduled shortcut on its days", () => {
  const page = openWith("week", SCHEDULED);
  assert.deepEqual(page.all(".daycol").map((c) => c.dataset.day), WEEK_ORDER);
  const names = page.evalJson("DAYS") as string[];
  assert.deepEqual(text(page.all(".dow")), WEEK_ORDER.map((d) => names[Number(d)]));
  assert.deepEqual(page.all(".col-head .count").map((c) => c.textContent), ["2", "2", "2", "2", "2", "1", "1"]);
  assert.deepEqual(page.all(".daycol").map((c) => c.children.filter((b) => b.classList.contains("block")).map((b) => b.dataset.id).join("+")), ["p1+p2", "p1+p2", "p1+p2", "p1+p2", "p1+p2", "p2", "p2"]);
  assert.equal(page.all(".block").length, 12);
});

test("a block sits at its time, shows label and time, and a paused one is dimmed", () => {
  const page = openWith("week", SCHEDULED);
  const [p1, p2] = [firstBlock(page), firstBlock(page, "p2")];
  assert.deepEqual([style(p1).top, style(p1).height, p1.dataset.day], ["285px", "24px", "1"]);
  assert.equal(style(p2).top, "240px");
  assert.equal(p1.querySelector(".bt")!.textContent, "Morning build");
  assert.equal(p1.querySelector(".bm")!.textContent, "09:30");
  assert.equal(p1.title, `Morning build — ${strings(page).weekBlockHint}`);
  assert.deepEqual([p1.className, p2.className], ["block", "block off"]);
  assert.equal(style(page.one(".daycol")).height, "720px");
});

test("only today's column carries the now line, placed at the current minute", () => {
  const page = openWith("week", SCHEDULED);
  const today = page.all(".daycol.today");
  assert.deepEqual(today.map((c) => c.dataset.day), [String(new Date().getDay())]);
  assert.equal(page.all(".nowline").length, 1);
  assert.equal(style(today[0].querySelector(".nowline")!).top, "300px");
  assert.equal(page.all(".col-head.today").length, 1);
});

test("a day nobody is scheduled on shows a blank count", () => {
  const page = openWith("week", { nodes: [pin("p1", "Weekday", { schedule: daily("09:00", { days: WEEKDAYS }) })] });
  assert.deepEqual(page.all(".col-head .count").map((c) => c.textContent), ["1", "1", "1", "1", "1", "", ""]);
});

test("with nothing scheduled the week view explains why, above an empty grid", () => {
  const page = openWith("week", { nodes: [pin("p1", "Manual only"), pin("p2", "Interval", { schedule: { everyMs: 60000, enabled: true } })] });
  const s = strings(page);
  assert.equal(page.one(".empty .big").textContent, s.weekEmptyTitle);
  assert.equal(page.all(".block").length, 0);
  assert.equal(page.all(".daycol").length, 7);
});

test("shortcut names are escaped in the week blocks and the detail panel", () => {
  const page = openWith("week", { nodes: [pin("p1", EVIL, { scope: EVIL, description: EVIL, schedule: daily("09:00") })] });
  assert.equal(page.one(".bt").textContent, EVIL);
  press(page, page.one(".block"));
  assert.equal(page.one(".dt").textContent, EVIL);
  assert.equal(page.one(".badge").textContent, EVIL);
  assert.equal(page.one(".dinfo").children[1].textContent, EVIL);
  assert.equal(page.all("img").length, 0);
});

/** A press and release without moving: selects blocks and nodes. */
function press(page: Page, el: FakeElement): void {
  page.fire(el, "mousedown", { button: 0, clientX: 1, clientY: 1 });
  page.fire(page.document, "mouseup", { clientX: 1, clientY: 1 });
}

function dragBlock(page: Page, block: FakeElement, dy: number, dropOn: FakeElement | null, dx = 0): void {
  page.fire(block, "mousedown", { button: 0, clientX: 100, clientY: 100 });
  page.fire(page.document, "mousemove", { clientX: 100 + dx, clientY: 100 + dy });
  page.document.hitTest = () => dropOn;
  page.fire(page.document, "mouseup", { clientX: 100 + dx, clientY: 100 + dy });
}
const firstBlock = (page: Page, id = "p1"): FakeElement => page.all(".daycol")[0].children.find((b) => b.dataset.id === id)!;

test("dragging a block to another day column asks the host to retime it, snapped to 15 minutes", () => {
  const page = openWith("week", SCHEDULED);
  dragBlock(page, firstBlock(page), 30, page.all(".daycol")[2]);
  assert.deepEqual(page.takePosted(), [{ type: "retime", id: "p1", fromDay: 1, toDay: 3, atTime: "10:30" }]);
  assert.equal(firstBlock(page).classList.contains("dragging"), false);
});

test("a drag that ends outside every column keeps the block's own day", () => {
  const page = openWith("week", SCHEDULED);
  dragBlock(page, firstBlock(page), 8, null);
  assert.deepEqual(page.takePosted(), [{ type: "retime", id: "p1", fromDay: 1, toDay: 1, atTime: "09:45" }]);
});

test("a block cannot be dragged above midnight or past the end of the day", () => {
  const page = openWith("week", SCHEDULED);
  dragBlock(page, firstBlock(page), -5000, null);
  assert.deepEqual(page.takePosted(), [{ type: "retime", id: "p1", fromDay: 1, toDay: 1, atTime: "00:00" }]);
  const again = openWith("week", SCHEDULED);
  dragBlock(again, firstBlock(again), 5000, null);
  assert.deepEqual(again.takePosted(), [{ type: "retime", id: "p1", fromDay: 1, toDay: 1, atTime: "23:45" }]);
});

test("pressing and releasing a block without moving selects it instead of retiming", () => {
  const page = openWith("week", SCHEDULED);
  dragBlock(page, firstBlock(page), 2, null);
  assert.deepEqual(page.takePosted(), []);
  assert.equal(page.byId("detail").classList.contains("show"), true);
  assert.deepEqual(page.all(".block.sel").map((b) => b.dataset.id), ["p1", "p1", "p1", "p1", "p1"]);
});

// ---- day -------------------------------------------------------------------

const DAY: Data = {
  nodes: [
    pin("d1", "Nine", { schedule: daily("09:00") }),
    pin("d2", "Ten", { schedule: daily("10:00", { enabled: false, days: [1] }) }),
    pin("d3", "Eight pm", { schedule: daily("20:00") }),
    pin("i1", "Ninety", { schedule: { everyMs: 90 * 60000, enabled: true } }),
    pin("i2", "Two hours", { schedule: { everyMs: 120 * 60000, enabled: true } }),
    pin("i3", "Daily", { schedule: { everyMs: 1440 * 60000, enabled: true } }),
  ],
  nowMin: 720,
};

test("the day view draws a 24-hour ruler with a label every three hours and a now marker", () => {
  const page = openWith("day", DAY);
  assert.equal(page.all(".hour").length, 25);
  assert.equal(page.all(".hour.major").length, 5);
  assert.deepEqual(text(page.all(".hlabel")), ["00:00", "03:00", "06:00", "09:00", "12:00", "15:00", "18:00", "21:00"]);
  assert.equal(style(page.one(".now")).left, "50%");
  assert.equal(page.one(".now").getAttribute("data-label"), strings(page).now);
});

test("daily shortcuts are markers at their time, stacked in rows when they would overlap", () => {
  const page = openWith("day", DAY);
  const markers = page.all(".marker");
  assert.deepEqual(markers.map((m) => m.dataset.id), ["d1", "d2", "d3"]);
  assert.deepEqual(markers.map((m) => style(m).left), [`${(540 / 1440) * 100}%`, `${(600 / 1440) * 100}%`, `${(1200 / 1440) * 100}%`]);
  assert.deepEqual(markers.map((m) => style(m).bottom), ["8px", "34px", "8px"]);
  assert.equal(style(page.one(".ruler")).minHeight, "50px");
  assert.deepEqual(markers.map((m) => m.querySelector(".tag")!.textContent), ["Nine  09:00", "Ten  10:00", "Eight pm  20:00"]);
  assert.deepEqual(markers.map((m) => m.querySelector(".shortcut-dot")!.className), ["shortcut-dot", "shortcut-dot off", "shortcut-dot"]);
});

test("a marker's tooltip names the time and the days", () => {
  const page = openWith("day", DAY);
  const s = strings(page);
  const titles = page.all(".marker").map((m) => m.title);
  assert.equal(titles[0], `Nine — 09:00 · ${s.daysEveryDay}`);
  assert.equal(titles[1], `Ten — 10:00 · ${(page.evalJson("DAYS") as string[])[1]}`);
});

test("clicking a marker selects it and double-clicking runs it", () => {
  const page = openWith("day", DAY);
  page.click(page.all(".marker")[2]);
  assert.equal(page.one(".dt").textContent, "Eight pm");
  assert.deepEqual(page.all(".marker.sel").map((m) => m.dataset.id), ["d3"]);
  page.fire(page.all(".marker")[0], "dblclick");
  assert.deepEqual(page.takePosted(), [{ type: "run", id: "d1" }]);
});

test("interval shortcuts are listed with their cadence in minutes, hours or days", () => {
  const page = openWith("day", DAY);
  const s = strings(page);
  assert.deepEqual(text(page.all(".interval-chip")), [
    `Ninety${tpl(s.everyMinutes, { count: 90 })}`,
    `Two hours${tpl(s.everyHours, { count: 2 })}`,
    `Daily${tpl(s.everyDays, { count: 1 })}`,
  ]);
  page.fire(page.all(".interval-chip")[1], "dblclick");
  assert.deepEqual(page.takePosted(), [{ type: "run", id: "i2" }]);
  page.click(page.all(".interval-chip")[0]);
  assert.equal(page.one(".dt").textContent, "Ninety");
});

test("the day view with nothing scheduled shows the empty message", () => {
  const page = openWith("day", { nodes: [pin("p", "Manual")] });
  assert.equal(page.one(".empty .big").textContent, strings(page).dayEmptyTitle);
  assert.equal(page.all(".ruler").length, 0);
});

// ---- detail panel ----------------------------------------------------------

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

// ---- right-click menu ------------------------------------------------------

function rightClick(page: Page, el: FakeElement, x = 30, y = 40): void {
  page.fire(el, "contextmenu", { clientX: x, clientY: y });
}
const menu = (page: Page): FakeElement | null => page.document.querySelector(".menu");
const rows = (page: Page): string[] => menu(page)!.children.map((c) => (c.classList.contains("msep") ? "-" : c.textContent));

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

// ---- link search -----------------------------------------------------------

const LINKABLE: Data = { nodes: [pin("a", "Alpha"), pin("b", "Beta build"), pin("c", "Gamma build", { scope: "global" }), event("ev", "build", "Event")] };

function openLinkSearch(page: Page): FakeElement {
  rightClick(page, page.one('.shelf-shortcut[data-id="a"]'));
  page.click(menu(page)!.children[menu(page)!.children.length - 1]);
  return page.one(".ac input");
}
const options = (page: Page): string[] => page.all(".ac .opt").map((o) => o.textContent);

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
