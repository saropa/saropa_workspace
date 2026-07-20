import * as vscode from "vscode";
import { Shortcut, ShortcutExecConfig, ShortcutScope } from "./shortcut";
import { globalStoredPath } from "./shortcutPaths";
import { SharedShortcut } from "../import/shareLink";
import { ShortcutStoreAdd } from "./shortcutStoreAdd";

// Core mutation layer: import / duplicate / remove / rename / re-point shortcuts,
// plus the shared mutateShortcut (find-apply-persist-refresh) helper the update/set
// toggles in ShortcutStoreMutation build on. The add-family (addShortcut and its
// siblings) lives in ShortcutStoreAdd — split out purely to keep this file under the
// project's line-count cap.
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
          (m.recipeId === undefined && m.pinId === removed.id)
        )
    );
    dropped += members.length - kept.length;
    action.members = kept;
  }
  return dropped;
}

export abstract class ShortcutStoreMutationCore extends ShortcutStoreAdd {
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

  // Duplicate a stored file shortcut into a new sibling entry that points at the SAME
  // file but runs with a different argument line — the "make a run variant" gesture
  // (run this script again, but with -o). The copy carries the source's run config
  // (interpreter, cwd, env, run location) with only the args replaced, plus its group,
  // icon, and color for visual continuity. Two flags are carried deliberately because
  // dropping them would change behavior, not just presentation: `masked` (WOW #26 screen-
  // share guard) MUST survive or a duplicate of a masked secret (.env.production) would
  // expose the filename in the tree; `line` MUST survive so a line-shortcut's duplicate
  // opens at the same line. It deliberately does NOT inherit the source's schedule,
  // triggers, metric, expiry, tags, or branch link: schedule/triggers/metric/expiry are
  // per-instance automation (copying a schedule would silently double-schedule the same
  // script), and a fresh run variant starts un-tagged and branch-unscoped rather than
  // inheriting an organization the user set for the original. The new entry is inserted
  // immediately below the source in the same scope and group (placeAfter). Returns false
  // only when the source is not stored in its own store (an auto/recipe shortcut is
  // recomputed, not stored, so there is nothing to duplicate).
  async duplicateShortcut(
    shortcut: Shortcut,
    label: string,
    args: string[]
  ): Promise<boolean> {
    const trimmedLabel = label.trim();
    // Merge the new args over any existing exec so the interpreter/cwd/env/run-location
    // survive; an empty args line clears the field so the variant carries no inert array.
    const execCandidate: ShortcutExecConfig = {
      ...(shortcut.exec ?? {}),
      args: args.length > 0 ? args : undefined,
    };
    const hasExec = Object.values(execCandidate).some((v) => v !== undefined);
    const carry: Partial<Shortcut> = {
      action: shortcut.action,
      icon: shortcut.icon,
      color: shortcut.color,
      ...(hasExec ? { exec: execCandidate } : {}),
      ...(shortcut.groupId ? { groupId: shortcut.groupId } : {}),
      // Carry the screen-share guard and the open-at-line target (see the method doc):
      // both are behavior, not decoration, so they must not be silently dropped.
      ...(shortcut.masked ? { masked: true } : {}),
      ...(shortcut.line !== undefined ? { line: shortcut.line } : {}),
      ...(trimmedLabel ? { label: trimmedLabel } : {}),
    };

    if (shortcut.scope === "global") {
      const shortcuts = this.readGlobalShortcuts();
      if (!shortcuts.some((p) => p.id === shortcut.id)) {
        return false;
      }
      const created: Shortcut = {
        id: this.newId(),
        path: shortcut.path,
        scope: "global",
        order: shortcuts.length,
        ...carry,
      };
      shortcuts.push(created);
      this.placeAfter(shortcuts, created, shortcut.id);
      await this.writeGlobalShortcuts(shortcuts);
      await this.refresh();
      return true;
    }

    const folder = this.projectShortcutFolder.get(shortcut.id);
    if (!folder) {
      return false;
    }
    const file = await this.readProjectFile(folder);
    if (!file.pins.some((p) => p.id === shortcut.id)) {
      return false;
    }
    const created: Shortcut = {
      id: this.newId(),
      path: shortcut.path,
      scope: "project",
      order: file.pins.length,
      ...carry,
    };
    file.pins.push(created);
    this.placeAfter(file.pins, created, shortcut.id);
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
      // Auto-shortcuts are not stored in pins[], suppress re-seeding instead.
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
    // Removing a shortcut must also unlink it from every routine that runs it.
    // Without this, the routine kept a member that could never resolve again — a
    // removed recipe is suppressed by recipeId forever, so the member reported
    // "Shortcut not found" on every run with no way to reach a working state
    // except hand-editing the JSON (user report 2026-07-20, a Morning routine
    // whose lint sweep had been removed months earlier).
    pruneRoutineMembers(file.pins, shortcut);
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
