import * as vscode from "vscode";
import {
  Pin,
  PinExecConfig,
  PinGroup,
  PinMetric,
  PinSchedule,
  PinScope,
  PinSet,
  PinTrigger,
  SystemEventName,
  ProjectPinsFile,
  PROJECT_PINS_VERSION,
  PROJECT_FILE_RELATIVE,
  DEFAULT_SET_NAME,
  emptyProjectPinsFile,
  pinKind,
} from "./pin";
import { parseGlobalPath, globalStoredPath } from "./pinPaths";
import { detectOnDemandRecipes, RecipeCategory, RecipeResult } from "../recipes/detectors";
import { detectScheduledRecipes } from "../recipes/scheduledRecipes";
import { detectSuiteRecipes } from "../recipes/suiteRecipes";
import { detectProcessRecipes } from "../recipes/processRecipes";
import { detectHygieneRecipes } from "../recipes/hygieneRecipes";
import { detectRoutineRecipes } from "../recipes/routineRecipes";
import { detectAiContextRecipes } from "../recipes/aiContextRecipes";
import { getOutputChannel } from "../exec/runner";
import { SharedPin } from "../import/shareLink";
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
  isGlobPattern,
  setsEqual,
  sameSetName,
} from "./pinStoreShared";
import { PinStoreMutationCore } from "./pinStoreMutationCore";

// Field-update layer: the per-field updatePin* / setPin* toggles (each a thin
// mutatePin call), plus the restore (undo) and promote-recipe paths.
export abstract class PinStoreMutation extends PinStoreMutationCore {
  // Persist a pin's run configuration. Passing undefined clears it (the pin
  // reverts to interpreter-default behavior).
  async updatePinExec(
    pin: Pin,
    exec: PinExecConfig | undefined
  ): Promise<void> {
    await this.mutatePin(pin, (target) => {
      target.exec = exec;
    });
  }

  // Persist a pin's schedule. Passing undefined clears it (the scheduler then
  // arms no timer for the pin).
  async updatePinSchedule(
    pin: Pin,
    schedule: PinSchedule | undefined
  ): Promise<void> {
    await this.mutatePin(pin, (target) => {
      target.schedule = schedule;
    });
  }

  // Persist a pin's auto-run triggers and emitted system events (recipe chaining).
  // An empty array collapses to undefined so a pin with no links reads as "manual /
  // schedule only" rather than carrying inert arrays.
  async updatePinTriggers(
    pin: Pin,
    triggers: PinTrigger[] | undefined,
    emits: SystemEventName[] | undefined
  ): Promise<void> {
    await this.mutatePin(pin, (target) => {
      target.triggers = triggers && triggers.length > 0 ? triggers : undefined;
      target.emits = emits && emits.length > 0 ? emits : undefined;
    });
  }

  // Persist a pin's tree-icon and color overrides. Passing undefined for either
  // clears it (the pin reverts to the file-type default glyph / no tint).
  async updatePinAppearance(
    pin: Pin,
    icon: string | undefined,
    color: string | undefined
  ): Promise<void> {
    await this.mutatePin(pin, (target) => {
      target.icon = icon;
      target.color = color;
    });
  }

  // Persist a pin's paused flag. Pausing suspends every unattended runner for the
  // pin (scheduler, chain triggers/emits, idle, run-on-save) while keeping its
  // schedule/triggers intact; a manual run still works. Cleared (dropped) on
  // unpause so an active pin carries no stale flag. Routed through mutatePin, so it
  // no-ops on an auto/recipe pin (recomputed, not stored) — the command gates those
  // out up front. The store fires onDidChange, which re-arms the scheduler (a paused
  // pin then gets no timer) and re-syncs the idle thresholds.
  async setPinPaused(pin: Pin, paused: boolean): Promise<void> {
    await this.mutatePin(pin, (target) => {
      target.paused = paused ? true : undefined;
    });
  }

  // Persist a pin's single-instance settings. allowConcurrent true opts the pin out
  // of the run guard (overlapping runs allowed); false/cleared restores the default
  // block. lockName names the optional cross-process lock; a blank name clears it.
  // Both collapse to undefined when off so a default pin carries no inert fields
  // (round-trip parity). Routed through mutatePin, so it no-ops on an auto/recipe pin.
  async setPinConcurrency(
    pin: Pin,
    allowConcurrent: boolean,
    lockName: string | undefined
  ): Promise<void> {
    const cleaned = lockName && lockName.trim().length > 0 ? lockName.trim() : undefined;
    await this.mutatePin(pin, (target) => {
      target.allowConcurrent = allowConcurrent ? true : undefined;
      target.lockName = cleaned;
    });
  }

  // Persist a file pin's tail-follow flag (WOW #5). Passing false clears it so the
  // pin opens normally again. Stored as a plain pin field, so it round-trips like
  // any other; the open path reads it to decide whether to auto-scroll the log.
  async setPinTail(pin: Pin, follow: boolean): Promise<void> {
    await this.mutatePin(pin, (target) => {
      // Drop the field entirely when off, so an unfollowed pin carries no stale flag.
      target.tailFollow = follow ? true : undefined;
    });
  }

  // Persist a pin's cross-file watch globs (#25). Empties/whitespace are trimmed out;
  // an empty result clears the field (and the now-bare exec object is left as-is —
  // other exec settings may still live on it) so an un-linked pin carries no stale
  // watch list. Lives on exec beside runOnSave so the one save listener reads both.
  // Routed through mutatePin, so it no-ops on an auto/recipe pin (recomputed, not
  // stored) — the linking command gates those out before calling.
  async setPinWatchGlobs(pin: Pin, globs: string[]): Promise<void> {
    const cleaned = globs.map((g) => g.trim()).filter((g) => g.length > 0);
    await this.mutatePin(pin, (target) => {
      if (cleaned.length > 0) {
        target.exec = { ...(target.exec ?? {}), runOnSaveGlobs: cleaned };
      } else if (target.exec) {
        target.exec.runOnSaveGlobs = undefined;
      }
    });
  }

