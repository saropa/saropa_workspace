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
import { PinStoreRefresh } from "./pinStoreRefresh";

// Core mutation layer: add / import / remove / rename / re-point pins, plus the
// shared placeAfter (ordered insert) and mutatePin (find-apply-persist-refresh)
// helpers the update/set toggles in PinStoreMutation build on.
export abstract class PinStoreMutationCore extends PinStoreRefresh {
  async addPin(
    uri: vscode.Uri,
    scope: PinScope,
    label?: string,
    groupName?: string
  ): Promise<boolean> {
    // Only carry a non-empty label so a pin without an alias keeps the basename
    // default rather than storing an empty override.
    const labelField = label && label.trim().length > 0 ? { label: label.trim() } : {};
    const wantGroup = groupName !== undefined && groupName.trim().length > 0;
    if (scope === "global") {
      const pins = this.readGlobalPins();
      // Store a local file as its fsPath; a remote/virtual file as its full URI
      // string (so the scheme survives). Dedup on the same stored form.
      const stored = globalStoredPath(uri);
      if (pins.some((p) => p.path === stored)) {
        return false;
      }
      // Global groups live in their own memento; ensure (and persist) the group
      // before the pin so the pin's groupId resolves immediately.
      let groupField: { groupId?: string } = {};
      if (wantGroup) {
        const groups = this.readGlobalGroups();
        const before = groups.length;
        const groupId = this.ensureGroupId(groups, groupName!);
        if (groups.length !== before) {
          await this.writeGlobalGroups(groups);
        }
        groupField = { groupId };
      }
      pins.push({
        id: this.newId(),
        path: stored,
        scope: "global",
        order: pins.length,
        ...labelField,
        ...groupField,
      });
      await this.writeGlobalPins(pins);
      await this.refresh();
      return true;
    }

    // Project scope: find the owning workspace folder and store relative.
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    if (!folder) {
      // File outside any workspace folder cannot be a project pin; caller should
      // offer global instead.
      return false;
    }
    const relative = this.toFolderRelative(folder, uri);
    const file = await this.readProjectFile(folder);
    if (file.pins.some((p) => p.path === relative && p.scope === "project")) {
      return false;
    }
    // The group must live in this same folder's file as the pin — a groupId that
    // pointed at a group in another folder would render as an orphaned membership.
    // ensureGroupId mutates file.groups in place; the writeProjectFile below
    // persists pin and group together in one write.
    const groupField = wantGroup
      ? { groupId: this.ensureGroupId(file.groups, groupName!) }
      : {};
    file.pins.push({
      id: this.newId(),
      path: relative,
      scope: "project",
      order: file.pins.length,
      ...labelField,
      ...groupField,
    });
    await this.writeProjectFile(folder, file);
    await this.refresh();
    return true;
  }

  // Add a "line pin" that opens a file at a specific 1-based line (WOW #22).
  // Unlike addPin, this does NOT dedupe by path: the same file can be pinned to
  // several different lines (each a distinct jump target), so a new pin is always
  // created. Returns false only when a project pin is requested for a file outside
  // any workspace folder (the caller should offer global instead).
  async addLinePin(
    uri: vscode.Uri,
    scope: PinScope,
    line: number,
    label: string
  ): Promise<boolean> {
    if (scope === "global") {
      const pins = this.readGlobalPins();
      pins.push({
        id: this.newId(),
        // Same local-fsPath / remote-URI storage as addPin, so a line pin on a
        // remote file resolves back to the right filesystem.
        path: globalStoredPath(uri),
        scope: "global",
        order: pins.length,
        line,
        label,
      });
      await this.writeGlobalPins(pins);
      await this.refresh();
      return true;
    }
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    if (!folder) {
      return false;
    }
    const file = await this.readProjectFile(folder);
    file.pins.push({
      id: this.newId(),
      path: this.toFolderRelative(folder, uri),
      scope: "project",
      order: file.pins.length,
      line,
      label,
    });
    await this.writeProjectFile(folder, file);
    await this.refresh();
    return true;
  }

