// Core data model for a shortcut to a file/script. Kept deliberately small in
// Phase 1: every field has a live consumer (tree rendering, open/run, or
// persistence).

export type ShortcutScope = "project" | "global";

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

// Where a shortcut's file runs when executed. "terminal" is the shared integrated
// terminal (visible, interactive); "background" streams to an output channel;
// "external" launches a new OS terminal window outside VS Code (optionally
// elevated). Undefined falls back to the defaultUseIntegratedTerminal setting.
export type RunLocation = "terminal" | "background" | "external";

// Per-shortcut override for the audio event cues (WOW #64): force the cues on for
// this shortcut, or silence it. Undefined follows the global saropaWorkspace.sound.*
// settings.
export type SoundOverride = "on" | "off";

// A live metric a file shortcut can display as an inline badge (#24). The metric
// engine watches the resolved file and recomputes on change:
//   - "size"     the file size (e.g. "245 KB"); the only kind a thresholdBytes applies to
//   - "lines"    the line count (engine caps the read and degrades to size for a huge file)
//   - "modified" the last-modified time, rendered relative ("5 min ago") at paint time
// Present only on a file shortcut the user opted into a metric for; absent on every
// other shortcut, so the engine arms a watcher for opted-in shortcuts only (no cost
// by default).
export interface ShortcutMetric {
  kind: "size" | "lines" | "modified";
  // Size ceiling in BYTES. When set (size kind only), the badge turns to a warning
  // tint once the file exceeds it and a one-time toast fires on the under->over
  // crossing — the "tell me when this file gets too big" alert. Undefined = badge only.
  thresholdBytes?: number;
}

// A system-level event a shortcut can react to or emit (WOW: recipe chaining +
// special events). "build" / "publish" are emitted by a shortcut the user marks as
// that kind of step (Shortcut.emits) when it completes; "gitCommit" / "gitPush" are
// detected directly from the repo's .git logs by a file watcher, so no shortcut
// needs to emit them.
export type SystemEventName = "build" | "publish" | "gitCommit" | "gitPush";

// The fixed set of system events, in display order. Single source for the UI
// pickers and the workflow graph's synthetic event nodes.
export const SYSTEM_EVENTS: readonly SystemEventName[] = [
  "build",
  "publish",
  "gitCommit",
  "gitPush",
];

// One cause that auto-runs a shortcut beyond its own schedule (recipe chaining). A
// "pin" trigger runs this shortcut after another shortcut completes (optionally only
// when that shortcut succeeded); an "event" trigger runs it after a system event
// fires; an "idle" trigger runs it once after `minutes` of no VS Code interaction
// (WOW #18 — the "coffee break" runner, for a heavy job you want fired while you are
// away from the keyboard). A shortcut may carry several, so "run X after Y" and "run
// Z after Y" are independent links. An idle run is always forced to the background
// channel (it must never steal the terminal while unattended) and re-arms only after
// the next burst of activity, so it fires at most once per idle period.
export type ShortcutTrigger =
  | { kind: "pin"; pinId: string; onlyOnSuccess?: boolean }
  | { kind: "event"; event: SystemEventName }
  | { kind: "idle"; minutes: number };

