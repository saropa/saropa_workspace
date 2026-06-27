// How a shortcut's file is executed: the run location, the audio-cue override, and the
// full per-shortcut exec config. Split out of shortcut.ts (which re-exports these) to keep
// that file under the line cap.

// Where a shortcut's file runs when executed. "terminal" is the shared integrated
// terminal (visible, interactive); "background" streams to an output channel;
// "external" launches a new OS terminal window outside VS Code (optionally
// elevated). Undefined falls back to the defaultUseIntegratedTerminal setting.
export type RunLocation = "terminal" | "background" | "external";

// Per-shortcut override for the audio event cues (WOW #64): force the cues on for
// this shortcut, or silence it. Undefined follows the global saropaWorkspace.sound.*
// settings.
export type SoundOverride = "on" | "off";

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
