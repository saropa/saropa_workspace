# External run window: PowerShell with recallable history

The external-window run location launched a `cmd.exe` window whose auto-run command
could not be recalled — a command handed to `cmd /k "cd … & script"` never enters
doskey history, and cmd has no way to inject history, so up-arrow in the fresh window
recalled nothing. The launcher now opens a PowerShell window that seeds the run
command into a per-window PSReadLine history file, so the command is re-runnable with
up-arrow in the same window.

## Finish Report (2026-07-09)

### Defect

`launchExternalWindows` in `extension/src/exec/externalLauncher.ts` built a single
`cmd.exe /k "cd /d <cwd> & <commandLine>"` invocation. The command executed but was
never added to the window's doskey history (verified: `doskey /history` is empty
immediately after a `cmd /c`/`/k` compound runs). cmd.exe exposes no command to
inject history, so a fresh external window offered no up-arrow recall — rerunning a
script meant retyping it.

### Change

The Windows branch now launches `powershell.exe -NoExit -NoProfile -EncodedCommand
<base64>`. The startup script:

1. Names a per-window history file by the new shell's own PID
   (`%TEMP%\saropa_ext_hist_<PID>.txt`) — distinct per window, no clash, and the
   user's shared global PowerShell history is untouched.
2. Writes the cd and run command into that file, oldest-first, as UTF-8 without a BOM
   (`[IO.File]::WriteAllLines` + `UTF8Encoding($false)`; `Set-Content` on Windows
   PowerShell 5.1 would prepend a BOM that corrupts the first recalled entry).
3. Points PSReadLine at that file via `Set-PSReadLineOption -HistorySavePath` before
   the first interactive prompt, so the engine loads it as this window's history.
   This ordering is load-bearing: PSReadLine's engine is not initialized during
   `-EncodedCommand` execution (confirmed — `[PSConsoleReadLine]::AddToHistory`
   throws a null-reference there), so the path is set pre-init and the interactive
   engine reads history from it on first `ReadLine`.
4. cd's to the target and runs the command through the call operator (`& …`) so a
   command line whose first token is a quoted string is invoked, not echoed.

The startup script is passed as a UTF-16LE base64 blob via `-EncodedCommand` to avoid
a four-level nested-quoting stack (Node argv → outer PowerShell `-Command` →
`Start-Process -ArgumentList` → inner PowerShell) that a raw string could not survive.
`-Verb RunAs` (elevation), the detached-vs-UAC-desktop spawn logic, and the
env-dropped warning are unchanged. The macOS and Linux branches are untouched.

### Rationale for the shell switch

cmd.exe structurally cannot seed the launched window's up-arrow history; PSReadLine
can. The trade-off — command interpretation now follows PowerShell rules rather than
cmd's — was raised with and accepted by the requester before implementation. The
common case (an interpreter invocation such as `python.exe <file> <flags>`) runs
identically under both shells.

### Refactor performed as part of the change

The pure helpers `psQuote`, `buildWindowsStartup`, and `encodeForPowerShell` were
moved from `externalLauncher.ts` (which imports `vscode`) into the vscode-free
`commandPlan.ts`, matching that module's stated role as the unit-testable
command-assembly core. This made the quoting and script shape testable under the
`node --test` harness without the extension host.

### Verification

- `npx tsc -p ./ --noEmit`: clean.
- `node esbuild.js`: bundle builds.
- The generated startup script was run end-to-end through the real
  `powershell.exe -EncodedCommand` path with a harmless run command: the command
  executed and the seeded history file contained exactly the two entries
  (run command atop cd), backslashes intact, no BOM.
- `commandPlan.test.ts`: 21/21 pass, including three new cases covering the seed
  order, PowerShell single-quote escaping of the cwd, and the UTF-16LE/base64
  round-trip.

### Known limitation (not fixed here)

`quoteArg` (shared by the cmd/POSIX and PowerShell paths) escapes an embedded double
quote as `\"`, which PowerShell's `&` operator does not honor — an argument
containing a literal `"` would produce a parse error of the whole startup script.
Windows file paths cannot contain `"`, so the exposure is limited to a
user-configured CLI argument with a literal quote; the same input was already
mishandled under the previous cmd path (cmd does not use `\"` escaping either), so
this is not a regression. A correct fix requires PowerShell-specific quoting applied
to the pre-assembly argument parts (a `RunPlan`/runner surface change) rather than
re-escaping the already-assembled command line, and is left as a follow-up.
