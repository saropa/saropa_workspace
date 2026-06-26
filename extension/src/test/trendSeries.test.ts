// Unit tests for parseTrendSeries — the pure CSV-to-series transform behind the
// dashboard's Trends tab. Split out from the file IO in heartbeat.ts so it runs
// under node --test without the extension host (the project's pure-helper test
// convention); the bare "vscode" import heartbeat.ts carries is aliased to the test
// stub by the bundler, and this function itself touches no host API.

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTrendSeries } from "../exec/heartbeat";

const HEADER = "timestamp,tool,cpuPercent,rssBytes,pidCount";

test("parseTrendSeries: empty / header-only input yields empty series", () => {
  assert.deepEqual(parseTrendSeries("", 10), { labels: [], tools: [] });
  assert.deepEqual(parseTrendSeries(HEADER + "\n", 10), { labels: [], tools: [] });
});

test("parseTrendSeries: groups one tool across samples in chronological order", () => {
  const csv = [
    HEADER,
    "2026-06-25T05:00:00.000Z,dart,12.5,1000,3",
    "2026-06-25T05:15:00.000Z,dart,40.0,2000,4",
  ].join("\n");
  const series = parseTrendSeries(csv, 10);
  assert.deepEqual(series.labels, [
    "2026-06-25T05:00:00.000Z",
    "2026-06-25T05:15:00.000Z",
  ]);
  assert.equal(series.tools.length, 1);
  assert.equal(series.tools[0].tool, "dart");
  assert.deepEqual(series.tools[0].points, [12.5, 40.0]);
});

test("parseTrendSeries: a tool absent in a sample is filled with 0, sharing the x-axis", () => {
  // node appears only in the second sample; its first point must be 0 so every
  // series aligns to the same labels.
  const csv = [
    HEADER,
    "t1,dart,10,1000,2",
    "t2,dart,20,1000,2",
    "t2,node,30,500,1",
  ].join("\n");
  const series = parseTrendSeries(csv, 10);
  assert.deepEqual(series.labels, ["t1", "t2"]);
  const dart = series.tools.find((s) => s.tool === "dart");
  const node = series.tools.find((s) => s.tool === "node");
  assert.deepEqual(dart?.points, [10, 20]);
  assert.deepEqual(node?.points, [0, 30]);
});

test("parseTrendSeries: keeps only the last `count` samples", () => {
  const rows = [HEADER];
  for (let i = 0; i < 5; i++) {
    rows.push(`t${i},dart,${i},1000,1`);
  }
  const series = parseTrendSeries(rows.join("\n"), 2);
  assert.deepEqual(series.labels, ["t3", "t4"]);
  assert.deepEqual(series.tools[0].points, [3, 4]);
});

test("parseTrendSeries: a quoted tool name containing a comma stays intact", () => {
  // csvField quotes a name with a comma; the trailing three numeric columns still
  // parse, and the surrounding quotes are stripped from the tool label.
  const csv = [HEADER, 't1,"a,b",15,1000,2'].join("\n");
  const series = parseTrendSeries(csv, 10);
  assert.equal(series.tools.length, 1);
  assert.equal(series.tools[0].tool, "a,b");
  assert.deepEqual(series.tools[0].points, [15]);
});

test("parseTrendSeries: malformed and non-numeric rows are skipped, not fatal", () => {
  const csv = [
    HEADER,
    "t1,dart,10,1000,2",
    "short,row", // too few columns
    "t2,dart,NaNish,1000,2", // non-numeric cpu
    "t3,dart,25,1000,2",
  ].join("\n");
  const series = parseTrendSeries(csv, 10);
  assert.deepEqual(series.labels, ["t1", "t3"]);
  assert.deepEqual(series.tools[0].points, [10, 25]);
});
