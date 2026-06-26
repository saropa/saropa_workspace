// Toolchain heartbeat (recipe book #61) trend parsing. The file IO and the timer-
// driven sampler need the extension host, but the CSV-to-series transform that the
// Trends tab draws from is split out as the pure parseTrendSeries — exactly so it is
// unit-testable here. These cases drive its grouping, ordering, last-`count`
// windowing, zero-fill alignment, malformed-row tolerance, and the quoted-tool-name
// (embedded comma) path, with no host involved.

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTrendSeries } from "../exec/heartbeat";

// The header line the heartbeat writes; parseTrendSeries must skip it. Real rows are
// "timestamp,tool,cpuPercent,rssBytes,pidCount".
const HEADER = "timestamp,tool,cpuPercent,rssBytes,pidCount";

test("an absent/empty CSV yields empty labels and tools", () => {
  const series = parseTrendSeries("", 10);
  assert.deepEqual(series.labels, []);
  assert.deepEqual(series.tools, []);
});

test("a header-only CSV yields no series (the header row is skipped)", () => {
  const series = parseTrendSeries(HEADER + "\n", 10);
  assert.deepEqual(series.labels, []);
  assert.deepEqual(series.tools, []);
});

test("rows group by (timestamp, tool) and labels keep first-seen chronological order", () => {
  // Two samples, two tools each. cpuPercent is column index 2.
  const csv = [
    HEADER,
    "t1,node,10.0,1000,2",
    "t1,code,5.0,2000,8",
    "t2,node,20.0,1100,2",
    "t2,code,6.0,2100,8",
  ].join("\n");

  const series = parseTrendSeries(csv, 10);

  assert.deepEqual(series.labels, ["t1", "t2"], "labels are the samples oldest-first");
  const node = series.tools.find((t) => t.tool === "node");
  const code = series.tools.find((t) => t.tool === "code");
  assert.deepEqual(node?.points, [10, 20], "node's CPU aligns to the two samples");
  assert.deepEqual(code?.points, [5, 6], "code's CPU aligns to the two samples");
});

test("a tool absent from a sample is zero-filled so every series shares the x-axis", () => {
  // node appears in both samples; code only in the second. code's first point is 0.
  const csv = [
    HEADER,
    "t1,node,10.0,1000,2",
    "t2,node,20.0,1100,2",
    "t2,code,6.0,2100,8",
  ].join("\n");

  const series = parseTrendSeries(csv, 10);

  assert.deepEqual(series.labels, ["t1", "t2"]);
  const code = series.tools.find((t) => t.tool === "code");
  assert.deepEqual(
    code?.points,
    [0, 6],
    "the sample where code was absent is filled with 0, not dropped"
  );
});

test("only the last `count` samples are kept, oldest of those first", () => {
  const csv = [
    HEADER,
    "t1,node,1.0,1,1",
    "t2,node,2.0,1,1",
    "t3,node,3.0,1,1",
    "t4,node,4.0,1,1",
  ].join("\n");

  // Window of 2 keeps the two most-recent samples (t3, t4), in chronological order.
  const series = parseTrendSeries(csv, 2);

  assert.deepEqual(series.labels, ["t3", "t4"]);
  const node = series.tools.find((t) => t.tool === "node");
  assert.deepEqual(node?.points, [3, 4]);
});

test("malformed rows (too few columns, non-numeric CPU) are skipped, not fatal", () => {
  const csv = [
    HEADER,
    "t1,node,10.0,1000,2",
    "garbage", // too few columns
    "t1,broken,notanumber,1000,2", // non-finite cpu
    "t2,node,20.0,1100,2",
  ].join("\n");

  const series = parseTrendSeries(csv, 10);

  assert.deepEqual(series.labels, ["t1", "t2"], "only the well-formed samples survive");
  assert.ok(
    !series.tools.some((t) => t.tool === "broken"),
    "a row with a non-numeric CPU contributes no series"
  );
  const node = series.tools.find((t) => t.tool === "node");
  assert.deepEqual(node?.points, [10, 20]);
});

test("a quoted tool name containing a comma is rejoined intact", () => {
  // The writer quotes a tool name that contains a comma; the trailing three numeric
  // columns are still rss/pid plus cpu, so the tool is everything between.
  const csv = [HEADER, 't1,"a,b",12.0,1000,2'].join("\n");

  const series = parseTrendSeries(csv, 10);

  assert.equal(series.tools.length, 1);
  assert.equal(series.tools[0].tool, "a,b", "the embedded comma stays in the tool name");
  assert.deepEqual(series.tools[0].points, [12]);
});
