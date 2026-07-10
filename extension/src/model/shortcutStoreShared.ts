import { ShortcutScope } from "./shortcut";

// Shared constants, helpers, and the MoveTarget type for the ShortcutStore class
// chain (pinStoreBase -> pinStoreRecipes -> pinStoreRefresh -> pinStoreMutation ->
// pinStoreSets -> ShortcutStore). Kept in one leaf module so every class layer
// imports them without duplication. The recipe-group and default-group definitions
// used to live here too; they are split into shortcutStoreRecipeGroups.ts and
// shortcutStoreDefaultGroups.ts (this file's line count was over the project's cap)
// and re-exported below so every existing `from "./shortcutStoreShared"` import
// keeps working unchanged, matching the barrel convention already used by
// model/shortcut.ts.
export * from "./shortcutStoreRecipeGroups";
export * from "./shortcutStoreDefaultGroups";

// A drop destination computed by the tree's drag-and-drop controller and handed
// to ShortcutStore.moveShortcuts. `groupId` undefined means the scope's top level;
// `beforeShortcutId` inserts ahead of that sibling, otherwise the moved shortcuts append.
export interface MoveTarget {
  scope: ShortcutScope;
  groupId?: string;
  beforeShortcutId?: string;
}

// Persistence + in-memory cache for shortcuts.
//
// Project shortcuts live in <folder>/.vscode/saropa-workspace.json with paths stored
// RELATIVE to that folder, so a shortcut survives clone/move and is shareable via the
// repo. Global shortcuts live in extension globalState (rides VS Code Settings Sync)
// with ABSOLUTE paths, since a global favorite is a specific machine path.
//
// Auto-shortcuts (from autoPins.patterns) are NOT persisted as data; they are
// recomputed each refresh and merged into the project group. Removing one records
// its id in removedAutoPins so it is not re-seeded.

export const GLOBAL_STATE_KEY = "saropaWorkspace.globalPins";
export const GLOBAL_GROUPS_KEY = "saropaWorkspace.globalGroups";

// True when an auto-shortcut pattern uses glob syntax that needs the workspace search
// service to expand (recursion `**`, wildcards `*`/`?`, character classes, or
// brace alternation). A pattern with none of these is a literal relative path and
// is resolved with a direct fs.stat instead — see scanAutoShortcutPaths.
export function isGlobPattern(pattern: string): boolean {
  return /[*?{}[\]]/.test(pattern);
}

// True when two id sets hold exactly the same members. Used to skip a redundant
// tree repaint when a refresh leaves the missing-file set unchanged (the common
// case), since the stat pass runs after every refresh.
export function setsEqual(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) {
    return false;
  }
  for (const value of a) {
    if (!b.has(value)) {
      return false;
    }
  }
  return true;
}

// Shortcut-set names are compared case-insensitively for duplicate detection (so
// "Release" and "release" are treated as the same set), while their stored,
// display, and lookup form keeps the user's original casing. A pure case change
// on rename is therefore allowed — the caller excludes the old name explicitly.
export function sameSetName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}
