// Unit tests for the row-state precedence picker.

import { test } from "node:test";
import assert from "node:assert/strict";
import { pickHighestPriorityRowState, ROW_STATE_PRIORITY } from "../views/shortcutRowStatePriority";

test("priority order is stopping, running, locked, paused", () => {
  assert.deepEqual([...ROW_STATE_PRIORITY], ["stopping", "running", "locked", "paused"]);
});

test("returns the value of the highest-priority state present", () => {
  assert.equal(pickHighestPriorityRowState({ paused: "P", locked: "L" }), "L");
  assert.equal(pickHighestPriorityRowState({ paused: "P", running: "R", locked: "L" }), "R");
  assert.equal(pickHighestPriorityRowState({ stopping: "S", running: "R" }), "S");
});

test("returns undefined when no state is set", () => {
  assert.equal(pickHighestPriorityRowState({}), undefined);
  assert.equal(pickHighestPriorityRowState({ running: undefined }), undefined);
});

test("an empty string is a set value and still wins", () => {
  assert.equal(pickHighestPriorityRowState({ running: "", paused: "P" }), "");
});
