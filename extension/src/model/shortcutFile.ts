// On-disk persistence shapes: user groups, named shortcut sets, and the per-folder project
// file, plus its version/default-set constants and the empty-file factory. Split out of
// shortcut.ts (which re-exports these) to keep that file under the line cap.
import { Shortcut } from "./shortcut";

// A user-defined group (folder) that holds shortcuts, nested under a scope root.
// Project groups live in each folder's ProjectShortcutsFile; global groups live in
// extension globalState. A group's id is referenced by Shortcut.groupId.
export interface ShortcutGroup {
  // Stable id, unique within its scope, referenced by Shortcut.groupId.
  id: string;
  label: string;
  // Sort order among groups under the same scope root.
  order: number;
  // Optional parent group id for a nested subgroup. Undefined = a top-level group
  // directly under the scope/section root. The synthetic recipe groups use this to
  // nest a per-tool subgroup (Saropa Lints / Drift Advisor / Log Capture) under the
  // "Saropa Suite" group: the tree renders a group carrying a parentId as a child of
  // that parent rather than at the root. User groups leave it undefined — group
  // nesting is not exposed for hand-made groups.
  parentId?: string;
  // Persisted collapse state so a folder stays the way the user left it.
  collapsed?: boolean;
  // Optional tree-icon override: a codicon id WITHOUT $(...), e.g. "github". Set on
  // the synthetic recipe category groups so each subfolder reads distinctly; user
  // groups leave it undefined and render the default "folder" glyph.
  icon?: string;
  // Optional theme-color id for the icon (a ThemeColor key like "charts.green",
  // never a raw hex). Paired with icon on the recipe groups.
  color?: string;
}

// Current on-disk schema version. Bumped 1->2 to add `groups`, and 2->3 to add
// named shortcut sets (`activeSet` + `sets`). Older files are migrated on read: a v2
// file's existing top-level shortcuts/groups become the contents of the default set,
// with no shortcut field dropped (see readProjectFile).
export const PROJECT_SHORTCUTS_VERSION = 3;

// Name of the set a migrated (or brand-new) file starts on. Its contents ARE the
// file's top-level shortcuts/groups, so a single-set workspace is byte-for-byte the
// pre-sets layout plus the `activeSet`/`sets` metadata — single-set behavior is
// unchanged until the user creates a second set. Single source for the literal so
// the migration, the switcher, and the delete-fallback cannot drift.
export const DEFAULT_SET_NAME = "Default";

// One named, switchable shortcut set within a workspace folder. A set is purely the
// user's curated shortcuts + groups; auto-shortcut / recipe seeding (removedAutoPins,
// removedRecipes, autoGroups) is a workspace-level concern shared across sets, so
// it stays on ProjectShortcutsFile rather than per set. Only the INACTIVE sets are
// stored in ProjectShortcutsFile.sets — the ACTIVE set's shortcuts/groups live at the
// file's top level, so every consumer (tree, scheduler, commands) reads the active
// set with no change. Identified by name, which doubles as the cross-folder key in a
// multi-root workspace (switching set "X" switches every folder to its "X").
export interface ShortcutSet {
  name: string;
  pins: Shortcut[];
  groups: ShortcutGroup[];
}

// On-disk shape for a single workspace folder's project shortcuts.
export interface ProjectShortcutsFile {
  version: number;
  // The ACTIVE set's shortcuts. Consumers read this as "the project shortcuts";
  // switching a set swaps these for the chosen set's shortcuts (the old active set is
  // stashed into `sets`). See ShortcutStore.switchSet.
  pins: Shortcut[];
  // The ACTIVE set's user-defined groups (mirrors `pins`).
  groups: ShortcutGroup[];
  // Name of the active set; its shortcuts/groups are the top-level fields above. Never
  // appears in `sets` (the active set is never duplicated there).
  activeSet: string;
  // The INACTIVE sets, each holding its own shortcuts + groups. Empty until the user
  // creates a second set, which keeps a single-set file identical to the pre-sets
  // layout.
  sets: ShortcutSet[];
  // Ids of auto-shortcuts the user removed, so they are not re-seeded.
  removedAutoPins: string[];
  // recipeIds the user removed, so detected recipes are not re-seeded (sticky).
  removedRecipes: string[];
  // Folder membership for auto-shortcuts, keyed by the auto-shortcut's stable id.
  // Auto-shortcuts are recomputed each refresh (not stored in `pins`), so a group
  // assignment cannot live on the shortcut itself — it is persisted here and re-
  // applied at seed time. Lets the user drag an auto-shortcut (and the synthetic
  // config shortcut) into and out of a folder; an entry is removed when the shortcut
  // moves back to top level.
  autoGroups: Record<string, string>;
}

export function emptyProjectShortcutsFile(): ProjectShortcutsFile {
  return {
    version: PROJECT_SHORTCUTS_VERSION,
    pins: [],
    groups: [],
    activeSet: DEFAULT_SET_NAME,
    sets: [],
    removedAutoPins: [],
    removedRecipes: [],
    autoGroups: {},
  };
}

// Relative path of the config file itself, reused as the seed shortcut's target so
// the shortcut opens the very file it lives in. Single source for the literal so the
// seed and the store's PROJECT_FILE_RELATIVE cannot drift apart silently.
export const PROJECT_FILE_RELATIVE = ".vscode/saropa-workspace.json";
