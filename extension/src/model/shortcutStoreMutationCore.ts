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
  matchDefaultGroup,
  defaultGroupLabel,
  isDefaultGroupId,
  isGlobPattern,
  setsEqual,
  sameSetName,
} from "./shortcutStoreShared";
import { ShortcutStoreRefresh } from "./shortcutStoreRefresh";

// Core mutation layer: add / import / remove / rename / re-point shortcuts, plus the
// shared placeAfter (ordered insert) and mutateShortcut (find-apply-persist-refresh)
// helpers the update/set toggles in ShortcutStoreMutation build on.
export abstract class ShortcutStoreMutationCore extends ShortcutStoreRefresh {
  async addShortcut(
    uri: vscode.Uri,
    scope: ShortcutScope,
    label?: string,
    groupName?: string,
    // Bulk callers (the favorites importer) reconstruct an explicit group structure and
    // pass autoGroup:false so an unparented entry stays at the top level instead of being
    // re-sorted into a default group — that would scramble the imported layout. An
    // interactive single-file add leaves it default (true), where name/type auto-sorting
    // is the wanted behavior.
    options: { autoGroup?: boolean } = {}
  ): Promise<boolean> {
    // Only carry a non-empty label so a shortcut without an alias keeps the basename
    // default rather than storing an empty override.
    const labelField = label && label.trim().length > 0 ? { label: label.trim() } : {};
    const wantGroup = groupName !== undefined && groupName.trim().length > 0;
    if (scope === "global") {
      const shortcuts = this.readGlobalShortcuts();
      // Store a local file as its fsPath; a remote/virtual file as its full URI
      // string (so the scheme survives). Dedup on the same stored form.
      const stored = globalStoredPath(uri);
      if (shortcuts.some((p) => p.path === stored)) {
        return false;
      }
      // Global groups live in their own memento; ensure (and persist) the group
      // before the shortcut so the shortcut's groupId resolves immediately.
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
      shortcuts.push({
        id: this.newId(),
        path: stored,
        scope: "global",
        order: shortcuts.length,
        ...labelField,
        ...groupField,
      });
      await this.writeGlobalShortcuts(shortcuts);
      await this.refresh();
      return true;
    }

    // Project scope: find the owning workspace folder and store relative.
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    if (!folder) {
      // File outside any workspace folder cannot be a project shortcut; caller should
      // offer global instead.
      return false;
    }
    const relative = this.toFolderRelative(folder, uri);
    const file = await this.readProjectFile(folder);
    if (file.pins.some((p) => p.path === relative && p.scope === "project")) {
      return false;
    }
    // The group must live in this same folder's file as the shortcut — a groupId that
    // pointed at a group in another folder would render as an orphaned membership.
    // ensureGroupId mutates file.groups in place; the writeProjectFile below
    // persists shortcut and group together in one write.
    //
    // When the caller named no group, sort the new file into a built-in default group by
    // its name/type (matchDefaultGroup, e.g. a "publish" file -> Deploy, a .md -> Docs),
    // but only when default groups are enabled. The matched id is a SYNTHETIC default-
    // group id, so — unlike a user group — it is deliberately NOT added to file.groups;
    // the group is injected at render time, not stored. A file matching no rule keeps no
    // groupId and stays at the scope's top level (the prior behavior).
    const matchedDefault =
      !wantGroup && (options.autoGroup ?? true) && this.defaultGroupsEnabled()
        ? matchDefaultGroup(relative)
        : undefined;
    const autoGroupId = matchedDefault
      ? this.effectiveDefaultGroupId(file.groups, matchedDefault)
      : undefined;
    const groupField = wantGroup
      ? { groupId: this.ensureGroupId(file.groups, groupName!) }
      : autoGroupId
        ? { groupId: autoGroupId }
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

  // Add a "line shortcut" that opens a file at a specific 1-based line (WOW #22).
  // Unlike addShortcut, this does NOT dedupe by path: the same file can have several
  // shortcuts to different lines (each a distinct jump target), so a new shortcut is
  // always created. Returns false only when a project shortcut is requested for a
  // file outside any workspace folder (the caller should offer global instead).
  async addLineShortcut(
    uri: vscode.Uri,
    scope: ShortcutScope,
    line: number,
    label: string
  ): Promise<boolean> {
    if (scope === "global") {
      const shortcuts = this.readGlobalShortcuts();
      shortcuts.push({
        id: this.newId(),
        // Same local-fsPath / remote-URI storage as addShortcut, so a line shortcut
        // on a remote file resolves back to the right filesystem.
        path: globalStoredPath(uri),
        scope: "global",
        order: shortcuts.length,
        line,
        label,
      });
      await this.writeGlobalShortcuts(shortcuts);
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

  // Add a shell-action shortcut: a saved command line that runs when the shortcut is
  // run. Used by the shell-history suggester (WOW #2) to turn a frequently-typed
  // command into a one-click shortcut. Never runs it — adding only stores it. Project
  // scope writes to the first workspace folder (returns false when none is open);
  // global writes to globalState. A shell shortcut carries no file path, so a
  // duplicate by path is not meaningful; the same command may be saved more than once.
  async addShellShortcut(
    label: string,
    shellCommand: string,
    scope: ShortcutScope,
    useIntegratedTerminal: boolean
  ): Promise<boolean> {
    const base = {
      label,
      path: "",
      action: { kind: "shell" as const, shellCommand, useIntegratedTerminal },
    };
    if (scope === "global") {
      const shortcuts = this.readGlobalShortcuts();
      shortcuts.push({ id: this.newId(), scope: "global", order: shortcuts.length, ...base });
      await this.writeGlobalShortcuts(shortcuts);
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

  // Add a non-action annotation shortcut — a comment label or a visual separator —
  // that divides a long shortcut list (Favorites-style comments/dividers). It carries
  // no path and no real action; the kind ("comment" / "separator") lives in
  // `action.kind` so shortcutKind / isAnnotationShortcut route it, and a comment's
  // text is its `label`. When `after` is given the entry is inserted immediately below
  // that shortcut in the same scope and group (so it annotates exactly where the user
  // clicked); otherwise it appends to the top level of `targetFolder` (the favorites
  // importer passes the file's owning folder so an annotation lands in the same
  // folder, and the same source order, as the file shortcuts it sits between) or the
  // first folder when none is given. Returns false only when a project entry is
  // requested with no workspace folder open. Never runs anything — these are inert.
  async addAnnotationShortcut(
    kind: "comment" | "separator",
    scope: ShortcutScope,
    label: string | undefined,
    after?: Shortcut,
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
      const shortcuts = this.readGlobalShortcuts();
      const newShortcut: Shortcut = {
        id: this.newId(),
        path: "",
        scope: "global",
        order: shortcuts.length,
        action: { kind },
        ...(groupId ? { groupId } : {}),
        ...labelField,
      };
      shortcuts.push(newShortcut);
      this.placeAfter(shortcuts, newShortcut, after?.id);
      await this.writeGlobalShortcuts(shortcuts);
      await this.refresh();
      return true;
    }

    // Project scope: write to the anchor's owning folder, else the caller's
    // targetFolder (the importer's owning folder), else the first folder.
    const folder = after
      ? this.projectShortcutFolder.get(after.id) ?? vscode.workspace.workspaceFolders?.[0]
      : targetFolder ?? vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      return false;
    }
    const file = await this.readProjectFile(folder);
    const newShortcut: Shortcut = {
      id: this.newId(),
      path: "",
      scope: "project",
      order: file.pins.length,
      action: { kind },
      ...(groupId ? { groupId } : {}),
      ...labelField,
    };
    file.pins.push(newShortcut);
    this.placeAfter(file.pins, newShortcut, after?.id);
    await this.writeProjectFile(folder, file);
    await this.refresh();
    return true;
  }

  // Renumber `newShortcut`'s group so it sits immediately after `afterShortcutId`, or
  // at the group's end when the anchor is absent / in another group. Mirrors
  // reorderWithin (which renumbers a single group's members from 0), so an inserted
  // annotation positions the same way a drag would. Operates on `all` in place.
  protected placeAfter(
    all: Shortcut[],
    newShortcut: Shortcut,
    afterShortcutId: string | undefined
  ): void {
    const groupId = newShortcut.groupId ?? undefined;
    const members = all.filter(
      (p) => (p.groupId ?? undefined) === groupId && p.id !== newShortcut.id
    );
    const anchorIndex = afterShortcutId
      ? members.findIndex((p) => p.id === afterShortcutId)
      : -1;
    const insertAt = anchorIndex >= 0 ? anchorIndex + 1 : members.length;
    const ordered = [
      ...members.slice(0, insertAt),
      newShortcut,
      ...members.slice(insertAt),
    ];
    ordered.forEach((shortcut, i) => {
      shortcut.order = i;
    });
  }

  // Resolve which group a default-group assignment should actually land in, given the
  // groups already in a folder's file. When the user has hand-made a group with the SAME
  // label as the matched built-in group (e.g. their own "Build"), refresh suppresses the
  // duplicate synthetic folder, so the user's group is the one that renders — file the
  // shortcut into ITS id, not the synthetic "default:build", or the shortcut would point
  // at a hidden folder and float to the top level. With no such collision the synthetic
  // default id is used as-is. Match is case-insensitive on the label, mirroring the
  // suppression test in refresh and ensurePromotionGroup's reuse logic.
  protected effectiveDefaultGroupId(
    groups: ShortcutGroup[],
    defaultGroupId: string
  ): string {
    const label = defaultGroupLabel(defaultGroupId);
    if (!label) {
      return defaultGroupId;
    }
    const wanted = label.toLowerCase();
    const existing = groups.find(
      (g) => !isDefaultGroupId(g.id) && g.label.trim().toLowerCase() === wanted
    );
    return existing?.id ?? defaultGroupId;
  }

  // Add a shortcut from a shared link's portable configuration (WOW #4 import). The id
  // and order are freshly assigned; everything else (label, path, action, exec,
  // icon, color, schedule) is carried verbatim. An optional groupId drops the shortcut
  // straight into an existing group — used by the shortcut-set import to reconstruct a
  // group membership without a follow-up move. Project scope writes to the first
  // workspace folder's file (returns false when none is open); global writes to
  // globalState. Never runs the shortcut — importing only adds it.
  async importShortcut(
    shared: SharedShortcut,
    scope: ShortcutScope,
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
      const shortcuts = this.readGlobalShortcuts();
      shortcuts.push({ id: this.newId(), scope: "global", order: shortcuts.length, ...base });
      await this.writeGlobalShortcuts(shortcuts);
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

  async removeShortcut(shortcut: Shortcut): Promise<void> {
    if (shortcut.scope === "global") {
      const shortcuts = this.readGlobalShortcuts().filter((p) => p.id !== shortcut.id);
      await this.writeGlobalShortcuts(shortcuts);
      await this.refresh();
      return;
    }

    const folder = this.projectShortcutFolder.get(shortcut.id);
    if (!folder) {
      return;
    }
    const file = await this.readProjectFile(folder);
    if (shortcut.isAuto) {
      // Auto-shortcuts are not stored in pins[]; suppress re-seeding instead.
      if (!file.removedAutoPins.includes(shortcut.id)) {
        file.removedAutoPins.push(shortcut.id);
      }
    } else if (shortcut.isRecipe && shortcut.recipeId) {
      // Recipe shortcuts are detected, not stored; suppress by recipeId so removal is
      // sticky (the Restore Recipes command clears these suppressions).
      if (!file.removedRecipes.includes(shortcut.recipeId)) {
        file.removedRecipes.push(shortcut.recipeId);
      }
    } else {
      file.pins = file.pins.filter((p) => p.id !== shortcut.id);
    }
    await this.writeProjectFile(folder, file);
    await this.refresh();
  }

  async renameShortcut(shortcut: Shortcut, label: string): Promise<void> {
    const trimmed = label.trim();
    if (shortcut.scope === "global") {
      const shortcuts = this.readGlobalShortcuts();
      const target = shortcuts.find((p) => p.id === shortcut.id);
      if (target) {
        target.label = trimmed || undefined;
        await this.writeGlobalShortcuts(shortcuts);
        await this.refresh();
      }
      return;
    }
    const folder = this.projectShortcutFolder.get(shortcut.id);
    if (!folder) {
      return;
    }
    const file = await this.readProjectFile(folder);
    const target = file.pins.find((p) => p.id === shortcut.id);
    if (target) {
      target.label = trimmed || undefined;
      await this.writeProjectFile(folder, file);
      await this.refresh();
    }
  }

  // Re-point a shortcut at a different file — the "relocate" fix for a shortcut whose
  // target was moved or renamed. A global shortcut stores the absolute path; a project
  // shortcut stores a folder-relative path and so can only point inside its own
  // workspace folder (a relative path cannot reach a sibling folder), which is
  // rejected with `false` so the caller can tell the user. Returns whether the path
  // was written.
  async updateShortcutPath(shortcut: Shortcut, uri: vscode.Uri): Promise<boolean> {
    if (shortcut.scope === "global") {
      return this.mutateShortcut(shortcut, (target) => {
        // Keep the local-fsPath / remote-URI storage convention so re-pointing a
        // global shortcut to a remote/virtual file preserves its scheme.
        target.path = globalStoredPath(uri);
      });
    }
    const folder = this.projectShortcutFolder.get(shortcut.id);
    if (!folder) {
      return false;
    }
    // A project shortcut must resolve inside its owning folder; a file picked
    // elsewhere cannot be stored folder-relative without escaping the folder.
    const owner = vscode.workspace.getWorkspaceFolder(uri);
    if (owner?.uri.toString() !== folder.uri.toString()) {
      return false;
    }
    const relative = this.toFolderRelative(folder, uri);
    return this.mutateShortcut(shortcut, (target) => {
      target.path = relative;
    });
  }

  // Find the stored shortcut by id in its owning store, apply a mutation, persist, and
  // refresh. Touches only what `apply` changes, so a concurrent edit to another
  // field is not clobbered. Auto-shortcuts are not stored in pins[], so there is no
  // target and this is a silent no-op (callers gate them out). Returns whether a
  // target was found and written.
  protected async mutateShortcut(
    shortcut: Shortcut,
    apply: (target: Shortcut) => void
  ): Promise<boolean> {
    if (shortcut.scope === "global") {
      const shortcuts = this.readGlobalShortcuts();
      const target = shortcuts.find((p) => p.id === shortcut.id);
      if (!target) {
        return false;
      }
      apply(target);
      await this.writeGlobalShortcuts(shortcuts);
      await this.refresh();
      return true;
    }
    const folder = this.projectShortcutFolder.get(shortcut.id);
    if (!folder) {
      return false;
    }
    const file = await this.readProjectFile(folder);
    const target = file.pins.find((p) => p.id === shortcut.id);
    if (!target) {
      return false;
    }
    apply(target);
    await this.writeProjectFile(folder, file);
    await this.refresh();
    return true;
  }
}
