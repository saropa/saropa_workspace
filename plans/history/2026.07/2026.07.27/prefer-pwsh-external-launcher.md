# Prefer pwsh over powershell.exe in external launcher

The external terminal window on Windows always launched in Windows PowerShell 5.1
(`powershell.exe`), which opens the legacy blue console. When PowerShell 7+
(`pwsh.exe`) is installed, the modern shell should be preferred.

## Finish Report (2026-07-27)

### Defect

`launchExternalWindows` in `extension/src/exec/externalLauncher.ts` hardcoded
`powershell.exe` in two places: the outer `cp.spawn` launcher and the inner
`Start-Process -FilePath` target. Every external-window run opened the legacy
blue Windows PowerShell 5.1 console regardless of whether PowerShell 7+ was
installed.

### Fix

A module-level `windowsShell()` function probes PATH for `pwsh.exe` via the
existing `findOnPath` utility in `interpreterDetect.ts`, caches the result for
the session, and returns both a `name` (for `Start-Process -FilePath`) and an
absolute `path` (for `cp.spawn`, avoiding a redundant PATH lookup by Node).
Falls back to `powershell.exe` when `pwsh` is not installed.

### Hardening verification

All six reflection items from the initial /finish were investigated:

1. **`-Verb RunAs` with pwsh**: `Start-Process -Verb RunAs` uses `ShellExecute`
   under the hood, which resolves the `-FilePath` via PATH identically for
   `pwsh.exe` and `powershell.exe`. The `detached`-vs-non-detached gate (already
   present) ensures the UAC consent desktop is available. No code change needed.
2. **`findOnPath` latency**: now called once per session (cached). Negligible.
3. **Binary name**: `findOnPath("pwsh")` iterates PATHEXT suffixes (`.EXE` first)
   and Windows filesystem lookups are case-insensitive — matches `pwsh.exe`
   regardless of casing on disk. MSI, Store, Scoop, and Chocolatey all install
   as `pwsh.exe`.
4. **`buildWindowsStartup` 5.1-specific cmdlets**: verified the startup script
   uses `Set-PSReadLineOption -HistorySavePath`, `.NET` `WriteAllLines`, and
   `Set-Location` — all compatible with PSReadLine v1 (5.1) and v2 (7+).
5. **PSReadLine history seeding in pwsh 7**: PSReadLine v2 loads
   `HistorySavePath` at the first interactive prompt, same as v1. No difference.
6. **`shell: true` in backgroundRunner/actionRunner**: these run arbitrary user
   commands through `cmd.exe` on Windows. Changing them to pwsh would break
   existing command syntax. Out of scope — correct as-is.

### Scope

One file changed: `extension/src/exec/externalLauncher.ts`. No new dependencies,
no new l10n keys, no new exports.

### Testing

Type-check passes (`npx tsc --noEmit`). No unit tests exist for this module —
it depends on `child_process.spawn` and `vscode.window.*`, which require the
`@vscode/test-electron` harness (not yet wired). Manual smoke test in the
Extension Development Host is the verification path.
