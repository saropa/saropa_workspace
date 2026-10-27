// Sidebar host side: which welcome state the section shows.

import { test } from "node:test";
import assert from "node:assert/strict";
import { sidebarState } from "../../views/boardSidebar";

const base = { on: true, found: false, failed: false, firstScanDone: true, scanning: false };

test("documents found show the rows", () => {
  assert.equal(sidebarState({ ...base, found: true }), "ready");
});

test("the board off, or no folder, is empty even if a scan failed", () => {
  assert.equal(sidebarState({ ...base, on: false }), "empty");
  assert.equal(sidebarState({ ...base, on: false, failed: true, scanning: true }), "empty");
});

test("a failed scan with no board shows the failure", () => {
  assert.equal(sidebarState({ ...base, failed: true }), "failed");
});

test("before the first scan ends, and while one runs, the section is loading", () => {
  assert.equal(sidebarState({ ...base, firstScanDone: false }), "loading");
  assert.equal(sidebarState({ ...base, scanning: true }), "loading");
});

test("a finished scan that found nothing is empty", () => {
  assert.equal(sidebarState(base), "empty");
});