// How a shortcut's file is executed when the user runs (double-clicks / play) it.
export interface ShortcutExecConfig {
  // Interpreter / prefix placed before the file path, e.g. "python", "node",
  // "pwsh -File". Empty/undefined falls back to interpreterDefaults by extension.
  command?: string;
  // CLI args appended after the file path.
  args?: string[];
  // Working directory for the run. Undefined = the workspace folder owning the file.
  cwd?: string;
  // Extra env vars merged over the inherited environment.
  env?: Record<string, string>;
  // Where the run happens (integrated terminal / background channel / external
  // OS window). Undefined follows the defaultUseIntegratedTerminal setting. This
  // is the source of truth; resolveRunLocation reads it first and falls back to
  // the deprecated useIntegratedTerminal flag for shortcuts written before it existed.
  runLocation?: RunLocation;
  // When runLocation is "external", request administrator/elevated privileges for
  // the new window (Windows UAC; pkexec/sudo best-effort elsewhere). Ignored for
  // the terminal/background locations. Elevation spawns a fresh elevated
  // environment, so per-shortcut env vars do not propagate into an elevated window.
  elevated?: boolean;
  // Deprecated: superseded by runLocation. Retained read-only so shortcuts written
  // before runLocation existed (true = integrated terminal, false = background)
  // still resolve. configureRun clears this field when it writes runLocation, so
  // a re-saved shortcut carries only the new field (no two-source drift).
  useIntegratedTerminal?: boolean;
  // Optional id of another shortcut that must have run successfully THIS SESSION
  // before this shortcut will run (WOW #13). Until then the shortcut is shown locked
  // in the tree and running it is blocked with an offer to run the prerequisite
  // first. Session-scoped because run success is tracked in memory
  // (runStatusRegistry) and a fresh window starts with nothing satisfied. A dangling
  // id (the prerequisite was deleted) is treated as satisfied so a shortcut can never
  // become permanently unrunnable.
  dependsOn?: string;
  // Optional regular expression matched against a BACKGROUND run's combined output
  // when it finishes. The first capture group (or the whole match when there is no
  // group) is copied to the clipboard, with a toast — for pulling the one line that
  // matters (a deploy URL, a generated id) out of hundreds of log lines (WOW #16).
  // Only background runs capture output, so this is ignored for terminal/external
  // runs. An invalid pattern or no match is logged to the output channel and
  // otherwise ignored.
  extractResult?: string;
  // Per-shortcut override for the audio event cues (WOW #64). Undefined follows the
  // global saropaWorkspace.sound.* settings; "on" chimes for this shortcut on every
  // event (even when the per-event toggles are off, as long as the master toggle is
  // on); "off" silences this shortcut entirely. Lets a user mute a chatty shortcut or
  // opt a single long-running job into cues without enabling them everywhere.
  sound?: SoundOverride;
  // Whether the target file path is inserted between the command and the args.
  // Undefined/true = the default "<command> <file> <args>" assembly. False omits
  // the file, for run targets that name their work in args instead — an npm
  // script (`npm run build`) or a Make target (`make test`) where the file is the
  // package.json / Makefile in cwd, not an argument. Added with run-target
  // inference (7.5); absent on older shortcuts, which keep the file-included default.
  includeFilePath?: boolean;
  // When true, the shortcut runs automatically every time its OWN target file is
  // saved (the Code-Runner "run on save" convenience). Applies only to a runnable
  // file shortcut — a non-file/action shortcut has no target file to watch, and a
  // non-runnable file shortcut has nothing to run. Off (undefined/false) by default
  // so a save never triggers an unexpected run; the user opts a specific shortcut in
  // via Configure Run.
  runOnSave?: boolean;
  // Cross-file watch links (#25 — "if this, then run that"): glob patterns matched
  // against OTHER files. When any file whose workspace-relative path matches one of
  // these globs is saved, this shortcut runs in the background — the "I edited
  // schema.graphql, regenerate the types" automation. Distinct from runOnSave, which
  // watches the shortcut's OWN target file; these watch arbitrary files, so a
  // runnable shortcut of any kind (a generate script, an npm task) can react to a
  // source file it does not itself point at. Patterns are POSIX-glob (`*`, `**`,
  // `?`); the same save listener drives both this and runOnSave. Absent/empty by
  // default so no shortcut reacts to a foreign save unless the user explicitly linked
  // it (Run This Shortcut When a File Changes). Watch runs are background + per-
  // shortcut cooldown so a save burst cannot spawn a run storm.
  runOnSaveGlobs?: string[];
}

