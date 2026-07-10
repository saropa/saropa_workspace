import * as vscode from "vscode";
import { Shortcut, ShortcutGroup, DEFAULT_SET_NAME, shortcutKind } from "./shortcut";
import { DEFAULT_GROUPS, setsEqual } from "./shortcutStoreShared";
import { ShortcutStoreRecipeSeed } from "./shortcutStoreRecipeSeed";

// Recompute layer: refresh()/rescan() rebuild the cached shortcut/group state from
// the project files + global state, then the async missing-file stat pass runs off
// the first paint. The recipe-seeding sweep this used to also own now lives in
// ShortcutStoreRecipeSeed (split out to keep this file under the project's
// line-count cap) — refresh() still kicks it off, it just no longer defines it.
export abstract class ShortcutStoreRefresh extends ShortcutStoreRecipeSeed {
  async init(): Promise<void> {
    await this.refresh();
  }

  async rescan(): Promise<void> {
    this.autoShortcutScanCache.clear();
    this.recipeResultsCache.clear();
    await this.refresh();
  }

  // Recompute cached project + global shortcuts (including freshly seeded auto-
  // shortcuts) and notify listeners (the tree) to repaint.
  async refresh(): Promise<void> {
    this.projectShortcutFolder.clear();
    this.projectGroupFolder.clear();

    const project: Shortcut[] = [];
    const projectGroups: ShortcutGroup[] = [];
    const folders = vscode.workspace.workspaceFolders ?? [];
    const patterns = this.autoShortcutPatterns();

    // Recompute the cached set state from the files read below. The first folder's
    // active set is authoritative for the switcher's label; the names union spans
    // every folder so a set created in one is offered everywhere.
    let firstActiveSet: string | undefined;
    const setNames = new Set<string>();

    for (const folder of folders) {
      const data = await this.collectProjectFolderData(folder, patterns);
      if (firstActiveSet === undefined) {
        firstActiveSet = data.activeSet;
      }
      for (const name of data.setNames) {
        setNames.add(name);
      }
      projectGroups.push(...data.groups);
      project.push(...data.shortcuts);
    }

    // Publish the cached set state. With no folder open there are no project sets,
    // so the default name is shown and the switcher hides itself (see SetStatusBar).
    this.activeSetName = firstActiveSet ?? DEFAULT_SET_NAME;
    this.setNamesCache = Array.from(setNames).sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" })
    );

    project.sort((a, b) => a.order - b.order);
    // Pass this refresh's own folder snapshot rather than re-reading
    // vscode.workspace.workspaceFolders inside injectDefaultGroups: a folder add/remove
    // firing mid-refresh (each collectProjectFolderData call above awaits file IO) must
    // not let this check see a different folder set than the one refresh() actually
    // iterated over.
    this.injectDefaultGroups(projectGroups, folders.length > 0);

    // Cache the non-recipe ("base") set and render it immediately. Recipe
    // detection is filesystem-heavy across (potentially many) folders, so it must
    // NOT block this first paint or the activation that awaits refresh(); it
    // streams in via seedRecipesAsync below. (Bug fix: detection ran inline here
    // and could stall the view in a multi-root workspace — "recipes never load".)
    this.baseProjectShortcuts = project;
    this.projectShortcuts = project;
    this.projectGroups = [...projectGroups].sort((a, b) => a.order - b.order);
    this.globalShortcuts = this.readGlobalShortcuts().sort((a, b) => a.order - b.order);
    this.globalGroups = this.readGlobalGroups().sort((a, b) => a.order - b.order);

    this._onDidChange.fire();

    // Detect recipes off the blocking path; a later fire merges them in.
    void this.seedRecipesAsync(++this.recipeGen);

