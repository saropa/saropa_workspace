// Unit tests for the in-memory last-report hand-off between report writers and
// the scheduler.

import { test } from "node:test";
import assert from "node:assert/strict";
import { recordLastReport, takeLastReport, peekLastReport, clearLastReport } from "../exec/lastReport";

test("takeLastReport returns the recorded path and clears it", () => {
  recordLastReport("t1", "/r/a.md");
  assert.equal(takeLastReport("t1"), "/r/a.md");
  assert.equal(takeLastReport("t1"), undefined);
});

test("peekLastReport reads without clearing", () => {
  recordLastReport("t2", "/r/b.md");
  assert.equal(peekLastReport("t2"), "/r/b.md");
  assert.equal(peekLastReport("t2"), "/r/b.md");
  assert.equal(takeLastReport("t2"), "/r/b.md");
});

test("a later record overwrites the earlier one for the same shortcut", () => {
  recordLastReport("t3", "/r/old.md");
  recordLastReport("t3", "/r/new.md");
  assert.equal(takeLastReport("t3"), "/r/new.md");
});

test("clearLastReport drops a stale entry so a no-report run links nothing", () => {
  recordLastReport("t4", "/r/stale.md");
  clearLastReport("t4");
  assert.equal(peekLastReport("t4"), undefined);
});

test("entries are keyed per shortcut", () => {
  recordLastReport("t5", "/r/5.md");
  recordLastReport("t6", "/r/6.md");
  assert.equal(takeLastReport("t5"), "/r/5.md");
  assert.equal(peekLastReport("t6"), "/r/6.md");
  clearLastReport("t6");
});

test("an unknown shortcut yields undefined and clearing it is harmless", () => {
  assert.equal(takeLastReport("never"), undefined);
  clearLastReport("never");
});
