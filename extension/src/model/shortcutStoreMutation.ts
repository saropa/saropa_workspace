import * as vscode from "vscode";
import {
  Shortcut,
  ShortcutExecConfig,
  ShortcutGroup,
  ShortcutMetric,
  ShortcutSchedule,
  ShortcutScope,
  ShortcutSet,
  ShortcutTrigger,
  SystemEventName,
  ProjectShortcutsFile,
  PROJECT_SHORTCUTS_VERSION,
  PROJECT_FILE_RELATIVE,
  DEFAULT_SET_NAME,
  emptyProjectShortcutsFile,
  shortcutKind,
} from "./shortcut";
import { parseGlobalPath, globalStoredPath } from "./shortcutPaths";
import { detectOnDemandRecipes, RecipeCategory, RecipeResult } from "../recipes/detectors";
import { detectScheduledRecipes } from "../recipes/scheduledRecipes";
import { detectSuiteRecipes } from "../recipes/suiteRecipes";
import { detectProcessRecipes } from "../recipes/processRecipes";
import { detectHygieneRecipes } from "../recipes/hygieneRecipes";
import { detectRoutineRecipes } from "../recipes/routineRecipes";
import { detectAiContextRecipes } from "../recipes/aiContextRecipes";
import { getOutputChannel } from "../exec/runner";
import { SharedShortcut } from "../import/shareLink";
import { l10n } from "../i18n/l10n";
import {
  MoveTarget,
  GLOBAL_STATE_KEY,
  GLOBAL_GROUPS_KEY,
  RECIPE_GROUPS,
  RECIPE_SUBGROUPS,
  RECIPE_GROUP_EXPANDED_PREFIX,
  recipeGroupId,
  recipeSubGroupId,
  isSyntheticRecipeGroupId,
  recipeGroupColor,
  recipeSectionAppearance,
  recipeDefaultGroupId,
  isGlobPattern,
  setsEqual,
  sameSetName,
} from "./shortcutStoreShared";
import { ShortcutStoreMutationCore } from "./shortcutStoreMutationCore";

// Field-update layer: the per-field updateShortcut* / setShortcut* toggles (each a
// thin mutateShortcut call), plus the restore (undo) and promote-recipe paths.
export abstract class ShortcutStoreMutation extends ShortcutStoreMutationCore {
  // Persist a shortcut's run configuration. Passing undefined clears it (the shortcut
  // reverts to interpreter-default behavior).
  async updateShortcutExec(
    shortcut: Shortcut,
    exec: ShortcutExecConfig | undefined
  ): Promise<void> {
    await this.mutateShortcut(shortcut, (target) => {
      target.exec = exec;
    });
  }

  // Persist a shortcut's schedule. Passing undefined clears it (the scheduler then
  // arms no timer for the shortcut).
  async updateShortcutSchedule(
    shortcut: Shortcut,
    schedule: ShortcutSchedule | undefined
  ): Promise<void> {
    await this.mutateShortcut(shortcut, (target) => {
      target.schedule = schedule;
    });
  }

  // Persist a shortcut's auto-run triggers and emitted system events (recipe
  // chaining). An empty array collapses to undefined so a shortcut with no links
  // reads as "manual / schedule only" rather than carrying inert arrays.
  async updateShortcutTriggers(
    shortcut: Shortcut,
    triggers: ShortcutTrigger[] | undefined,
    emits: SystemEventName[] | undefined
  ): Promise<void> {
    await this.mutateShortcut(shortcut, (target) => {
      target.triggers = triggers && triggers.length > 0 ? triggers : undefined;
      target.emits = emits && emits.length > 0 ? emits : undefined;
    });
  }

  // Persist a shortcut's tree-icon and color overrides. Passing undefined for either
  // clears it (the shortcut reverts to the file-type default glyph / no tint).
  async updateShortcutAppearance(
    shortcut: Shortcut,
    icon: string | undefined,
    color: string | undefined
  ): Promise<void> {
    await this.mutateShortcut(shortcut, (target) => {
      target.icon = icon;
      target.color = color;
    });
  }

