import { ProjectShortcutsFile, Shortcut } from "./shortcut";
import { recipeSectionAppearance, recipeDefaultGroupId } from "./shortcutStoreShared";
import { ShortcutStoreRestore } from "./shortcutStoreRestore";

// Promote-recipe layer: converting a detected recipe into a stored, fully-editable
// shortcut, including the one-tap "adopt and enable schedule" path. The per-field
// update/set toggles live in ShortcutStoreFieldUpdates and the restore/undo paths in
// ShortcutStoreRestore — both split out to keep each file under the project's
// line-count cap.
export abstract class ShortcutStoreMutation extends ShortcutStoreRestore {
  // Convert a recipe into a stored, fully-editable shortcut: suppress the seeded
  // recipe (so it does not duplicate) and add an equivalent explicit shortcut
  // carrying its action/path, label, and appearance. Returns false for a non-recipe
  // shortcut.
  async promoteRecipe(shortcut: Shortcut): Promise<boolean> {
    return (await this.promoteRecipeInternal(shortcut, false)) !== undefined;
  }

  // Adopt a recipe and hand back the new stored shortcut's id so a caller can act on the
  // promoted copy (the launcher's "Schedule" button promotes, then opens the schedule
  // editor on the result — a recipe stores nothing, so a schedule cannot persist on it
  // until it is adopted). Returns undefined when promotion does nothing (non-recipe or its
  // owning folder cannot be resolved).
  async promoteRecipeReturningId(shortcut: Shortcut): Promise<string | undefined> {
    return this.promoteRecipeInternal(shortcut, false);
  }

  // One-tap adoption for a recommended scheduled ritual: promote it to a stored shortcut
  // AND turn its schedule on in the same act, so a single click yields a running ritual
  // rather than a disabled stored shortcut the user must then enable. The scheduler
  // re-arms off the refresh promoteRecipeInternal fires. Returns false for a non-recipe
  // or a recipe that carries no schedule (nothing to enable); the caller's confirming
  // toast reads the ritual's time from the shortcut itself.
  async enableScheduledRecipe(shortcut: Shortcut): Promise<boolean> {
    if (!shortcut.schedule) {
      return false;
    }
    return (await this.promoteRecipeInternal(shortcut, true)) !== undefined;
  }

  // Shared promotion: suppress the detected recipe (so it does not duplicate) and add an
  // equivalent stored shortcut carrying its action/path/label/appearance. When
  // enableSchedule is true and the recipe has a schedule, the stored copy's schedule is
  // turned on (the one-tap-enable path); otherwise the recipe's schedule is copied
  // verbatim (disabled rituals stay disabled until the user enables them). Returns false
  // for a non-recipe shortcut or one whose owning folder cannot be resolved. On success
  // returns the new stored shortcut's id (undefined otherwise), so a caller can resolve and
  // act on the promoted copy after the refresh.
  private async promoteRecipeInternal(
    shortcut: Shortcut,
    enableSchedule: boolean
  ): Promise<string | undefined> {
    if (!shortcut.isRecipe || !shortcut.recipeId) {
      return undefined;
    }
    const folder = this.projectShortcutFolder.get(shortcut.id);
    if (!folder) {
      return undefined;
    }
    const file = await this.readProjectFile(folder);
    if (!file.removedRecipes.includes(shortcut.recipeId)) {
      file.removedRecipes.push(shortcut.recipeId);
    }
    // File the promoted shortcut. A recipe pre-assigned to a built-in default group
    // (recipeDefaultGroupId, keyed by stable recipeId — e.g. the "test" recipe -> the
    // Test group, "deployed" -> Deploy) lands there directly: that id is synthetic, so
    // no file.groups entry is created. This is gated on default groups being enabled,
    // since a disabled default group would not render and would strand the shortcut.
    // Otherwise fall back to a user group named after the recipe's section (a GitHub
    // recipe -> a "GitHub" group), created on demand, so a promoted recipe still lands in
    // a tidy folder rather than loose at the scope's top level.
    const defaultGroupId = this.defaultGroupsEnabled()
      ? recipeDefaultGroupId(shortcut.recipeId)
      : undefined;
    // effectiveDefaultGroupId routes into a hand-made group of the same name when one
    // exists (the synthetic duplicate is suppressed at render), so a promoted recipe and
    // an auto-added file with the same default home share one folder.
    const groupId = defaultGroupId
      ? this.effectiveDefaultGroupId(file.groups, defaultGroupId)
      : this.ensurePromotionGroup(file, shortcut.groupId);
    const newId = this.newId();
    file.pins.push({
      id: newId,
      path: shortcut.path,
      label: shortcut.label,
      scope: "project",
      groupId,
      action: shortcut.action,
      // Turn the schedule on for the one-tap-enable path; otherwise copy it verbatim so
      // a plain promote leaves a disabled ritual disabled.
      schedule:
        enableSchedule && shortcut.schedule
          ? { ...shortcut.schedule, enabled: true }
          : shortcut.schedule,
      icon: shortcut.icon,
      color: shortcut.color,
      description: shortcut.description,
      order: file.pins.length,
    });
    // Adopting from the shelf dismisses the one-time welcome hint (a one-way latch);
    // the refresh below then drops the hint row.
    await this.dismissRecommendHint();
    await this.writeProjectFile(folder, file);
    await this.refresh();
    return newId;
  }

  // Find (or create, in `file`) the user group a promoted recipe should land in,
  // returning its id — or undefined when the recipe carried no recognizable section
  // (then the promoted shortcut stays at the scope's top level, the prior behavior).
  // The match is case-insensitive on the label so a recipe and a hand-made group of
  // the same name reuse one folder; a freshly created group inherits the section's
  // glyph + tint so it reads like the recipe folder it came from. Mutates file.groups
  // only — the caller persists the file.
  private ensurePromotionGroup(
    file: ProjectShortcutsFile,
    sourceGroupId: string | undefined
  ): string | undefined {
    const section = recipeSectionAppearance(sourceGroupId);
    if (!section) {
      return undefined;
    }
    const wanted = section.label.trim().toLowerCase();
    const existing = file.groups.find(
      (g) => g.label.trim().toLowerCase() === wanted
    );
    if (existing) {
      return existing.id;
    }
    const id = this.newId();
    file.groups.push({
      id,
      label: section.label,
      order: file.groups.length,
      icon: section.icon,
      color: section.color,
    });
    return id;
  }
}