// Phase 1 scheduling is defined in the model so stored shortcuts are forward-
// compatible with the scheduler step; the scheduler itself is wired in a later step.
export interface ShortcutSchedule {
  // Daily fire time, local "HH:mm". Optional.
  atTime?: string;
  // Local weekdays (0 = Sunday .. 6 = Saturday) on which the daily `atTime` slot
  // may fire. Empty or absent = every day. Constrains only the daily time; a
  // repeating `everyMs` interval stays periodic regardless of weekday by design
  // (an "every 6 hours" job is not a weekday concept). So "weekdays at 9am" is
  // atTime "09:00" + days [1,2,3,4,5].
  days?: number[];
  // Repeating interval in milliseconds. Optional; combinable with atTime. The
  // editor surfaces this in minutes / hours / days units, but the stored value is
  // always milliseconds so the schedule math has one source of truth.
  everyMs?: number;
  // Optional 5-field cron expression: "minute hour day-of-month month day-of-week"
  // (standard Vixie syntax — `*`, lists `a,b`, ranges `a-b`, steps `*/n` / `a-b/n`,
  // 3-letter month/day names, DOW 0 or 7 = Sunday). Parsed and advanced by
  // `nextCron` in schedule.ts, and folded into the same `nextOccurrence` path as
  // `atTime` / `everyMs` (the earliest of all set slots wins) — there is no second
  // scheduler. A malformed expression disables the cron slot rather than firing at
  // an unintended time, matching how a bad atTime is treated. Combinable with the
  // other timing fields.
  cron?: string;
  // When true, fire this shortcut once shortly after the extension activates (a
  // workspace open), in addition to any time-based slots. The run is deferred past
  // activation so it never does file IO in the activation path, and de-duped on
  // `lastRun` within a short window so a window-reload storm does not re-run it.
  // Gated by `enabled` like every other slot. A schedule may carry runOnStartup
  // alone (no atTime / everyMs / cron) to mean "only on workspace open".
  runOnStartup?: boolean;
  enabled: boolean;
  // Epoch ms of the last fire, used to avoid duplicate same-minute fires when
  // VS Code reopens.
  lastRun?: number;
}

