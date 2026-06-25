// Core data model for a pinned file/script. Kept deliberately small in Phase 1:
// every field has a live consumer (tree rendering, open/run, or persistence).

export type PinScope = "project" | "global";

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
  exec?: PinExecConfig;
  schedule?: PinSchedule;
  // Id of the user group (PinGroup) this pin belongs to within its scope.
  // Undefined = top level, directly under the scope root. Added in schema v2;
  // a pin written by v1 has no groupId and reads as top level (the migration is
  // therefore a no-op on pins — only the file gains an empty groups array).
  groupId?: string;
  // Sort order within the pin's group (or among top-level pins when ungrouped).
  order: number;
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
}

export function emptyProjectPinsFile(): ProjectPinsFile {
  return {
    version: PROJECT_PINS_VERSION,
    pins: [],
    groups: [],
    removedAutoPins: [],
  };
}