  // Persist a file pin's masked / vault flag (WOW #26 — the screen-share guard). On
  // masks the pin (generic label + lock glyph in the tree, real path hidden from the
  // row and hover, and a reveal confirm before the file opens); off restores the
  // normal pin. Dropped (set undefined) when off so an unmasked pin carries no stale
  // flag — round-trip parity. Routed through mutatePin, so it no-ops on an auto/recipe
  // pin (recomputed, not stored) — the toggle command gates those out up front.
  async setMasked(pin: Pin, masked: boolean): Promise<void> {
    await this.mutatePin(pin, (target) => {
      target.masked = masked ? true : undefined;
    });
  }

  // Persist a file pin's live-metric badge (#24). Passing undefined clears it (the
  // metric engine then disposes that pin's file watcher on the next reconcile).
  // Routed through mutatePin, so it no-ops on an auto-pin (recomputed, not stored) —
  // the setMetric command gates those out up front.
  async setPinMetric(pin: Pin, metric: PinMetric | undefined): Promise<void> {
    await this.mutatePin(pin, (target) => {
      target.metric = metric;
    });
  }

  // Persist a pin's time-bomb expiry (WOW #9). An empty/all-undefined condition
  // collapses to undefined so a defused pin carries no inert object and reads as
  // "never expires". Routed through mutatePin, so it no-ops on an auto-pin (which
  // is recomputed, not stored) — the configure command gates those out up front.
  async setPinExpiry(
    pin: Pin,
    expires: { at?: number; onBranchAway?: string } | undefined
  ): Promise<void> {
    const meaningful =
      expires && (expires.at !== undefined || expires.onBranchAway !== undefined)
        ? expires
        : undefined;
    await this.mutatePin(pin, (target) => {
      target.expires = meaningful;
    });
  }

  // Persist a pin's classification tags (WOW #17). Lowercased, trimmed, blank-
  // stripped, and de-duplicated so the stored set is canonical; an empty result
  // collapses to undefined so an untagged pin carries no inert array. Routed
  // through mutatePin, so it no-ops on an auto/recipe pin (recomputed, not stored)
  // — the tag command gates those out up front.
  async setPinTags(pin: Pin, tags: string[]): Promise<void> {
    const cleaned = Array.from(
      new Set(tags.map((t) => t.trim().toLowerCase()).filter((t) => t.length > 0))
    );
    await this.mutatePin(pin, (target) => {
      target.tags = cleaned.length > 0 ? cleaned : undefined;
    });
  }

  // Persist a pin's branch link (WOW #3). A branch name scopes the pin to that
  // branch (shown only while the owning folder is on it); undefined clears the link
  // (shown on every branch). Routed through mutatePin, so it no-ops on an auto/recipe
  // pin (recomputed, not stored) — the toggle command gates those out up front.
  async setPinBranch(pin: Pin, branch: string | undefined): Promise<void> {
    await this.mutatePin(pin, (target) => {
      target.branch = branch && branch.length > 0 ? branch : undefined;
    });
  }


  // Re-add a pin removed by the time-bomb sweep — the Undo path (WOW #9). The
  // expiry condition is dropped on the way back in, so an already-expired snapshot
  // is not swept away again the instant it returns (Undo defuses the bomb). The id
  // is preserved so any reused per-pin state lines up. A global pin is pushed back
  // to globalState; a project pin is written to its captured owning folder (passed
  // in, since the projectPinFolder map no longer holds the removed id), falling
  // back to the first workspace folder.
  async restorePin(snapshot: Pin, folder?: vscode.WorkspaceFolder): Promise<void> {
    const restored: Pin = { ...snapshot, expires: undefined };
    if (snapshot.scope === "global") {
      const pins = this.readGlobalPins();
      restored.order = pins.length;
      pins.push(restored);
      await this.writeGlobalPins(pins);
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
  // interval advancement (see nextOccurrence). No-op if the pin has no schedule.
  async updatePinScheduleLastRun(pin: Pin, lastRun: number): Promise<void> {
    await this.mutatePin(pin, (target) => {
      if (target.schedule) {
        target.schedule.lastRun = lastRun;
      }
    });
  }

  // Re-add every removed auto-pin across all folders. Returns how many were
  // restored so the caller can report it.
  async restoreAutoPins(): Promise<number> {
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

  // Convert a recipe into a stored, fully-editable pin: suppress the seeded recipe
  // (so it does not duplicate) and add an equivalent explicit pin carrying its
  // action/path, label, and appearance. Returns false for a non-recipe pin.
  async promoteRecipe(pin: Pin): Promise<boolean> {
    if (!pin.isRecipe || !pin.recipeId) {
      return false;
    }
    const folder = this.projectPinFolder.get(pin.id);
    if (!folder) {
      return false;
    }
    const file = await this.readProjectFile(folder);
    if (!file.removedRecipes.includes(pin.recipeId)) {
      file.removedRecipes.push(pin.recipeId);
    }
    file.pins.push({
      id: this.newId(),
      path: pin.path,
      label: pin.label,
      scope: "project",
      action: pin.action,
      schedule: pin.schedule,
      icon: pin.icon,
      color: pin.color,
      description: pin.description,
      order: file.pins.length,
    });
    await this.writeProjectFile(folder, file);
    await this.refresh();
    return true;
  }
}
