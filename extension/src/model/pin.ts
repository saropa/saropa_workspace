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
  // Sort order within the pin's group.
  order: number;
}

// On-disk shape for a single workspace folder's project pins.
export interface ProjectPinsFile {
  version: 1;
  pins: Pin[];
  // Ids of auto-pins the user removed, so they are not re-seeded.
  removedAutoPins: string[];
}

export function emptyProjectPinsFile(): ProjectPinsFile {
  return { version: 1, pins: [], removedAutoPins: [] };
}
