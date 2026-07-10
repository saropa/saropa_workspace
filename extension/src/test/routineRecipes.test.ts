// Unit tests for composite-recipe ("routine") detection. detectRoutineRecipes is a
// PURE function: it is handed the recipes the other detectors already produced and
// proposes a Morning routine only when two or more of its morning members are
// actually present. No vscode at all, so it runs as plain Node under the built-in
// runner with the vscode stub. The assertions cover the minimum-members gate, the
// run-order/membership it pre-populates from what exists, and the disabled schedule.

import { test } from "node:test";
import assert from "node:assert/strict";
import { detectRoutineRecipes } from "../recipes/routineRecipes";
import type { RecipeResult } from "../recipes/detectors";

// A bare RecipeResult carrying only the id — that is all the routine detector reads
// (it keys membership on recipeId presence, not the rest of the recipe).
const recipe = (recipeId: string): RecipeResult => ({ recipeId, label: recipeId });

test("no routine is offered with fewer than two morning members", () => {
  // A single morning member is below MIN_MEMBERS, so the routine would be a
  // one-member sequence — pointless — and is suppressed.
  assert.deepEqual(detectRoutineRecipes([recipe("ritual.lint")]), []);
  // No morning members at all (only unrelated recipes) also yields nothing.
  assert.deepEqual(
    detectRoutineRecipes([recipe("dev"), recipe("test")]),
    []
  );
});

test("a Morning routine is offered once two morning members are present", () => {
  const out = detectRoutineRecipes([recipe("ritual.lint"), recipe("ritual.stats")]);
  assert.equal(out.length, 1);
  assert.equal(out[0].recipeId, "routine.morning");
  assert.equal(out[0].action?.kind, "routine");
  assert.equal(out[0].action?.members?.length, 2);
});

test("members are pre-populated in the fixed run order, hygiene first", () => {
  // The detected set is given out of order; the routine must restore the morning
  // cadence — bloat/hygiene runs first so a frozen-tree project is caught before the
  // heavier members.
  const out = detectRoutineRecipes([
    recipe("ritual.prs"),
    recipe("hygiene.bloat"),
    recipe("ritual.lint"),
  ]);
  const memberIds = out[0].action?.members?.map((m) => m.recipeId);
  assert.deepEqual(memberIds, ["hygiene.bloat", "ritual.lint", "ritual.prs"]);
});

test("the code-health and dependency members sit in morning order", () => {
  // The TODO/tech-debt harvest and pubspec freshness are morning members (report bug
  // items 4 and 5): debt runs right after the lint sweep, deps after project stats,
  // and all resolve into the fixed cadence regardless of detection order.
  const out = detectRoutineRecipes([
    recipe("ritual.deps"),
    recipe("ritual.prs"),
    recipe("ritual.debt"),
    recipe("hygiene.bloat"),
    recipe("ritual.stats"),
    recipe("ritual.lint"),
    recipe("ritual.standup"),
  ]);
  const memberIds = out[0].action?.members?.map((m) => m.recipeId);
  assert.deepEqual(memberIds, [
    "hygiene.bloat",
    "ritual.lint",
    "ritual.debt",
    "ritual.stats",
    "ritual.deps",
    "ritual.standup",
    "ritual.prs",
  ]);
});

test("only the present members are included; absent ones are skipped", () => {
  // ritual.standup is not in the detected set, so it must not appear as a member,
  // even though it sits between two members in the canonical order.
  const out = detectRoutineRecipes([recipe("ritual.lint"), recipe("ritual.prs")]);
  const memberIds = out[0].action?.members?.map((m) => m.recipeId);
  assert.deepEqual(memberIds, ["ritual.lint", "ritual.prs"]);
});

test("the routine is Scheduled at 08:00 and seeds DISABLED", () => {
  const out = detectRoutineRecipes([recipe("ritual.lint"), recipe("ritual.stats")]);
  assert.equal(out[0].group, "scheduled");
  // Like every scheduled recipe, the routine never runs on its own until promoted.
  assert.equal(out[0].schedule?.enabled, false);
  assert.equal(out[0].schedule?.atTime, "08:00");
});

test("the description names the actual members so the row explains itself", () => {
  // The catalog prose is built from the resolved member labels, not a static blurb,
  // so the user reads exactly what this routine will run.
  const out = detectRoutineRecipes([recipe("ritual.lint"), recipe("ritual.stats")]);
  assert.match(out[0].description ?? "", /Dawn lint sweep/);
  assert.match(out[0].description ?? "", /Sunrise project stats/);
});
