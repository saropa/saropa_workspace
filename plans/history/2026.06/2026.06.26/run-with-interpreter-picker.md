# Run With… interpreter picker and platform-aware interpreter resolution

A pinned Python script ran as a bare path on Windows (opening in the editor via file
association) instead of through an interpreter, because the stored run config carried an
explicit empty command prefix that the resolver honored verbatim. The interpreter for a
shortcut was also only adjustable through a free-text box or a raw settings JSON map,
with no visibility into what an empty prefix resolved to and no awareness of the
interpreters actually installed on the machine.

## Finish Report (2026-06-26)

### Defect

`ShortcutExecConfig.command` of `""` means "run the file directly". On Unix a blank
prefix lets the OS honor a script's `#!` shebang plus exec bit. On Windows there is no
shebang honoring: the shell hands a bare script path to its file association, so a `.py`
opened in the editor rather than executing. The run-target detector wrote `command: ""`
for any shebang script (the "Run directly (shebang)" target), so a routine pin-and-pick
produced a Windows-broken shortcut. Interpreter resolution (`resolveInterpreter`) was
also platform-blind, and there was no surface that revealed installed interpreters or the
effective default.

### Changes

Interpreter resolution (`exec/commandPlan.ts`):
- `resolveInterpreter` now takes a `platform` argument. A non-blank explicit command
  still wins. A blank explicit prefix resolves to "" only on Unix; on Windows it falls
  through to the same default-then-shebang resolution as an unset command, so a blank
  "run directly" prefix reaches a real interpreter instead of opening the file. The
  no-explicit precedence (extension default, then shebang) is unchanged.
- `parseShebangLine(firstLine)` extracted as the single pure shebang parser (env-wrapper
  stripping), now shared by `runPlanning.shebangInterpreter` and the run-target detector
  instead of two copies.

Run-target detector (`exec/runTargets.ts`):
- The shebang target writes the interpreter the shebang names (e.g. `python3`) as the
  stored command, not a blank prefix, so a pinned shebang script runs on every platform
  and the value stays visible and editable. Label changed to "Run with `<interpreter>`".

Interpreter detection (`exec/interpreters.ts`, `exec/interpreterDetect.ts` — new):
- A pure catalog maps a file extension to candidate interpreters (display label, stored
  command, probe binary). The IO layer probes `PATH` (honoring `PATHEXT` on Windows) and,
  for Python on Windows, scans common install roots (`%LOCALAPPDATA%\Programs\Python`,
  Program Files, `D:\Tools\Python`, pyenv-win, bare drive roots) for versioned installs
  that `PATH` never surfaced. Results are de-duplicated by resolved executable path and
  cached per extension for the session.

"Run With…" command (`commands/runWith.ts` — new):
- A QuickPick listing detected interpreters (current one checked), plus a file-type
  default choice, "Run directly", and "Browse…". The pick is merged over the existing
  exec (preserving args/cwd/env/location), persisted, confirmed with a toast naming the
  shortcut and interpreter, then run through the canonical `runShortcutCommand` path.
- Registered in `shortcutConfigCommands.ts`; declared in `package.json` with a Configure
  submenu entry (group `1_run@0`) and command-palette gate; titles/strings in
  `package.nls.json` and `i18n/locales/en.json`.

Configure Run panel (`views/configureRunPanel.ts`, `views/configureRunAssets.ts`):
- The command card renders detected interpreters as one-click chips plus a "Default" chip
  and a "Browse…" chip, with an inline hint under the command box naming what an empty
  prefix resolves to (via the new `resolveRunPrefix` export). Detection is posted to the
  client after init; the client holds no display strings, so the chip pseudo-labels and
  hint text are host-localized and passed in the message. The browse chip round-trips
  through the host file dialog. The live command preview is unchanged and continues to
  reflect the chosen interpreter.

### Tests

- `test/interpreters.test.ts` (new): catalog ordering, probe-binary extraction, shared
  runtimes, empty for unknown extensions.
- `test/commandPlan.test.ts`: split the blank-command case into Unix (runs directly) and
  Windows (resolves to a real interpreter), plus a Windows-no-default-falls-to-shebang
  case; all existing cases pass an explicit `platform`.
- `test/runTargets.test.ts`: shebang target asserts the interpreter command (`python3`),
  not a blank prefix.
- Full suite: 796 passing, 0 failing. `tsc -p ./ --noEmit` clean. `node esbuild.js`
  builds.

### Notes

- Existing stored pins carrying `command: ""` now resolve to a real interpreter on
  Windows at run time via the platform-aware resolver, with no data migration.
- A specific runtime can be pinned by setting an absolute path through Browse / the
  command box, or per file type in `saropaWorkspace.interpreterDefaults`.
- The interpreter-chip / detected-choices-over-free-text convention was added to
  `plans/guides/STYLEGUIDE.md`.
