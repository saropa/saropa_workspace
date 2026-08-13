// Unit test for the repeat-invocation guard in shortcutExecution.ts: a defense-in-depth
// backstop that drops a repeat invocation of the SAME shortcut id landing within a short
// window of the first (see STYLEGUIDE.md §4.1z for why this is silent by design). Only
// isRepeatInvocation is host-independent — the rest of runShortcutCommand needs the
// extension host (store, terminals, toasts) and is exercised manually.

import { test } from "node:test";
import assert from "node:assert/strict";
import { isRepeatInvocation, REPEAT_INVOCATION_GUARD_MS } from "../commands/shortcutExecution";

test("isRepeatInvocation: the first invocation of a shortcut is never a repeat", () => {
  const id = `first-${Date.now()}-${Math.random()}`;
  assert.equal(isRepeatInvocation(id, 1000), false);
});

test("isRepeatInvocation: a second invocation inside the guard window is a repeat", () => {
  const id = `inside-${Date.now()}-${Math.random()}`;
  assert.equal(isRepeatInvocation(id, 1000), false);
  assert.equal(isRepeatInvocation(id, 1000 + REPEAT_INVOCATION_GUARD_MS - 1), true);
});

test("isRepeatInvocation: an invocation at/after the guard window is NOT a repeat", () => {
  const id = `after-${Date.now()}-${Math.random()}`;
  assert.equal(isRepeatInvocation(id, 1000), false);
  assert.equal(
    isRepeatInvocation(id, 1000 + REPEAT_INVOCATION_GUARD_MS),
    false,
    "the window boundary itself must not count as a repeat"
  );
});

test("isRepeatInvocation: tracking is per-shortcut-id, not global", () => {
  const idA = `a-${Date.now()}-${Math.random()}`;
  const idB = `b-${Date.now()}-${Math.random()}`;
  assert.equal(isRepeatInvocation(idA, 2000), false);
  // A different shortcut firing immediately after must not be blocked by A's run.
  assert.equal(isRepeatInvocation(idB, 2000), false);
});
