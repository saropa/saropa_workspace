// Core data model for a shortcut to a file/script. Kept deliberately small in
// Phase 1: every field has a live consumer (tree rendering, open/run, or
// persistence).

export type ShortcutScope = "project" | "global";

// The action/exec/schedule type clusters live in sibling modules to keep this file under
// the line cap; they are imported for the Shortcut interface below and re-exported at the
// foot so "../model/shortcut" stays the single import surface for the whole model.
import { ShortcutAction, ShortcutKind } from "./shortcutAction";
import { ShortcutExecConfig } from "./shortcutExec";
import {
  ShortcutSchedule,
  ShortcutTrigger,
  SystemEventName,
  ShortcutMetric,
} from "./shortcutSchedule";

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


export * from "./shortcutAction";
export * from "./shortcutExec";
export * from "./shortcutSchedule";
export * from "./shortcutFile";