  // Persist a shortcut's paused flag. Pausing suspends every unattended runner for
  // the shortcut (scheduler, chain triggers/emits, idle, run-on-save) while keeping
  // its schedule/triggers intact; a manual run still works. Cleared (dropped) on
  // unpause so an active shortcut carries no stale flag. Routed through
  // mutateShortcut, so it no-ops on an auto/recipe shortcut (recomputed, not stored)
  // — the command gates those out up front. The store fires onDidChange, which re-
  // arms the scheduler (a paused shortcut then gets no timer) and re-syncs the idle
  // thresholds.
  async setShortcutPaused(shortcut: Shortcut, paused: boolean): Promise<void> {
    await this.mutateShortcut(shortcut, (target) => {
      target.paused = paused ? true : undefined;
    });
  }

  // Persist a shortcut's single-instance settings. allowConcurrent true opts the
  // shortcut out of the run guard (overlapping runs allowed); false/cleared restores
  // the default block. lockName names the optional cross-process lock; a blank name
  // clears it. Both collapse to undefined when off so a default shortcut carries no
  // inert fields (round-trip parity). Routed through mutateShortcut, so it no-ops on
  // an auto/recipe shortcut.
  async setShortcutConcurrency(
    shortcut: Shortcut,
    allowConcurrent: boolean,
    lockName: string | undefined
  ): Promise<void> {
    const cleaned = lockName && lockName.trim().length > 0 ? lockName.trim() : undefined;
    await this.mutateShortcut(shortcut, (target) => {
      target.allowConcurrent = allowConcurrent ? true : undefined;
      target.lockName = cleaned;
    });
  }

  // Persist a file shortcut's tail-follow flag (WOW #5). Passing false clears it so
  // the shortcut opens normally again. Stored as a plain shortcut field, so it round-
  // trips like any other; the open path reads it to decide whether to auto-scroll the
  // log.
  async setShortcutTail(shortcut: Shortcut, follow: boolean): Promise<void> {
    await this.mutateShortcut(shortcut, (target) => {
      // Drop the field entirely when off, so an unfollowed shortcut carries no stale
      // flag.
      target.tailFollow = follow ? true : undefined;
    });
  }

  // Persist a shortcut's cross-file watch globs (#25). Empties/whitespace are trimmed
  // out; an empty result clears the field (and the now-bare exec object is left as-is
  // — other exec settings may still live on it) so an un-linked shortcut carries no
  // stale watch list. Lives on exec beside runOnSave so the one save listener reads
  // both. Routed through mutateShortcut, so it no-ops on an auto/recipe shortcut
  // (recomputed, not stored) — the linking command gates those out before calling.
  async setShortcutWatchGlobs(shortcut: Shortcut, globs: string[]): Promise<void> {
    const cleaned = globs.map((g) => g.trim()).filter((g) => g.length > 0);
    await this.mutateShortcut(shortcut, (target) => {
      if (cleaned.length > 0) {
        target.exec = { ...(target.exec ?? {}), runOnSaveGlobs: cleaned };
      } else if (target.exec) {
        target.exec.runOnSaveGlobs = undefined;
      }
    });
  }

  // Persist a file shortcut's masked / vault flag (WOW #26 — the screen-share guard).
  // On masks the shortcut (generic label + lock glyph in the tree, real path hidden
  // from the row and hover, and a reveal confirm before the file opens); off restores
  // the normal shortcut. Dropped (set undefined) when off so an unmasked shortcut
  // carries no stale flag — round-trip parity. Routed through mutateShortcut, so it
  // no-ops on an auto/recipe shortcut (recomputed, not stored) — the toggle command
  // gates those out up front.
  async setMasked(shortcut: Shortcut, masked: boolean): Promise<void> {
    await this.mutateShortcut(shortcut, (target) => {
      target.masked = masked ? true : undefined;
    });
  }

  // Persist a file shortcut's live-metric badge (#24). Passing undefined clears it
  // (the metric engine then disposes that shortcut's file watcher on the next
  // reconcile). Routed through mutateShortcut, so it no-ops on an auto-shortcut
  // (recomputed, not stored) — the setMetric command gates those out up front.
  async setShortcutMetric(shortcut: Shortcut, metric: ShortcutMetric | undefined): Promise<void> {
    await this.mutateShortcut(shortcut, (target) => {
      target.metric = metric;
    });
  }

