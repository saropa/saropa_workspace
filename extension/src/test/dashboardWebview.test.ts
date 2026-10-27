// Behavior tests for the Dashboard webview: the real shell and script run together in the
// fake DOM, driven by host messages and clicks.

import { test } from "node:test";
import assert from "node:assert/strict";
import { renderShell, type DashboardTab } from "../views/dashboardShell";
import { runPage, type Page } from "./_stub/fakeDom";

const EVIL = '<img src=x onerror="alert(1)">&"\'';

function open(tab: DashboardTab = "processes", computedStyle: Record<string, string> = {}): Page {
  return runPage(renderShell(tab), { computedStyle });
}
const strings = (page: Page): Record<string, string> => page.evalJson("STRINGS") as Record<string, string>;

function proc(pid: number, name: string, cpu: number, rss: number): object {
  return { pid, name, cpuPercent: cpu, rssBytes: rss };
}
function group(tool: string, cpu: number, rss: number, procs: object[]): object {
  return { tool, cpuPercent: cpu, rssBytes: rss, pidCount: procs.length, procs };
}
function dataMessage(groups: object[], extra: object = {}): object {
  return {
    type: "data",
    result: { cores: 8, totalRamBytes: 16 * 1024 ** 3, freeRamBytes: 6 * 1024 ** 3, sampledAt: 1_700_000_000_000, groups },
    trend: [],
    killable: {},
    ...extra,
  };
}
const groupNames = (page: Page): string[] => page.all(".group-name").map((e) => e.children.length ? e.childNodes[0].textContent : e.textContent);

test("loading asks the host for the initial tab and marks only that tab active", () => {
  const page = open("analytics");
  assert.deepEqual(page.takePosted(), [{ type: "activateTab", tab: "analytics" }]);
  assert.deepEqual(page.all(".tab.active").map((b) => b.dataset.tab), ["analytics"]);
  assert.deepEqual(page.all(".tab-panel").filter((p) => !p.classList.contains("hidden")).map((p) => p.id), ["tab-analytics"]);
});

test("clicking a tab shows its panel and asks the host for that tab's data", () => {
  const page = open();
  page.takePosted();
  page.click(page.one('.tab[data-tab="trends"]'));
  assert.deepEqual(page.takePosted(), [{ type: "activateTab", tab: "trends" }]);
  assert.deepEqual(page.all(".tab.active").map((b) => b.dataset.tab), ["trends"]);
  assert.equal(page.byId("tab-trends").classList.contains("hidden"), false);
  assert.equal(page.byId("tab-processes").classList.contains("hidden"), true);
});

test("a selectTab message from the host switches tabs the same way", () => {
  const page = open();
  page.takePosted();
  page.receive({ type: "selectTab", tab: "analytics" });
  assert.deepEqual(page.takePosted(), [{ type: "activateTab", tab: "analytics" }]);
  assert.equal(page.byId("tab-analytics").classList.contains("hidden"), false);
});

test("the refresh and copy buttons post their messages", () => {
  const page = open();
  page.takePosted();
  page.click(page.byId("refresh"));
  page.click(page.byId("copy"));
  assert.deepEqual(page.takePosted(), [{ type: "refresh" }, { type: "copy" }]);
});

test("a sampling message shows the sampling text and a data message clears it", () => {
  const page = open();
  page.receive({ type: "sampling" });
  assert.equal(page.byId("status").textContent, strings(page).sampling);
  page.receive(dataMessage([]));
  assert.equal(page.byId("status").textContent, "");
});

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

test("the analytics tab is blank until data arrives, then lists totals, rankings, session and recent runs", () => {
  const page = open("analytics");
  assert.equal(page.byId("analytics").innerHTML, "");
  page.receive({
    type: "analytics",
    totals: { shortcuts: "12 shortcuts", runs: "340 runs" },
    mostRun: [{ name: "build", sub: "90 runs" }],
    session: [{ name: "test", detail: "ok 3x", ok: true }, { name: "lint", detail: "failed", ok: false }],
    recent: [{ name: "build", ago: "2 min ago", tag: "ci" }, { name: "docs", ago: "1 h ago" }],
  });
  const box = page.byId("analytics");
  const s = strings(page);
  assert.deepEqual(box.querySelectorAll("h2").map((h) => h.textContent), [s.analyticsHeading, s.mostRunHeading, s.sessionHeading, s.recentHeading]);
  assert.deepEqual(box.querySelectorAll("ol.rank li").map((li) => li.textContent), ["build — 90 runs"]);
  assert.deepEqual(box.querySelectorAll(".meta").map((m) => m.className + ":" + m.textContent), ["meta ok:ok 3x", "meta fail:failed", "meta:2 min ago ci", "meta:1 h ago"]);
  assert.equal(box.querySelectorAll(".tag").length, 1);
});

test("the analytics open-markdown link posts its message", () => {
  const page = open("analytics");
  page.receive({ type: "analytics", totals: { shortcuts: "a", runs: "b" } });
  page.takePosted();
  page.click(page.byId("openMd"));
  assert.deepEqual(page.takePosted(), [{ type: "openAnalyticsMarkdown" }]);
});

