// Core data model for a pinned file/script. Kept deliberately small in Phase 1:
// every field has a live consumer (tree rendering, open/run, or persistence).

export type PinScope = "project" | "global";

// What a pin does when run. "file" (the implicit default when a pin has no
// `action`) opens/runs the file at `path` — every Phase 1 pin. The others are
// non-file actions introduced for recipes (auto-detected pins):
//   - "shell"   runs a command line not tied to a file (e.g. "npm test")
//   - "url"     opens an external URL (e.g. the project's GitHub page)
//   - "command" invokes a VS Code command id (e.g. copy version to clipboard)
//   - "macro"   runs an ordered list of steps
export type PinKind = "file" | "shell" | "url" | "command" | "macro";

// One step of a macro pin. Each step is a single non-macro action (macros do not
// nest). Only the fields for its `kind` are read.
export interface MacroStep {
  kind: "open" | "shell" | "url" | "command";
  label?: string;
  // open: a file path (workspace-folder-relative or absolute).
  path?: string;
  // shell: the full command line, with an optional working directory.
  shellCommand?: string;
  cwd?: string;
  // url: the URL to open.
  url?: string;
  // command: the VS Code command id and its arguments.
  commandId?: string;
  commandArgs?: unknown[];
}

// The non-file action a pin performs. Present only on non-file pins; a plain file
// pin has no `action` and runs via `path` + `exec`. Persists verbatim, so a
// promoted recipe (a recipe turned into a stored pin) round-trips.
export interface PinAction {
  kind: PinKind;
  // shell
  shellCommand?: string;
  cwd?: string;
  useIntegratedTerminal?: boolean;
  // shell report capture (scheduled rituals): capture combined output to this
  // dated file (relative to cwd; supports $stamp / $date / $workspaceRoot) and
  // open it when autoOpen is set, instead of streaming to the channel.
  reportFile?: string;
  autoOpen?: boolean;
  // url
  url?: string;
  // command
  commandId?: string;
  commandArgs?: unknown[];
  // macro
  steps?: MacroStep[];
}

// How a pinned file is executed when the user runs (double-clicks / play) it.
export interface PinExecConfig {
  // Interpreter / prefix placed before the file path, e.g. "python", "node",
  // "pwsh -File". Empty/undefined falls back to interpreterDefaults by extension.
  command?: string;
  // CLI args appended after the file path.
  args?: string[];
  // Working directory for the run. Undefined = the workspace folder owning the file.
  cwd?: string;
  // Extra env vars merged over the inherited environment.
  env?: Record<string, string>;
  // Run in the integrated terminal (visible) vs a background output channel.
  // Undefined = follow the defaultUseIntegratedTerminal setting.
  useIntegratedTerminal?: boolean;
  // Whether the target file path is inserted between the command and the args.
  // Undefined/true = the default "<command> <file> <args>" assembly. False omits
  // the file, for run targets that name their work in args instead — an npm
  // script (`npm run build`) or a Make target (`make test`) where the file is the
  // package.json / Makefile in cwd, not an argument. Added with run-target
  // inference (7.5); absent on older pins, which keep the file-included default.
  includeFilePath?: boolean;
}

// Phase 1 scheduling is defined in the model so stored pins are forward-compatible
// with the scheduler step; the scheduler itself is wired in a later step.
export interface PinSchedule {
  // Daily fire time, local "HH:mm". Optional.
  atTime?: string;
  // Repeating interval in milliseconds. Optional; combinable with atTime.
  everyMs?: number;
  enabled: boolean;
  // Epoch ms of the last fire, used to avoid duplicate same-minute fires when
  // VS Code reopens.
  lastRun?: number;
}

export interface Pin {
  // Stable id, unique within its scope. Used by the click dispatcher and menus.
  id: string;
  // Project pins store this workspace-folder-relative (survives clone/move);
  // global pins store an absolute fsPath. See PinStore for resolution.
  path: string;
  // Optional display override; defaults to the file basename.
  label?: string;
  scope: PinScope;
  // Seeded from autoPins.patterns; removable but regenerated unless suppressed.
  isAuto?: boolean;
  // Non-file action (url/shell/command/macro). Absent on a plain file pin, which
  // runs via path + exec. See PinKind / PinAction.
  action?: PinAction;
  // Seeded by a recipe detector (auto-detected from project files), like isAuto
  // but for derived actions. Removable; removal is sticky via removedRecipes.
  isRecipe?: boolean;
  // The recipe that produced this pin (stable across reloads), used for sticky
  // removal, restore, and de-duplication. Carried by recipe pins only.
  recipeId?: string;
  exec?: PinExecConfig;
  schedule?: PinSchedule;
  // Optional tree-icon override: a VS Code product-icon (codicon) id WITHOUT the
  // surrounding $(...), e.g. "rocket". Undefined falls back to the file-type
  // default glyph. Added with appearance customization (5.1).
  icon?: string;
  // Optional theme-color id applied to the icon, e.g. "charts.red". Theme-aware
  // (a ThemeColor key, never a raw hex) so it renders in light/dark/high-contrast.
  color?: string;
  // Id of the user group (PinGroup) this pin belongs to within its scope.
  // Undefined = top level, directly under the scope root. Added in schema v2;
  // a pin written by v1 has no groupId and reads as top level (the migration is
  // therefore a no-op on pins — only the file gains an empty groups array).
  groupId?: string;
  // Sort order within the pin's group (or among top-level pins when ungrouped).
  order: number;
}

// The kind a pin runs as: its action's kind, or "file" when it has no action.
export function pinKind(pin: Pin): PinKind {
  return pin.action?.kind ?? "file";
}

// A user-defined group (folder) that holds pins, nested under a scope root.
// Project groups live in each folder's ProjectPinsFile; global groups live in
// extension globalState. A group's id is referenced by Pin.groupId.
export interface PinGroup {
  // Stable id, unique within its scope, referenced by Pin.groupId.
  id: string;
  label: string;
  // Sort order among groups under the same scope root.
  order: number;
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

// Current on-disk schema version. Bumped from 1 to 2 to add `groups`; v1 files
// are migrated on read (groups default to [], pins keep their fields).
export const PROJECT_PINS_VERSION = 2;

// On-disk shape for a single workspace folder's project pins.
export interface ProjectPinsFile {
  version: number;
  pins: Pin[];
  // User-defined groups in this folder's project scope.
  groups: PinGroup[];
  // Ids of auto-pins the user removed, so they are not re-seeded.
  removedAutoPins: string[];
  // recipeIds the user removed, so detected recipes are not re-seeded (sticky).
  removedRecipes: string[];
}

export function emptyProjectPinsFile(): ProjectPinsFile {
  return {
    version: PROJECT_PINS_VERSION,
    pins: [],
    groups: [],
    removedAutoPins: [],
    removedRecipes: [],
  };
}

// Relative path of the config file itself, reused as the seed pin's target so the
// pin opens the very file it lives in. Single source for the literal so the seed
// and the store's PROJECT_FILE_RELATIVE cannot drift apart silently.
export const PROJECT_FILE_RELATIVE = ".vscode/saropa-workspace.json";

