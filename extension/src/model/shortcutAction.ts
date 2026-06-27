// Action model for a non-file shortcut: what a shortcut DOES when it has no plain file
// target. Split out of shortcut.ts (which re-exports these) to keep that file under the
// line cap. ShortcutKind is the discriminated-union tag shared by the whole model.

// What a shortcut does when run. "file" (the implicit default when a shortcut has
// no `action`) opens/runs the file at `path` — every Phase 1 shortcut. The others
// are non-file actions introduced for recipes (auto-detected shortcuts):
//   - "shell"   runs a command line not tied to a file (e.g. "npm test")
//   - "url"     opens an external URL (e.g. the project's GitHub page)
//   - "command" invokes a VS Code command id (e.g. copy version to clipboard)
//   - "macro"   runs an ordered list of inline steps
//   - "routine" runs an ordered list of OTHER recipe shortcuts in sequence (a recipe
//               of recipes — the Morning routine). Distinct from "macro": a macro's
//               steps are inline and identity-less, a routine's members are real
//               shortcuts edited in one place and each carrying its own report/badge.
// The last two are annotation-only entries — they have NO target and NO action,
// so they never run or open. They exist to label and divide a long shortcut list:
//   - "comment"   a non-runnable text label (the comment text is the shortcut label)
//   - "separator" a non-runnable visual divider (carries neither label nor path)
// Every consumer that assumes a shortcut has something to run/open must guard these.
// They fail closed (no action) wherever a switch does not handle them, so the
// discriminated union on this type is the single guard point. See isAnnotationShortcut.
export type ShortcutKind =
  | "file"
  | "shell"
  | "url"
  | "command"
  | "macro"
  | "routine"
  | "comment"
  | "separator";

// One member of a routine: a reference to another recipe shortcut, run in sequence.
// Referenced by stable recipeId (so the link survives the recipe -> promoted-shortcut
// transition and reloads, matching how sticky removal keys on recipeId), with a
// shortcut-id fallback for a member hand-composed from a non-recipe stored shortcut.
// Exactly one of recipeId / pinId identifies the member; recipeId is preferred when
// both resolve. Resolved to the live shortcut at run time, so an edited/promoted
// member is still found.
export interface RoutineMember {
  // The member recipe's stable recipeId (detected members).
  recipeId?: string;
  // The member shortcut's id (hand-composed members over a non-recipe stored shortcut).
  pinId?: string;
  // Optional display override for the routine's per-member progress line; defaults
  // to the resolved member shortcut's label.
  label?: string;
}

// One step of a macro shortcut. Each step is a single non-macro action (macros do not
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

// The non-file action a shortcut performs. Present only on non-file shortcuts; a
// plain file shortcut has no `action` and runs via `path` + `exec`. Persists
// verbatim, so a promoted recipe (a recipe turned into a stored shortcut) round-trips.
export interface ShortcutAction {
  kind: ShortcutKind;
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
  // routine: ordered members run strictly in sequence (see runRoutine). A routine
  // is a ShortcutAction like every other recipe, so it round-trips through
  // promote/persist with no new top-level Shortcut field. Routines do not nest — a
  // member that is itself a routine is skipped, bounding sequencing/failure
  // semantics and preventing cycles.
  members?: RoutineMember[];
}