  // Persist a shortcut's time-bomb expiry (WOW #9). An empty/all-undefined condition
  // collapses to undefined so a defused shortcut carries no inert object and reads as
  // "never expires". Routed through mutateShortcut, so it no-ops on an auto-shortcut
  // (which is recomputed, not stored) — the configure command gates those out up front.
  async setShortcutExpiry(
    shortcut: Shortcut,
    expires: { at?: number; onBranchAway?: string } | undefined
  ): Promise<void> {
    const meaningful =
      expires && (expires.at !== undefined || expires.onBranchAway !== undefined)
        ? expires
        : undefined;
    await this.mutateShortcut(shortcut, (target) => {
      target.expires = meaningful;
    });
  }

  // Persist a shortcut's classification tags (WOW #17). Lowercased, trimmed, blank-
  // stripped, and de-duplicated so the stored set is canonical; an empty result
  // collapses to undefined so an untagged shortcut carries no inert array. Routed
  // through mutateShortcut, so it no-ops on an auto/recipe shortcut (recomputed, not
  // stored) — the tag command gates those out up front.
  async setShortcutTags(shortcut: Shortcut, tags: string[]): Promise<void> {
    const cleaned = Array.from(
      new Set(tags.map((t) => t.trim().toLowerCase()).filter((t) => t.length > 0))
    );
    await this.mutateShortcut(shortcut, (target) => {
      target.tags = cleaned.length > 0 ? cleaned : undefined;
    });
  }

  // Persist a shortcut's branch link (WOW #3). A branch name scopes the shortcut to
  // that branch (shown only while the owning folder is on it); undefined clears the
  // link (shown on every branch). Routed through mutateShortcut, so it no-ops on an
  // auto/recipe shortcut (recomputed, not stored) — the toggle command gates those
  // out up front.
  async setShortcutBranch(shortcut: Shortcut, branch: string | undefined): Promise<void> {
    await this.mutateShortcut(shortcut, (target) => {
      target.branch = branch && branch.length > 0 ? branch : undefined;
    });
  }


  // Re-add a shortcut removed by the time-bomb sweep — the Undo path (WOW #9). The
  // expiry condition is dropped on the way back in, so an already-expired snapshot
  // is not swept away again the instant it returns (Undo defuses the bomb). The id
  // is preserved so any reused per-shortcut state lines up. A global shortcut is
  // pushed back to globalState; a project shortcut is written to its captured owning
  // folder (passed in, since the projectShortcutFolder map no longer holds the removed
  // id), falling back to the first workspace folder.
  async restoreShortcut(snapshot: Shortcut, folder?: vscode.WorkspaceFolder): Promise<void> {
    const restored: Shortcut = { ...snapshot, expires: undefined };
    if (snapshot.scope === "global") {
      const shortcuts = this.readGlobalShortcuts();
      restored.order = shortcuts.length;
      shortcuts.push(restored);
      await this.writeGlobalShortcuts(shortcuts);
      await this.refresh();
      return;
    }
    const owner = folder ?? vscode.workspace.workspaceFolders?.[0];
    if (!owner) {
      return;
    }
    const file = await this.readProjectFile(owner);
    restored.order = file.pins.length;
    file.pins.push(restored);
    await this.writeProjectFile(owner, file);
    await this.refresh();
  }

  // Record the epoch-ms of a scheduled fire. Used for reopen de-duplication and
  // interval advancement (see nextOccurrence). No-op if the shortcut has no schedule.
  async updateShortcutScheduleLastRun(shortcut: Shortcut, lastRun: number): Promise<void> {
    await this.mutateShortcut(shortcut, (target) => {
      if (target.schedule) {
        target.schedule.lastRun = lastRun;
      }
    });
  }

  // Re-add every removed auto-shortcut across all folders. Returns how many were
  // restored so the caller can report it.
  async restoreAutoShortcuts(): Promise<number> {
    let restored = 0;
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      const file = await this.readProjectFile(folder);
      if (file.removedAutoPins.length > 0) {
        restored += file.removedAutoPins.length;
        file.removedAutoPins = [];
        await this.writeProjectFile(folder, file);
      }
    }
    if (restored > 0) {
      await this.refresh();
    }
    return restored;
  }

  async restoreRecipes(): Promise<number> {
    let restored = 0;
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      const file = await this.readProjectFile(folder);
      if (file.removedRecipes.length > 0) {
        restored += file.removedRecipes.length;
        file.removedRecipes = [];
        await this.writeProjectFile(folder, file);
      }
    }
    if (restored > 0) {
      await this.refresh();
    }
    return restored;
  }

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
