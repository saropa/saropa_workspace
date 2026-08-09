# External launcher: detached wrapper silently failed to open a window

The "run in external window" action reported success (toast shown, exit code 0, no stderr) but no OS window ever appeared. Scripts run fine through the integrated terminal, isolating the defect to the external-window launch path on Windows.

## Finish Report (2026-08-08)

### Root cause

`launchExternalWindows` in `extension/src/exec/externalLauncher.ts` spawned the outer PowerShell wrapper (which runs `Start-Process` to open the real target window) with `detached: true` for non-elevated runs. VS Code's Electron host process runs its child processes inside a Windows Job Object (used for orphan cleanup when VS Code exits). A job object that does not grant `JOB_OBJECT_LIMIT_BREAKAWAY_OK` denies `DETACHED_PROCESS` / `CREATE_BREAKAWAY_FROM_JOB` process creation. The wrapper's own `CreateProcess` call still succeeded (real PID assigned, exit code 0, empty stderr — no error propagated to the launcher), but the `Start-Process` call the wrapper ran internally failed to allocate a console for the target window, so the window never appeared. Because the failure is invisible at every layer the launcher checks (spawn error event, exit code, stderr), the only visible symptom was the pre-existing "launched" success toast with nothing to show for it.

### Diagnosis

Reproduced directly against the reporting user's live machine (with explicit awareness this opens real windows): a minimal Node script spawning `powershell.exe -Command 'Start-Process ...'` with `detached: true` created zero visible processes across five repeated attempts (confirmed via `tasklist`, including waits long enough that a `-NoExit`/`Start-Sleep`-held target would have been caught). The identical spawn with `detached: false` reliably created a real, visible, long-lived process every time — confirmed directly by the reporting user ("hello2 is visible") when a test window opened on their screen.

The `elevated` case had already been fixed earlier (commit 69a5a16, "fix: open the elevated external window on Windows instead of dropping it silently") by making the wrapper non-detached specifically for elevation (`detached: !elevated`), attributed at the time to a UAC/window-station interaction. The new diagnosis indicates the same underlying Job Object mechanism was the actual cause there too, not a UAC-specific one — the elevated path only worked because it happened to already be non-detached.

### Fix

`extension/src/exec/externalLauncher.ts`, `launchExternalWindows`: the outer wrapper spawn no longer sets `detached` (now unconditionally `false` for both elevated and non-elevated runs). `windowsHide: true` was added so the wrapper's own console does not flash on screen — only the real `Start-Process`-launched target window is visible. `child.unref()` is unchanged. The `stdio: ["ignore", "ignore", "pipe"]` stderr-capture path (added in an earlier hardening pass) is unchanged and remains useful for genuine `Start-Process` failures (e.g. a missing interpreter).

### Verification

- `npx tsc -p ./ --noEmit` — clean, zero errors.
- `npm test` — 1208 tests pass, 0 fail (no test file covers this platform-specific spawn path; it requires the VS Code/child_process host, consistent with the project's existing test-scope boundary).
- Manually reproduced the failure and the fix on the reporting user's machine via isolated Node spawn scripts (not the extension itself) before applying the code change, then packaged and installed a local VSIX build with the fix for the user to verify against the real extension.

### Known gaps

- The fix was verified via isolated spawn reproduction, not yet via the actual packaged extension end-to-end (pending user confirmation after reload).
- Whether the target window now survives a hard-kill of VS Code (Task Manager, crash) while running is unverified — the wrapper is no longer detached, so it is plausible (though not confirmed) that the target window's process could still be nested inside VS Code's job object and be torn down if the whole job is killed. The prior `detached: true` attempt at surviving this case did not work at all (proven above), so this is not a regression, but the "outlives VS Code" property itself remains unconfirmed either way.
- `launchExternalMac` and `launchExternalLinux` still use `detached: true` unconditionally. They were not touched, since the Job Object mechanism is Windows-specific and there is no verified evidence of the same defect on those platforms — flagged as an unverified risk, not fixed speculatively.
- A separate, unrelated packaging defect was found while building a local VSIX to test this fix: `vsce package` includes `.claude/settings.local.json` and a stray `undefined/` directory containing test `.cjs` files, because `.vscodeignore` does not exclude them. This affects any already-published release built the same way and was flagged to the user but deliberately left unfixed pending their decision on scope (including whether an already-published version needs republishing).