    // Stat file pins off the blocking path; a later fire flags any that vanished.
    void this.recomputeMissing(++this.missingGen);
  }

  // The per-folder body of refresh(): ensure+read the project file, then gather its
  // set names, user groups, and every shortcut it contributes (explicit, seeded
  // auto-shortcuts, and the synthetic config-example). Folder-ownership maps
  // (projectGroupFolder / projectShortcutFolder) are populated here since every
  // entry is keyed off `folder` anyway; the rest is returned for refresh() to
  // accumulate across all folders.
  protected async collectProjectFolderData(
    folder: vscode.WorkspaceFolder,
    patterns: string[]
  ): Promise<{
    activeSet: string;
    setNames: string[];
    groups: ShortcutGroup[];
    shortcuts: Shortcut[];
  }> {
    // Create the config file up front for any folder that lacks one, so every
    // opened project gets a committed, shareable .vscode/saropa-workspace.json
    // immediately — not only after the first pin is added.
    await this.ensureProjectFile(folder);
    const file = await this.readProjectFile(folder);

    // The active set's name from this folder, plus every set name it knows, feed
    // the switcher's cached state (read synchronously by the status-bar item).
    const setNames = new Set<string>();
    setNames.add(file.activeSet);
    for (const s of file.sets) {
      setNames.add(s.name);
    }

    const groups: ShortcutGroup[] = [];
    // User groups for this folder.
    for (const group of file.groups) {
      this.projectGroupFolder.set(group.id, folder);
      groups.push(group);
    }

    const shortcuts: Shortcut[] = [];
    // Stored explicit shortcuts.
    for (const shortcut of file.pins) {
      shortcut.scope = "project";
      this.projectShortcutFolder.set(shortcut.id, folder);
      shortcuts.push(shortcut);
    }

    // Seeded auto-shortcuts, minus the ones the user removed, each re-attached to
    // any folder the user dragged it into (persisted in file.autoGroups).
    const autoShortcuts = await this.seedAutoShortcuts(
      folder,
      patterns,
      file.removedAutoPins,
      file.autoGroups
    );
    for (const shortcut of autoShortcuts) {
      this.projectShortcutFolder.set(shortcut.id, folder);
      shortcuts.push(shortcut);
    }

    // Always surface a "Workspace config" example shortcut linking to the folder's
    // own config file, so every project shows at least one usable shortcut (the
    // user's entry point for editing shortcuts) — not an empty Project scope.
    // Synthesized like an auto-shortcut (recomputed, not stored), so removal sticks
    // via removedAutoPins and a hand-emptied file still gets it back. Skipped
    // when an explicit/auto shortcut already targets the config file, so a project
    // that stores its own config shortcut (e.g. this repo's committed sample) is not
    // duplicated.
    const configShortcut = this.configExampleShortcut(folder, file, autoShortcuts);
    if (configShortcut) {
      this.projectShortcutFolder.set(configShortcut.id, folder);
      shortcuts.push(configShortcut);
    }

    return {
      activeSet: file.activeSet,
      setNames: Array.from(setNames),
      groups,
      shortcuts,
    };
  }

  // Inject the built-in default groups (Build / Run / Deploy / Test / Docs / Data /
  // Code) so the Project scope always offers a usable structure. These are synthetic
  // (not in any project file), so they show even when EMPTY without writing seven
  // folders into the committed config; a stored shortcut joins one by carrying its id
  // in groupId (auto-assigned on add, or chosen by a promoted recipe). Pushed once
  // (not per folder) and only when enabled AND a folder is open — their shortcuts must
  // live in a workspace folder. Collapse posture comes from globalState (no file entry
  // to hold it); they are deliberately NOT registered in projectGroupFolder, so a drop
  // resolves the owning folder from the dropped shortcut instead (see moveProjectShortcuts).
  protected injectDefaultGroups(projectGroups: ShortcutGroup[], hasOpenFolder: boolean): void {
    if (!this.defaultGroupsEnabled() || !hasOpenFolder) {
      return;
    }
    // A default group whose label collides with a hand-made project group is NOT
    // injected — the user's own group wins, so the scope never shows two folders with
    // the same name (e.g. a user "Build" group and the built-in "Build"). Auto-assign
    // and recipe promotion file into that existing user group instead (see
    // effectiveDefaultGroupId), so the membership lands in the folder that renders.
    const userGroupLabels = new Set(
      projectGroups.map((g) => g.label.trim().toLowerCase())
    );
    for (const def of DEFAULT_GROUPS) {
      if (userGroupLabels.has(def.label.toLowerCase())) {
        continue;
      }
      projectGroups.push({
        id: def.id,
        label: def.label,
        order: def.order,
        collapsed: !this.defaultGroupExpanded(def.id),
        icon: def.icon,
        color: def.color,
      });
    }
  }

  // Stat every resolved file shortcut and record the ones whose target is gone, so
  // the tree can flag a deleted shortcut instead of letting a click hit a raw "file
  // does not exist" error. Runs after the first paint (never blocks activation) and
  // repaints only when the missing set changed. Recipe / url / shell / command /
  // macro shortcuts are skipped: they have no single file on disk. A shortcut whose
  // owning folder cannot be resolved is skipped here too — that distinct state is
  // already flagged by the tree's !resolvedUri branch, so counting it here would
  // double-handle it.
  protected async recomputeMissing(gen: number): Promise<void> {
    const fileShortcuts = [...this.projectShortcuts, ...this.globalShortcuts].filter(
      (p) => !p.isRecipe && shortcutKind(p) === "file"
    );
    const next = new Set<string>();
    await Promise.all(
      fileShortcuts.map(async (shortcut) => {
        const uri = this.resolveUri(shortcut);
        if (!uri) {
          return;
        }
        try {
          await vscode.workspace.fs.stat(uri);
        } catch {
          // Absent on disk — the deleted/moved case this flag exists for.
          next.add(shortcut.id);
        }
      })
    );
    // A newer refresh superseded this run while we were statting: drop the result.
    if (gen !== this.missingGen) {
      return;
    }
    if (!setsEqual(this.missingShortcutIds, next)) {
      this.missingShortcutIds = next;
      this._onDidChange.fire();
    }
  }
}
