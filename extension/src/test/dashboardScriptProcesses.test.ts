// Tests for the Dashboard webview's Processes tab: sorting, the sparkline, the grouped table and end-task buttons.

import { test } from "node:test";
import assert from "node:assert/strict";
import { EVIL, open, strings, proc, group, dataMessage, groupNames } from "./dashboardWebviewFixture";

test("the host line reports cores, memory in use and the sample time", () => {
  const page = open();
  page.receive(dataMessage([group("node", 1, 1024, [proc(1, "a", 1, 1024)])]));
  assert.equal(page.byId("host").textContent, `8 logical cores · 16.0 GB RAM (10.0 GB in use) · sampled ${new Date(1_700_000_000_000).toLocaleTimeString()}`);
});

test("groups are listed by CPU first, then re-sorted by memory and by process count", () => {
  const page = open();
  page.receive(dataMessage([
    group("low", 5, 900, [proc(1, "a", 5, 900)]),
    group("busy", 60, 100, [proc(2, "b", 60, 100), proc(3, "c", 0, 0)]),
    group("big", 20, 5000, [proc(4, "d", 20, 5000)]),
  ]));
  assert.deepEqual(groupNames(page), ["busy", "big", "low"]);
  page.click(page.byId("sortRam"));
  assert.deepEqual(groupNames(page), ["big", "low", "busy"]);
  assert.deepEqual(page.all(".seg.active").map((b) => b.id), ["sortRam"]);
  page.click(page.byId("sortPid"));
  assert.deepEqual(groupNames(page), ["busy", "low", "big"]);
  page.click(page.byId("sortCpu"));
  assert.deepEqual(groupNames(page), ["busy", "big", "low"]);
});

test("a group at or above 50 percent CPU gets the hot label and a hot, full-width bar", () => {
  const page = open();
  page.receive(dataMessage([group("busy", 75.25, 100, [proc(1, "a", 75.25, 100)]), group("calm", 49.9, 100, [proc(2, "b", 49.9, 100)])]));
  const [busy, calm] = page.all(".group");
  assert.equal(busy.querySelector(".worst")?.textContent, strings(page).hot);
  assert.equal(calm.querySelector(".worst"), null);
  assert.equal(busy.querySelector(".bar")?.className, "bar hot");
  assert.equal((busy.querySelector(".bar")!.style as unknown as Record<string, string>).width, "75.3%");
  assert.equal(calm.querySelector(".bar")?.className, "bar");
});

test("an over-100 percent group still draws a bar capped at 100", () => {
  const page = open();
  page.receive(dataMessage([group("x", 340, 100, [proc(1, "a", 340, 100)])]));
  assert.equal((page.one(".bar").style as unknown as Record<string, string>).width, "100.0%");
});

test("clicking a group head opens its process table and clicking again closes it", () => {
  const page = open();
  page.receive(dataMessage([group("node", 10, 2048, [proc(11, "node", 7.5, 2048), proc(12, "tsserver", 2.5, 1536)])]));
  assert.equal(page.all("table").length, 0);
  page.click(page.one(".group-head"));
  assert.deepEqual(page.all("tbody tr").map((r) => r.children.map((c) => c.textContent).join("|")), ["11|node|7.5|2.0 KB|", "12|tsserver|2.5|1.5 KB|"]);
  assert.equal(page.one(".twist").textContent, "▾");
  page.click(page.one(".group-head"));
  assert.equal(page.all("table").length, 0);
  assert.equal(page.one(".twist").textContent, "▸");
});

test("end-task buttons appear only for killable tools and post the exact process", () => {
  const page = open();
  page.receive(dataMessage(
    [group("node", 10, 100, [proc(11, "node", 1, 1)]), group("system", 10, 100, [proc(99, "init", 1, 1)])],
    { killable: { node: true } },
  ));
  page.all(".group-head").forEach((h) => page.click(h));
  const kills = page.all("button.kill");
  assert.equal(kills.length, 1);
  assert.equal(kills[0].textContent, strings(page).endTask);
  page.takePosted();
  const ev = page.click(kills[0]);
  assert.deepEqual(page.takePosted(), [{ type: "kill", pid: 11, name: "node", tool: "node" }]);
  assert.equal(ev.propagationStopped, true);
  assert.equal(page.all("table").length, 2, "the click did not collapse the group");
});

test("untrusted process and tool names are escaped in the markup and survive a kill round trip", () => {
  const page = open();
  page.receive(dataMessage([group(EVIL, 10, 100, [proc(5, EVIL, 1, 1)])], { killable: { [EVIL]: true } }));
  page.click(page.one(".group-head"));
  assert.equal(page.all("img").length, 0);
  assert.equal(page.one(".group-name").textContent, EVIL);
  assert.equal(page.all("tbody td")[1].textContent, EVIL);
  page.takePosted();
  page.click(page.one("button.kill"));
  assert.deepEqual(page.takePosted(), [{ type: "kill", pid: 5, name: EVIL, tool: EVIL }]);
});

test("a result with no groups shows the empty message", () => {
  const page = open();
  page.receive(dataMessage([]));
  assert.equal(page.one("#groups .empty").textContent, strings(page).processEmpty);
});

test("the sparkline plots the trend scaled to its peak, and clears for fewer than two samples", () => {
  const page = open();
  page.receive(dataMessage([], { trend: [0, 50, 100] }));
  assert.equal(page.one("#spark polyline").getAttribute("points"), "0.00,34.00 50.00,18.00 100.00,2.00");
  page.receive(dataMessage([], { trend: [40] }));
  assert.equal(page.byId("spark").innerHTML, "");
});
