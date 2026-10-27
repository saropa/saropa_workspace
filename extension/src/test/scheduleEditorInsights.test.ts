// Unit tests for the schedule editor's neighbor / conflict / free-gap insights.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildInsights } from "../views/scheduleEditorInsights";
import type { ShortcutStore } from "../model/shortcutStore";
import type { Shortcut } from "../model/shortcut";

function pin(id: string, atTime: string | undefined, extra: Record<string, unknown> = {}): Shortcut {
  return {
    id,
    path: id,
    label: id,
    scope: "project",
    schedule: { enabled: true, atTime, ...extra },
  } as unknown as Shortcut;
}

function store(project: Shortcut[], global: Shortcut[] = []): ShortcutStore {
  return { getProjectShortcuts: () => project, getGlobalShortcuts: () => global } as unknown as ShortcutStore;
}

test("no time and no neighbors shows the empty hint", () => {
  const r = buildInsights(store([]), "me", { enabled: true });
  assert.equal(r.mine, null);
  assert.equal(r.neighbors.length, 0);
  assert.equal(r.conflict, "");
  assert.equal(r.gapFrom, null);
  assert.match(r.note, /Set a daily time/);
});

test("a time with no neighbors says it runs alone", () => {
  const r = buildInsights(store([]), "me", { enabled: true, atTime: "09:30" });
  assert.equal(r.mine, 570);
  assert.match(r.note, /No other shortcuts/);
});

test("neighbors exclude self, disabled, and untimed schedules", () => {
  const disabled = pin("off", "10:00", { enabled: false });
  const r = buildInsights(
    store([pin("me", "08:00"), disabled, pin("none", undefined), pin("bad", "xx:yy"), pin("ok", "10:00")], [pin("g", "12:00")]),
    "me",
    { enabled: true, atTime: "09:00" }
  );
  assert.deepEqual(r.neighbors, [{ n: "ok", m: 600 }, { n: "g", m: 720 }]);
});

test("same minute on overlapping days is a conflict naming the clashing shortcuts", () => {
  const r = buildInsights(store([pin("a", "09:00"), pin("b", "09:00"), pin("c", "10:00")]), "me", {
    enabled: true,
    atTime: "09:00",
  });
  assert.match(r.conflict, /09:00/);
  assert.match(r.conflict, /a, b/);
  assert.ok(!r.conflict.includes("c"));
});

test("same minute on disjoint weekdays is not a conflict", () => {
  const r = buildInsights(store([pin("a", "09:00", { days: [1, 2] })]), "me", {
    enabled: true,
    atTime: "09:00",
    days: [5, 6],
  });
  assert.equal(r.conflict, "");
});

test("more than three clashing names are abbreviated", () => {
  const many = ["a", "b", "c", "d", "e"].map((id) => pin(id, "09:00"));
  const r = buildInsights(store(many), "me", { enabled: true, atTime: "09:00" });
  assert.match(r.conflict, /a, b, c \+2 more/);
});

test("the largest free gap is reported, wrapping past midnight", () => {
  // Times 08:00 (mine), 09:00, 10:00 -> biggest span is 10:00 -> 08:00 next day (22h).
  const r = buildInsights(store([pin("a", "09:00"), pin("b", "10:00")]), "me", { enabled: true, atTime: "08:00" });
  assert.equal(r.gapFrom, 600);
  assert.equal(r.gapTo, 480);
  assert.match(r.note, /10:00 to 08:00 \(22h\)/);
});

test("gap spans format minutes when not a whole hour", () => {
  const r = buildInsights(store([pin("a", "09:00")]), "me", { enabled: true, atTime: "09:45" });
  // 09:00 -> 09:45 is 45m but the wrap 09:45 -> 09:00 is 23h15m and wins.
  assert.match(r.note, /\(23h 15m\)/);
});

test("a single distinct time gives no gap note", () => {
  const r = buildInsights(store([pin("a", "09:00")]), "me", { enabled: true, atTime: "09:00" });
  assert.equal(r.note, "");
  assert.equal(r.gapFrom, null);
});
