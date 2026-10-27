// Tests for the Dashboard webview's Trends tab: charts, legend and report links.

import { test } from "node:test";
import assert from "node:assert/strict";
import { EVIL, open, strings, CPU } from "./dashboardWebviewFixture";

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
