// Unit tests for the tree-row contextValue that drives menu `when` clauses.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildShortcutContextValue } from "../views/shortcutRowContext";
import { RECOMMENDED_GROUP_ID } from "../model/shortcutStoreShared";
import type { Shortcut } from "../model/shortcut";

const base = { id: "a", path: "a.sh", scope: "project" } as Shortcut;
const sched = { enabled: true, kind: "daily", atTime: "09:00" } as unknown as Shortcut["schedule"];

test("a plain shortcut is `shortcut`, paused adds a suffix", () => {
  assert.equal(buildShortcutContextValue(base, false, false), "shortcut");
  assert.equal(buildShortcutContextValue({ ...base, paused: true }, false, false), "shortcutPaused");
});

test("a scheduled shortcut is `shortcutScheduled`, with the paused suffix", () => {
  assert.equal(buildShortcutContextValue({ ...base, schedule: sched }, false, false), "shortcutScheduled");
  assert.equal(
    buildShortcutContextValue({ ...base, schedule: sched, paused: true }, false, false),
    "shortcutScheduledPaused"
  );
});

test("auto shortcuts are shortcutAuto regardless of paused", () => {
  assert.equal(buildShortcutContextValue({ ...base, isAuto: true, paused: true }, false, false), "shortcutAuto");
});

test("recipes distinguish plain, scheduled and recommended-scheduled", () => {
  const recipe = { ...base, isRecipe: true };
  assert.equal(buildShortcutContextValue(recipe, false, false), "shortcutRecipe");
  assert.equal(buildShortcutContextValue({ ...recipe, schedule: sched }, false, false), "shortcutRecipeScheduled");
  assert.equal(
    buildShortcutContextValue({ ...recipe, schedule: sched, groupId: RECOMMENDED_GROUP_ID }, false, false),
    "shortcutRecommendScheduled"
  );
  // The shelf only changes the value for a SCHEDULED recipe.
  assert.equal(
    buildShortcutContextValue({ ...recipe, groupId: RECOMMENDED_GROUP_ID }, false, false),
    "shortcutRecipe"
  );
});

test("running beats everything but stopping", () => {
  assert.equal(buildShortcutContextValue({ ...base, isRecipe: true }, true, false), "shortcutRunning");
  assert.equal(buildShortcutContextValue(base, true, true), "shortcutStopping");
  assert.equal(buildShortcutContextValue(base, false, true), "shortcutStopping");
});
