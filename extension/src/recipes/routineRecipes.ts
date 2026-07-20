import { RecipeResult } from "./detectors";
import { RoutineMember } from "../model/shortcut";

// Composite-recipe ("routine") detection. A routine runs an ordered set of other
// recipe shortcuts in sequence as one action. The headline is the Morning routine: when
// the folder already has two or more morning-appropriate scheduled rituals, offer a
// single recipe that fires them back-to-back when the user arrives.
//
// This detector runs AFTER the others and is handed the recipes they produced, so it
// pre-populates the member list from what actually exists (never proposing an empty
// or single-member routine). The user edits membership/order afterward — a routine is
// just a shortcut with an ordered members list.

// The morning members, in run order. Hygiene runs FIRST so a frozen-tree project is
// caught before the heavier members; the rest follow the recipe book's morning
// cadence. Each entry is the recipeId the morning ritual is detected under; a member
// is only included when that ritual was actually detected for the project, so a
// non-Dart / non-linted project simply gets a shorter routine.
//
// The code-health cluster (lint sweep + tech-debt/TODO harvest) and dependency
// freshness are part of the morning block so the daily report includes lint issues,
// TODO markers, and out-of-date packages (report bug items 4 and 5), not just the
// git/PR digest.
const MORNING_MEMBER_ORDER: ReadonlyArray<{ recipeId: string; label: string }> = [
  // First, always: whether the build is currently broken outranks every measurement
  // below it. A morning brief that reports line counts while main is red has its
  // priorities inverted.
  { recipeId: "ritual.ci", label: "Build status" },
  { recipeId: "hygiene.bloat", label: "Workspace bloat scan" },
  { recipeId: "ritual.lint", label: "Dawn lint sweep" },
  { recipeId: "ritual.debt", label: "Tech-debt harvest" },
  { recipeId: "ritual.stats", label: "Sunrise project stats" },
  { recipeId: "ritual.deps", label: "Dependency freshness" },
  { recipeId: "ritual.standup", label: "Standup digest" },
  { recipeId: "ritual.prs", label: "PR review queue" },
  // Last on purpose: the Suite daily report is the cross-tool recap (yesterday's
  // debug sessions, lint health, DB anomalies), so it reads as the closing summary
  // after the per-source sections above.
  { recipeId: "ritual.suite", label: "Saropa Suite daily report" },
];

// The minimum detected morning members before a Morning routine is offered — never
// propose an empty or single-member routine.
const MIN_MEMBERS = 2;

// Builds the Morning routine from whichever morning rituals the other detectors
// already produced (passed in as `detected`), pre-populating its member list from
// what actually exists in run order. Returns no recipe at all when fewer than
// MIN_MEMBERS were detected, so a sparse project never gets a near-empty routine.
export function detectRoutineRecipes(detected: RecipeResult[]): RecipeResult[] {
  const present = new Set(detected.map((r) => r.recipeId));
  const members: RoutineMember[] = MORNING_MEMBER_ORDER.filter((m) =>
    present.has(m.recipeId)
  ).map((m) => ({ recipeId: m.recipeId, label: m.label }));

  if (members.length < MIN_MEMBERS) {
    return [];
  }

  const memberNames = members.map((m) => m.label).join(", ");
  return [
    {
      recipeId: "routine.morning",
      label: "Morning routine",
      description:
        "A routine (a recipe of recipes): runs this morning's scheduled checks in " +
        `sequence as one action — ${memberNames}. Scheduled daily at 08:00, seeds ` +
        "disabled; enable it by promoting the recipe to a stored shortcut. One timer drives " +
        "the whole block (the members keep their own times only when run standalone). " +
        "Each member writes its own report; the routine writes a one-screen summary " +
        "linking them and badges red if any member needs attention. Run now fires the " +
        "whole block on demand. Edit the membership and order freely afterward.",
      icon: "run-all",
      color: "charts.green",
      group: "scheduled",
      // The routine carries the schedule (disabled by default, like every scheduled
      // ritual); one fire runs all members in sequence.
      schedule: { atTime: "08:00", enabled: false },
      action: { kind: "routine", members },
    },
  ];
}
