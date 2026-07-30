import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldShowIndicator, VISIBILITY_WINDOW_MS } from "../views/scheduleStatusBar";

const NOW = Date.parse("2026-07-29T08:00:00");

test("visible when next run is exactly now", () => {
  assert.equal(shouldShowIndicator(NOW, NOW), true);
});

test("visible when next run is 1 minute away", () => {
  assert.equal(shouldShowIndicator(NOW + 60_000, NOW), true);
});

test("visible at exactly 30 minutes away", () => {
  assert.equal(shouldShowIndicator(NOW + VISIBILITY_WINDOW_MS, NOW), true);
});

test("hidden when next run is 30 minutes and 1 ms away", () => {
  assert.equal(shouldShowIndicator(NOW + VISIBILITY_WINDOW_MS + 1, NOW), false);
});

test("hidden when next run is hours away", () => {
  assert.equal(shouldShowIndicator(NOW + 3 * 60 * 60_000, NOW), false);
});

test("visible when next run is in the past (overdue)", () => {
  assert.equal(shouldShowIndicator(NOW - 60_000, NOW), true);
});
