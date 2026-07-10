import { Shortcut } from "../model/shortcut";
import { RECOMMENDED_GROUP_ID } from "../model/shortcutStoreShared";

// The contextValue-assembly phase of ShortcutTreeItem's constructor, split out so the
// class body stays a short sequence of builder calls. contextValue gates every menu
// clause (package.json's `when` expressions match on it), so its exact string
// values are load-bearing — this split keeps the constructor short, it does not
// change any of the menu-gating strings themselves.

// Compute the contextValue that gates a shortcut row's context menu. A running
// shortcut uses "shortcutRunning" so the Stop action shows; recipe shortcuts use
// "shortcutRecipe" (Promote / sticky Remove, but no Configure Run/Schedule which only
// apply to stored shortcuts); auto-added shortcuts are distinguished from explicit
// shortcuts. All start with "shortcut" so the /^shortcut/ run/open/remove clauses
// match. A resting shortcut that carries a schedule gets a "Scheduled" suffix
// (shortcutScheduled / shortcutRecipeScheduled) so its context menu shows "Run now"
// instead of "Run" — firing a scheduled job ahead of its timer reads as intentional.
// The suffix preserves the /^shortcut/ prefix, so the generic run/open/remove/peek
// clauses still match; only the exact-match clauses (Configure Run/Schedule/
// Appearance, Promote) are widened to accept it.
// A paused stored shortcut appends a "Paused" suffix (shortcutPaused /
// shortcutScheduledPaused) so the context menu can swap "Pause" for "Unpause"; the
// suffix preserves the /^shortcut/ prefix and the config clauses match it via
// /^shortcut(Scheduled)?(Paused)?$/, so a paused shortcut keeps every edit/run
// action. Only explicit shortcuts are pausable (auto/recipe shortcuts are
// recomputed, not stored), so the suffix is applied to the stored-shortcut branch
// alone.
export function buildShortcutContextValue(
  shortcut: Shortcut,
  isRunning: boolean,
  isStopping: boolean
): string {
  const scheduled = shortcut.schedule !== undefined;
  const pausedSuffix = shortcut.paused ? "Paused" : "";
  // A recommended scheduled-ritual row (a pointer on the Recommended shelf, identified
  // by its synthetic group) gets a distinct "shortcutRecommendScheduled" value so the
  // shelf can offer the one-tap "enable" inline action that category recipe rows do
  // not. It still starts with "shortcut" and ends with "Scheduled", so the generic
  // run/open/remove clauses and the /Scheduled$/ "Run now" clause keep matching.
  const onRecommendShelf = shortcut.groupId === RECOMMENDED_GROUP_ID;
  return isStopping
    ? "shortcutStopping"
    : isRunning
      ? "shortcutRunning"
      : shortcut.isRecipe
        ? scheduled
          ? onRecommendShelf
            ? "shortcutRecommendScheduled"
            : "shortcutRecipeScheduled"
          : "shortcutRecipe"
        : shortcut.isAuto
          ? "shortcutAuto"
          : scheduled
            ? `shortcutScheduled${pausedSuffix}`
            : `shortcut${pausedSuffix}`;
}
