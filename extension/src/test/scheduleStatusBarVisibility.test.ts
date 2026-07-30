import { test } from "node:test";
import assert from "node:assert/strict";
import {
  shouldShowIndicator,
  isJustRan,
  DEFAULT_LEAD_MINUTES,
  JUST_RAN_WINDOW_MS,
} from "../views/scheduleStatusBar";

const NOW = Date.parse("2026-07-29T08:00:00");
const DEFAULT_WINDOW_MS = DEFAULT_LEAD_MINUTES * 60_000;

// --- shouldShowIndicator (with configurable window) ---

test("visible when next run is exactly now", () => {
  assert.equal(shouldShowIndicator(NOW, NOW, DEFAULT_WINDOW_MS), true);
});

test("visible when next run is 1 minute away", () => {
  assert.equal(shouldShowIndicator(NOW + 60_000, NOW, DEFAULT_WINDOW_MS), true);
});

test("visible at exactly 30 minutes away (default window)", () => {
  assert.equal(shouldShowIndicator(NOW + DEFAULT_WINDOW_MS, NOW, DEFAULT_WINDOW_MS), true);
});

test("hidden when next run is 30 minutes and 1 ms away", () => {
  assert.equal(shouldShowIndicator(NOW + DEFAULT_WINDOW_MS + 1, NOW, DEFAULT_WINDOW_MS), false);
});

test("hidden when next run is hours away", () => {
  assert.equal(shouldShowIndicator(NOW + 3 * 60 * 60_000, NOW, DEFAULT_WINDOW_MS), false);
});

test("visible when next run is in the past (overdue)", () => {
  assert.equal(shouldShowIndicator(NOW - 60_000, NOW, DEFAULT_WINDOW_MS), true);
});

test("custom window: 10-minute lead shows a run 9 min away", () => {
  const tenMinMs = 10 * 60_000;
  assert.equal(shouldShowIndicator(NOW + 9 * 60_000, NOW, tenMinMs), true);
});

test("custom window: 10-minute lead hides a run 11 min away", () => {
  const tenMinMs = 10 * 60_000;
  assert.equal(shouldShowIndicator(NOW + 11 * 60_000, NOW, tenMinMs), false);
});

test("zero window only shows runs at or past their time", () => {
  assert.equal(shouldShowIndicator(NOW, NOW, 0), true);
  assert.equal(shouldShowIndicator(NOW - 1, NOW, 0), true);
  assert.equal(shouldShowIndicator(NOW + 1, NOW, 0), false);
});

// --- isJustRan ---

test("just ran: lastRun 1 second ago", () => {
  assert.equal(isJustRan(NOW - 1_000, NOW), true);
});

test("just ran: lastRun exactly at the window boundary", () => {
  assert.equal(isJustRan(NOW - JUST_RAN_WINDOW_MS, NOW), true);
});

test("not just ran: lastRun 1 ms past the window", () => {
  assert.equal(isJustRan(NOW - JUST_RAN_WINDOW_MS - 1, NOW), false);
});

test("not just ran: no lastRun", () => {
  assert.equal(isJustRan(undefined, NOW), false);
});

test("not just ran: lastRun is in the future (clock skew)", () => {
  assert.equal(isJustRan(NOW + 60_000, NOW), true);
});
