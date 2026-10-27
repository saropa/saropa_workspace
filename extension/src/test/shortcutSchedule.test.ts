// The system events a shortcut can be triggered by are a fixed, ordered set shared by
// the editor pickers and the workflow graph.

import { test } from "node:test";
import assert from "node:assert/strict";
import { SYSTEM_EVENTS } from "../model/shortcutSchedule";

test("system events are the four known events, in display order", () => {
  assert.deepEqual([...SYSTEM_EVENTS], ["build", "publish", "gitCommit", "gitPush"]);
});

test("system event names are unique", () => {
  assert.equal(new Set(SYSTEM_EVENTS).size, SYSTEM_EVENTS.length);
});
