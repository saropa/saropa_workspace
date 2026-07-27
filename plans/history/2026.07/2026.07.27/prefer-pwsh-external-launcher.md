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

Added a `findOnPath("pwsh")` probe (reusing the existing `interpreterDetect.ts`
utility) at the top of `launchExternalWindows`. When `pwsh.exe` is found on
PATH, both the launcher and the inner window use `pwsh.exe`; otherwise fall back
to `powershell.exe`. The resolved shell name is stored in a single `const shell`
and substituted into both spawn sites — no duplication.

### Scope

One file changed: `extension/src/exec/externalLauncher.ts`. No new dependencies,
no new l10n keys, no new exports.

### Testing

Type-check passes (`npx tsc --noEmit`). No unit tests exist for this module —
it depends on `child_process.spawn` and `vscode.window.*`, which require the
`@vscode/test-electron` harness (not yet wired). Manual smoke test in the
Extension Development Host is the verification path.
