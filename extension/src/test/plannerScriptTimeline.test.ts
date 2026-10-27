// Tests for the Planner webview's day and week views.

import { test } from "node:test";
import assert from "node:assert/strict";
import { EVIL, pin, daily, openWith, strings, tpl, WEEK_ORDER, WEEKDAYS, text, style, SCHEDULED, press, dragBlock, firstBlock, DAY } from "./plannerWebviewFixture";

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