export interface Shortcut {
  // Stable id, unique within its scope. Used by the click dispatcher and menus.
  id: string;
  // Project shortcuts store this workspace-folder-relative (survives clone/move);
  // global shortcuts store an absolute fsPath. See ShortcutStore for resolution.
  path: string;
  // Optional display override; defaults to the file basename.
  label?: string;
  scope: ShortcutScope;
  // Seeded from autoPins.patterns; removable but regenerated unless suppressed.
  isAuto?: boolean;
  // Non-file action (url/shell/command/macro). Absent on a plain file shortcut,
  // which runs via path + exec. See ShortcutKind / ShortcutAction.
  action?: ShortcutAction;
  // Seeded by a recipe detector (auto-detected from project files), like isAuto
  // but for derived actions. Removable; removal is sticky via removedRecipes.
  isRecipe?: boolean;
  // The recipe that produced this shortcut (stable across reloads), used for sticky
  // removal, restore, and de-duplication. Carried by recipe shortcuts only.
  recipeId?: string;
  // Human description of what a recipe does and what it was detected from. Shown
  // on the single-click detail modal and the tree hover, so the catalog prose
  // lives in the product (surfaced on click) rather than only in the plan doc.
  // Carried by recipe shortcuts; persists verbatim so a promoted recipe keeps it.
  description?: string;
  exec?: ShortcutExecConfig;
  schedule?: ShortcutSchedule;
  // Auto-run causes beyond the schedule (recipe chaining + special events). When a
  // source fires — another shortcut completes, or a system event happens — this
  // shortcut runs. Empty/absent = the shortcut runs only manually or on its own
  // schedule. The chain engine guards against cycles and storms (a per-shortcut
  // cooldown) so A->B->A cannot loop forever.
  triggers?: ShortcutTrigger[];
  // System events this shortcut's completion fires, so other shortcuts can chain off
  // it: mark a build script `emits: ["build"]`, a publish script `["publish"]`. Only
  // a successful (or untracked) completion emits; a failed run emits nothing.
  // gitCommit / gitPush are detected from the repo and need no emitter here.
  emits?: SystemEventName[];
  // Optional tree-icon override: a VS Code product-icon (codicon) id WITHOUT the
  // surrounding $(...), e.g. "rocket". Undefined falls back to the file-type
  // default glyph. Added with appearance customization (5.1).
  icon?: string;
  // Optional theme-color id applied to the icon, e.g. "charts.red". Theme-aware
  // (a ThemeColor key, never a raw hex) so it renders in light/dark/high-contrast.
  color?: string;
  // Id of the user group (ShortcutGroup) this shortcut belongs to within its scope.
  // Undefined = top level, directly under the scope root. Added in schema v2;
  // a shortcut written by v1 has no groupId and reads as top level (the migration is
  // therefore a no-op on shortcuts — only the file gains an empty groups array).
  groupId?: string;
  // Optional 1-based line to jump to when the shortcut is opened (WOW #22). A "line
  // shortcut" opens the file, scrolls to this line, and briefly flashes it — for a
  // shortcut to the one function in a 3000-line file you keep coming back to. Line-
  // based (not AST-tracked), so an edit above it can shift the target; the line is
  // clamped to the file's length on open so it never points past the end.
  line?: number;
  // When true, opening this file shortcut follows it like `tail -f`: the editor auto-
  // scrolls to the end every time the file grows on disk (WOW #5), so a running
  // process's log stays pinned to its newest lines without closing/reopening the
  // tab. File shortcuts only; ignored for non-file actions. The follow lives only
  // while the tab is open — closing the editor ends it (no persistent watcher leaks).
  tailFollow?: boolean;
  // Live metric badge for a file shortcut (#24): file size, line count, or last-
  // modified, shown inline and refreshed by the metric engine as the file changes on
  // disk. Only a file shortcut the user opted in carries this; absent everywhere else
  // so no watcher is armed by default. A size metric may carry a thresholdBytes
  // (warning tint + a one-time toast when the file grows past it). See ShortcutMetric.
  metric?: ShortcutMetric;
  // Time-bomb: a self-removal condition the user explicitly set (WOW #9). When set,
  // the shortcut auto-removes once the condition is met — the cure for a temporary
  // shortcut (a migration script, today's scratch file) that otherwise lingers for
  // months. Only a shortcut the user explicitly time-bombed ever carries this; a
  // normal shortcut has no `expires` and is never auto-removed. The two conditions
  // are independent and either may be present:
  //   - `at` — epoch ms; removed once Date.now() >= at (swept by a low-frequency timer).
  //   - `onBranchAway` — the git branch name the shortcut was bombed on; removed once
  //     the owning folder's current branch is no longer this one. Skipped (never
  //     removed) when the branch cannot be read, so an unreadable repo never loses
  //     shortcuts.
  expires?: { at?: number; onBranchAway?: string };
  // Freeform classification tags, lowercase and without the leading '#' (WOW #17).
  // Drive the Shortcuts-view "mode" filter: pick a tag and the tree collapses to the
  // shortcuts that carry it. Absent/empty = untagged (backward compatible). Stored on
  // explicit shortcuts only — auto/recipe shortcuts are recomputed each refresh, so
  // there is nowhere to persist a tag on them.
  tags?: string[];
  // Branch-linked shortcut (WOW #3 — the context time-machine). When set to a git
  // branch name, this shortcut shows in the tree ONLY while the owning folder is on
  // that branch (a global shortcut checks the first workspace folder); switching
  // branches re-filters the view live. Absent (the default, fully backward
  // compatible) = shown on every branch. Reading the branch is best-effort: when it
  // cannot be determined the shortcut is shown rather than hidden, so an unreadable
  // repo never makes a shortcut vanish. The escape hatch for a shortcut scoped to a
  // deleted/unreachable branch is the view's "Show shortcuts from all branches"
  // toggle. Stored on explicit shortcuts only — auto/recipe shortcuts are recomputed
  // each refresh and carry no branch.
  branch?: string;
  // Sort order within the shortcut's group (or among top-level shortcuts when
  // ungrouped).
  order: number;
  // Paused shortcut: automatic execution is suspended while its definition is kept. A
  // paused shortcut is skipped by every UNATTENDED runner — the scheduler arms no
  // timer for it, the chain engine ignores its triggers and emits no system events on
  // its completion, an idle threshold it declares is dropped, and run-on-save does not
  // fire it. A MANUAL run (the tree's Run / Run now, the palette, a keybinding) still
  // works, so pausing is "stop running this on its own," not "disable the shortcut."
  // The schedule/triggers stay intact, so unpausing resumes exactly where it left off
  // without re-entering them. Stored on explicit shortcuts only — auto/recipe
  // shortcuts are recomputed each refresh and carry no automation to pause.
  // Absent/false = active.
  paused?: boolean;
  // Masked / vault shortcut (WOW #26 — the screen-share guard). When true, the tree
  // hides the shortcut's identity: it renders a generic localized label ("Protected
  // file") and a lock glyph instead of the filename/icon, and OMITS the real path
  // from the row detail and the hover, so a secret target (.env.production) is never
  // visible while resting on a shared screen. Opening a masked shortcut first requires
  // an explicit reveal confirm (see openShortcut), so a stray click cannot instantly
  // display the file. This gates the OPEN and hides the LABEL; it does NOT redact the
  // contents of an already-opened document (no VS Code API can blur editor text).
  // File shortcuts only and stored (explicit) shortcuts only — auto/recipe shortcuts
  // are recomputed each refresh and carry no flag. Absent/false = a normal, fully-
  // visible shortcut.
  masked?: boolean;
  // Single-instance control. By default (allowConcurrent absent/false) a shortcut
  // will not start a fresh run while one of its OWN runs is still in flight: the
  // scheduler, chain triggers, run-on-save, and a manual run all defer to the
  // running one (the unattended paths skip and log; a manual run offers Stop-and-
  // re-run / Run anyway). This is the "an hourly job that hangs must not stack up"
  // guard. Set true to allow overlapping runs (the pre-guard behavior). The guard
  // can only observe runs this extension TRACKS — background and report-capture runs
  // spawn a child whose exit we see; integrated-terminal and external-window runs
  // are fire-and-forget and are never blocked by this flag alone (use lockName for
  // those). Stored on explicit shortcuts only — auto/recipe shortcuts are recomputed.
  allowConcurrent?: boolean;
  // Cross-process run lock name (opt-in). When set, a run first checks a shared
  // on-disk lock under this name (in the OS temp dir) and refuses to start while a
  // LIVE holder owns it — extending the single-instance barrier beyond this window
  // to other VS Code windows, an external terminal, cron, or any script that honors
  // the same convention (e.g. a 4 GB GPU job guarded by lockName "nllb-gpu"). Several
  // shortcuts may share one name to serialize a common resource. A holder whose
  // process is no longer alive is treated as stale and stolen, so a crash never wedges
  // the lock. Only background/report runs HOLD the lock (they own a child PID whose
  // exit frees it); terminal/external runs only CHECK it. allowConcurrent:true
  // disables this too. Absent = no cross-process lock (the in-process guard still
  // applies).
  lockName?: string;
}

// The kind a shortcut runs as: its action's kind, or "file" when it has no action.
export function shortcutKind(shortcut: Shortcut): ShortcutKind {
  return shortcut.action?.kind ?? "file";
}

// A comment or separator entry: a non-runnable, non-openable annotation that only
// labels or divides the list. Every code path that assumes a shortcut has a target
// to run/open consults this so the new kinds stay inert (the runner, the click
// dispatcher, the run palette, badges). Kept as one predicate so a third annotation
// kind added later updates every guard from a single place.
export function isAnnotationShortcut(shortcut: Shortcut): boolean {
  const kind = shortcutKind(shortcut);
  return kind === "comment" || kind === "separator";
}

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