test("analytics shows a disabled or empty notice instead of the lists, escaped", () => {
  const page = open("analytics");
  page.receive({ type: "analytics", enabled: false, message: EVIL });
  assert.equal(page.one("#analytics .empty").textContent, EVIL);
  assert.equal(page.all("img").length, 0);
  page.receive({ type: "analytics", empty: "Nothing yet" });
  assert.equal(page.one("#analytics .empty").textContent, "Nothing yet");
  assert.equal(page.all("#analytics h2").length, 0);
});

test("analytics text from the host is escaped everywhere it is written", () => {
  const page = open("analytics");
  page.receive({
    type: "analytics",
    totals: { shortcuts: EVIL, runs: EVIL },
    mostRun: [{ name: EVIL, sub: EVIL }],
    session: [{ name: EVIL, detail: EVIL, ok: true }],
    recent: [{ name: EVIL, ago: EVIL, tag: EVIL }],
  });
  assert.equal(page.all("#analytics img").length, 0);
  assert.equal(page.one(".rank li").textContent, `${EVIL} — ${EVIL}`);
  assert.equal(page.one(".tag").textContent, EVIL);
});

const CPU = { tools: [{ tool: "node", points: [0, 10] }, { tool: "dart", points: [5] }] };

test("the trends tab draws a legend and a chart with the exact line geometry", () => {
  const page = open("trends", { "--vscode-charts-blue": "#0000ff", "--vscode-panel-border": "#333333" });
  page.receive({ type: "trends", cpu: CPU, debt: { counts: [] }, reports: [] });
  assert.deepEqual(page.all(".legend > span").map((s) => s.textContent), ["node", "dart"]);
  const canvas = page.byId("cpuChart");
  assert.deepEqual([canvas.width, canvas.height], [320, 120]);
  const ctx = canvas.getContext("2d");
  assert.deepEqual(ctx.calls.filter((c) => c.op === "moveTo" || c.op === "lineTo"), [
    { op: "moveTo", args: [6, 112] },
    { op: "lineTo", args: [314, 112] },
    { op: "moveTo", args: [6, 112] },
    { op: "lineTo", args: [314, 8] },
  ]);
  assert.deepEqual(ctx.assigned.filter((a) => a.prop === "strokeStyle").map((a) => a.value), ["#333333", "#0000ff"]);
});

test("the chart is scaled by the device pixel ratio", () => {
  const page = open("trends");
  page.window.devicePixelRatio = 2;
  page.receive({ type: "trends", cpu: CPU, debt: { counts: [] }, reports: [] });
  const canvas = page.byId("cpuChart");
  assert.deepEqual([canvas.width, canvas.height], [640, 240]);
  assert.deepEqual(canvas.getContext("2d").calls.find((c) => c.op === "setTransform")?.args, [2, 0, 0, 2, 0, 0]);
});

test("without two points per series the trends tab shows the no-data notes and draws nothing", () => {
  const page = open("trends");
  page.receive({ type: "trends", cpu: { tools: [{ tool: "node", points: [3] }] }, debt: { counts: [4] }, reports: [] });
  const s = strings(page);
  assert.equal(page.all("canvas").length, 0);
  assert.deepEqual(page.all("#trends .note").map((n) => n.textContent), [s.trendsNoCpu, s.trendsNoDebt, s.trendsNoReports]);
});

test("the debt chart shows the latest count and an orange line", () => {
  const page = open("trends", { "--vscode-charts-orange": "#ff8800" });
  page.receive({ type: "trends", cpu: { tools: [] }, debt: { counts: [9, 7, 12] }, reports: [] });
  const ctx = page.byId("debtChart").getContext("2d");
  assert.ok(ctx.assigned.some((a) => a.prop === "strokeStyle" && a.value === "#ff8800"));
  assert.equal(page.all("#trends .note").some((n) => n.textContent === strings(page).debtLatest.split("{count}").join("12")), true);
});

test("report links post the path they were built from, even with quotes in it", () => {
  const page = open("trends");
  const path = 'C:\\reports\\"a" & <b>.md';
  page.receive({ type: "trends", cpu: { tools: [] }, debt: { counts: [] }, reports: [{ label: "Lint", count: "2", files: [{ name: EVIL, path, ago: "1 d" }] }] });
  assert.equal(page.one(".cat-head").textContent, "Lint2");
  assert.equal(page.one(".report-link").textContent, EVIL);
  assert.equal(page.all("#trends img").length, 0);
  page.takePosted();
  page.click(page.one(".report-link"));
  assert.deepEqual(page.takePosted(), [{ type: "openReport", path }]);
});

test("a resize redraws the trends tab after a short pause, but only while it is the active tab", () => {
  const page = open("trends");
  page.receive({ type: "trends", cpu: CPU, debt: { counts: [] }, reports: [] });
  const first = page.byId("cpuChart");
  page.fire(page.window, "resize");
  page.timers.advance(149);
  assert.equal(page.byId("cpuChart"), first);
  page.timers.advance(1);
  assert.notEqual(page.byId("cpuChart"), first);
  page.click(page.one('.tab[data-tab="processes"]'));
  const second = page.byId("cpuChart");
  page.fire(page.window, "resize");
  page.timers.runAll();
  assert.equal(page.byId("cpuChart"), second);
});

test("repeated resizes inside the pause collapse into one redraw", () => {
  const page = open("trends");
  page.receive({ type: "trends", cpu: CPU, debt: { counts: [] }, reports: [] });
  page.fire(page.window, "resize");
  page.timers.advance(100);
  page.fire(page.window, "resize");
  assert.equal(page.timers.pending, 1);
});
