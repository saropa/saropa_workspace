import { Shortcut } from "./shortcut";

// Routine membership repair. A routine stores its members as references (recipeId
// for a detected recipe, pinId for a hand-composed one), so a member can outlive the
// shortcut it names. These helpers keep the two in step. They live in their own
// module rather than beside removeShortcut because the recipe-seeding layer needs
// them too, and that layer is a BASE class of the mutation layer — importing back
// into it would close an import cycle.

// Unlink a removed shortcut from every routine in the same file, so no routine is
// left holding a member it can never resolve. Matches on whichever reference the
// member was stored under: recipeId for a detected recipe (the sticky-removal case)
// or pinId for a hand-composed member over a stored shortcut. Exported for tests.
// Returns the number of members dropped.
export function pruneRoutineMembers(
  pins: readonly Shortcut[],
  removed: Pick<Shortcut, "id" | "recipeId">
): number {
  let dropped = 0;
  for (const pin of pins) {
    const action = pin.action;
    // Narrowed off a local so the assignment below keeps the same non-undefined
    // `action` the members were read from.
    if (action?.kind !== "routine" || !action.members) {
      continue;
    }
    const members = action.members;
    // A member with neither reference cannot name the removed shortcut, so it is
    // left alone rather than swept up by a loose match.
    const kept = members.filter(
      (m) =>
        !(
          (removed.recipeId !== undefined && m.recipeId === removed.recipeId) ||
          (removed.id !== "" && m.recipeId === undefined && m.pinId === removed.id)
        )
    );
    dropped += members.length - kept.length;
    action.members = kept;
  }
  return dropped;
}

// Repair pass for routines broken BEFORE the prune above existed: drop any member
// naming a recipe that is currently suppressed. Such a member is unresolvable by
// definition — buildRecipeShortcuts skips suppressed recipes — so it could only ever
// report "Shortcut not found" again. Runs on load so an already-broken routine heals
// itself rather than leaving the user to hand-edit the project JSON. Returns the
// number of members dropped, so the caller writes the file back only when it changed.
export function pruneSuppressedRoutineMembers(
  pins: readonly Shortcut[],
  removedRecipes: readonly string[]
): number {
  if (removedRecipes.length === 0) {
    return 0;
  }
  let dropped = 0;
  for (const recipeId of removedRecipes) {
    dropped += pruneRoutineMembers(pins, { id: "", recipeId });
  }
  return dropped;
}