  // Add a shell-action pin: a saved command line that runs when the pin is run.
  // Used by the shell-history suggester (WOW #2) to turn a frequently-typed command
  // into a one-click pin. Never runs it — adding only stores it. Project scope
  // writes to the first workspace folder (returns false when none is open); global
  // writes to globalState. A shell pin carries no file path, so a duplicate by path
  // is not meaningful; the same command may be saved more than once.
  async addShellPin(
    label: string,
    shellCommand: string,
    scope: PinScope,
    useIntegratedTerminal: boolean
  ): Promise<boolean> {
    const base = {
      label,
      path: "",
      action: { kind: "shell" as const, shellCommand, useIntegratedTerminal },
    };
    if (scope === "global") {
      const pins = this.readGlobalPins();
      pins.push({ id: this.newId(), scope: "global", order: pins.length, ...base });
      await this.writeGlobalPins(pins);
      await this.refresh();
      return true;
    }
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      return false;
    }
    const file = await this.readProjectFile(folder);
    file.pins.push({
      id: this.newId(),
      scope: "project",
      order: file.pins.length,
      ...base,
    });
    await this.writeProjectFile(folder, file);
    await this.refresh();
    return true;
  }

  // Add a non-action annotation pin — a comment label or a visual separator — that
  // divides a long pin list (Favorites-style comments/dividers). It carries no path
  // and no real action; the kind ("comment" / "separator") lives in `action.kind` so
  // pinKind / isAnnotationPin route it, and a comment's text is its `label`. When
  // `after` is given the entry is inserted immediately below that pin in the same
  // scope and group (so it annotates exactly where the user clicked); otherwise it
  // appends to the top level of `targetFolder` (the favorites importer passes the
  // file's owning folder so an annotation lands in the same folder, and the same
  // source order, as the file pins it sits between) or the first folder when none is
  // given. Returns false only when a project entry is requested with no workspace
  // folder open. Never runs anything — these are inert.
  async addAnnotationPin(
    kind: "comment" | "separator",
    scope: PinScope,
    label: string | undefined,
    after?: Pin,
    targetFolder?: vscode.WorkspaceFolder
  ): Promise<boolean> {
    // An anchor decides scope + group (so an inserted entry lands beside it); a
    // title-bar invocation has no anchor and falls back to the requested scope.
    const targetScope = after?.scope ?? scope;
    const groupId = after?.groupId;
    // Only carry a non-empty label so a separator (or a blank comment) stores none.
    const labelField =
      label && label.trim().length > 0 ? { label: label.trim() } : {};

    if (targetScope === "global") {
      const pins = this.readGlobalPins();
      const newPin: Pin = {
        id: this.newId(),
        path: "",
        scope: "global",
        order: pins.length,
        action: { kind },
        ...(groupId ? { groupId } : {}),
        ...labelField,
      };
      pins.push(newPin);
      this.placeAfter(pins, newPin, after?.id);
      await this.writeGlobalPins(pins);
      await this.refresh();
      return true;
    }

    // Project scope: write to the anchor's owning folder, else the caller's
    // targetFolder (the importer's owning folder), else the first folder.
    const folder = after
      ? this.projectPinFolder.get(after.id) ?? vscode.workspace.workspaceFolders?.[0]
      : targetFolder ?? vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      return false;
    }
    const file = await this.readProjectFile(folder);
    const newPin: Pin = {
      id: this.newId(),
      path: "",
      scope: "project",
      order: file.pins.length,
      action: { kind },
      ...(groupId ? { groupId } : {}),
      ...labelField,
    };
    file.pins.push(newPin);
    this.placeAfter(file.pins, newPin, after?.id);
    await this.writeProjectFile(folder, file);
    await this.refresh();
    return true;
  }

  // Renumber `newPin`'s group so it sits immediately after `afterPinId`, or at the
  // group's end when the anchor is absent / in another group. Mirrors reorderWithin
  // (which renumbers a single group's members from 0), so an inserted annotation
  // positions the same way a drag would. Operates on `all` in place.
  protected placeAfter(
    all: Pin[],
    newPin: Pin,
    afterPinId: string | undefined
  ): void {
    const groupId = newPin.groupId ?? undefined;
    const members = all.filter(
      (p) => (p.groupId ?? undefined) === groupId && p.id !== newPin.id
    );
    const anchorIndex = afterPinId
      ? members.findIndex((p) => p.id === afterPinId)
      : -1;
    const insertAt = anchorIndex >= 0 ? anchorIndex + 1 : members.length;
    const ordered = [
      ...members.slice(0, insertAt),
      newPin,
      ...members.slice(insertAt),
    ];
    ordered.forEach((pin, i) => {
      pin.order = i;
    });
  }

  // Add a pin from a shared link's portable configuration (WOW #4 import). The id
  // and order are freshly assigned; everything else (label, path, action, exec,
  // icon, color, schedule) is carried verbatim. An optional groupId drops the pin
  // straight into an existing group — used by the pin-set import to reconstruct a
  // group membership without a follow-up move. Project scope writes to the first
  // workspace folder's file (returns false when none is open); global writes to
  // globalState. Never runs the pin — importing only adds it.
  async importPin(
    shared: SharedPin,
    scope: PinScope,
    groupId?: string
  ): Promise<boolean> {
    const base = {
      label: shared.label,
      path: shared.path ?? "",
      action: shared.action,
      exec: shared.exec,
      icon: shared.icon,
      color: shared.color,
      schedule: shared.schedule,
      // Only carry a groupId when given, so an ungrouped import stays top-level
      // rather than storing an undefined membership.
      ...(groupId ? { groupId } : {}),
    };
    if (scope === "global") {
      const pins = this.readGlobalPins();
      pins.push({ id: this.newId(), scope: "global", order: pins.length, ...base });
      await this.writeGlobalPins(pins);
      await this.refresh();
      return true;
    }
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      return false;
    }
    const file = await this.readProjectFile(folder);
    file.pins.push({
      id: this.newId(),
      scope: "project",
      order: file.pins.length,
      ...base,
    });
    await this.writeProjectFile(folder, file);
    await this.refresh();
    return true;
  }

  async removePin(pin: Pin): Promise<void> {
    if (pin.scope === "global") {
      const pins = this.readGlobalPins().filter((p) => p.id !== pin.id);
      await this.writeGlobalPins(pins);
      await this.refresh();
      return;
    }

    const folder = this.projectPinFolder.get(pin.id);
    if (!folder) {
      return;
    }
    const file = await this.readProjectFile(folder);
    if (pin.isAuto) {
      // Auto-pins are not stored in pins[]; suppress re-seeding instead.
      if (!file.removedAutoPins.includes(pin.id)) {
        file.removedAutoPins.push(pin.id);
      }
    } else if (pin.isRecipe && pin.recipeId) {
      // Recipe pins are detected, not stored; suppress by recipeId so removal is
      // sticky (the Restore Recipes command clears these suppressions).
      if (!file.removedRecipes.includes(pin.recipeId)) {
        file.removedRecipes.push(pin.recipeId);
      }
    } else {
      file.pins = file.pins.filter((p) => p.id !== pin.id);
    }
    await this.writeProjectFile(folder, file);
    await this.refresh();
  }

  async renamePin(pin: Pin, label: string): Promise<void> {
    const trimmed = label.trim();
    if (pin.scope === "global") {
      const pins = this.readGlobalPins();
      const target = pins.find((p) => p.id === pin.id);
      if (target) {
        target.label = trimmed || undefined;
        await this.writeGlobalPins(pins);
        await this.refresh();
      }
      return;
    }
    const folder = this.projectPinFolder.get(pin.id);
    if (!folder) {
      return;
    }
    const file = await this.readProjectFile(folder);
    const target = file.pins.find((p) => p.id === pin.id);
    if (target) {
      target.label = trimmed || undefined;
      await this.writeProjectFile(folder, file);
      await this.refresh();
    }
  }

  // Re-point a pin at a different file — the "relocate" fix for a pin whose target
  // was moved or renamed. A global pin stores the absolute path; a project pin
  // stores a folder-relative path and so can only point inside its own workspace
  // folder (a relative path cannot reach a sibling folder), which is rejected with
  // `false` so the caller can tell the user. Returns whether the path was written.
  async updatePinPath(pin: Pin, uri: vscode.Uri): Promise<boolean> {
    if (pin.scope === "global") {
      return this.mutatePin(pin, (target) => {
        // Keep the local-fsPath / remote-URI storage convention so re-pointing a
        // global pin to a remote/virtual file preserves its scheme.
        target.path = globalStoredPath(uri);
      });
    }
    const folder = this.projectPinFolder.get(pin.id);
    if (!folder) {
      return false;
    }
    // A project pin must resolve inside its owning folder; a file picked elsewhere
    // cannot be stored folder-relative without escaping the folder.
    const owner = vscode.workspace.getWorkspaceFolder(uri);
    if (owner?.uri.toString() !== folder.uri.toString()) {
      return false;
    }
    const relative = this.toFolderRelative(folder, uri);
    return this.mutatePin(pin, (target) => {
      target.path = relative;
    });
  }

  // Find the stored pin by id in its owning store, apply a mutation, persist, and
  // refresh. Touches only what `apply` changes, so a concurrent edit to another
  // field is not clobbered. Auto-pins are not stored in pins[], so there is no
  // target and this is a silent no-op (callers gate them out). Returns whether a
  // target was found and written.
  protected async mutatePin(
    pin: Pin,
    apply: (target: Pin) => void
  ): Promise<boolean> {
    if (pin.scope === "global") {
      const pins = this.readGlobalPins();
      const target = pins.find((p) => p.id === pin.id);
      if (!target) {
        return false;
      }
      apply(target);
      await this.writeGlobalPins(pins);
      await this.refresh();
      return true;
    }
    const folder = this.projectPinFolder.get(pin.id);
    if (!folder) {
      return false;
    }
    const file = await this.readProjectFile(folder);
    const target = file.pins.find((p) => p.id === pin.id);
    if (!target) {
      return false;
    }
    apply(target);
    await this.writeProjectFile(folder, file);
    await this.refresh();
    return true;
  }
}
