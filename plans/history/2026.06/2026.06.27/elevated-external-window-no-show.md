# Elevated external window never opened on Windows

Running a shortcut in a new external window with administrator privileges showed
the "Launched … (approve the elevation prompt)" toast but raised no UAC prompt
and opened no window. The elevated launch was being dropped silently because the
launching PowerShell process was started detached, which removed the desktop the
Windows UAC consent dialog requires.

## Finish Report (2026-06-27)

### Scope

VS Code extension (TypeScript). One source change in
`extension/src/exec/externalLauncher.ts`; changelog entry in the root
`CHANGELOG.md`. No Flutter/Dart, no l10n catalog, no dependency changes.

### Defect

The external-window run path (`runInExternal` → `launchExternalWindows`) builds a
`Start-Process -FilePath 'cmd.exe' -ArgumentList '…' -Verb RunAs` command and runs
it through `child_process.spawn("powershell.exe", …)`. The spawn options included
`detached: true`. On Windows, `detached: true` maps to the `DETACHED_PROCESS`
creation flag, so the launching PowerShell process inherits no window station /
desktop. ShellExecute's `runas` verb (triggered by `-Verb RunAs`) then has no
desktop on which the AppInfo elevation service can display the UAC consent, so the
elevation request is dropped silently: no prompt, no window, and PowerShell still
exits with status 0.

The success toast at the end of `runInExternal` fires unconditionally after
`spawn` returns (spawn does not throw for a command that later fails, and
`stdio: "ignore"` discards PowerShell's output), so the silent failure was
reported to the user as success.

### Diagnosis evidence

A sequence of isolated reproductions, each using a benign `echo` command in place
of the real script, narrowed the cause to the `detached` option alone:

- PowerShell `Start-Process … -Verb RunAs` run from an interactive shell: UAC
  prompt and window appeared.
- `child_process.spawnSync` (attached, console inherited) with `-Verb RunAs`:
  status 0, UAC prompt and window appeared.
- `child_process.spawn` with `detached: true` + `stdio: "ignore"` + `unref()` and
  `-Verb RunAs` (the exact extension path): nothing — no UAC, no window.
- Same command, non-detached: UAC prompt then the window. Only `detached`
  differed between the failing and passing cases.

### Fix

`detached` is now conditional on the elevation flag: `detached: !elevated`.

- Non-elevated launches keep `detached: true` so the new window outlives the
  launching process (the original intent).
- Elevated launches run PowerShell attached, preserving the inherited desktop so
  the UAC consent can be shown. The attached PowerShell exits on its own once
  `Start-Process` hands the work to the independent elevated window, which
  survives regardless.

A block comment at the spawn site records the failure mode and the verified
asymmetry (detached + RunAs shows nothing; non-detached + RunAs shows the prompt)
so the option is not reverted by a later reader.

### Verification

- `npx tsc -p ./ --noEmit` — exit 0.
- `npm run test:unit` — 823 pass, 0 fail. No existing test covers
  `externalLauncher.ts`; it is host-dependent IO excluded from the `node --test`
  harness, so the behavior was validated by the empirical reproductions above
  rather than an added unit test.

### Notes for future maintainers

The unconditional success toast remains: it cannot detect a failure that occurs
asynchronously inside the spawned PowerShell (a `Start-Process` error or a denied
UAC). Distinguishing a real launch from a dropped one would require the launcher
to wait on the elevated process or poll for the new window, which the
fire-and-forget external-run model deliberately avoids. Left unchanged; the
detached fix removes the only known silent-failure path on the elevated route.
