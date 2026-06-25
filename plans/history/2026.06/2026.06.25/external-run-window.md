# External run window with optional administrator privileges

A pinned script could only run in the shared integrated terminal or a background
output channel. This change adds a third run location — a separate OS terminal
window outside VS Code — and an option for that window to be requested with
administrator/elevated privileges.

## Finish Report (2026-06-25)

### Scope

VS Code extension (TypeScript) only. No Dart/Flutter code touched.

### Change summary

The run-location concept was widened from a two-state boolean
(`useIntegratedTerminal`) to a three-value enum so a pin can target a new
external window in addition to the existing integrated terminal and background
channel, plus a per-pin elevation flag that applies only to the external window.

Files:

- `extension/src/model/pin.ts` — added the `RunLocation` type
  (`"terminal" | "background" | "external"`) and two `PinExecConfig` fields:
  `runLocation` (the new source of truth) and `elevated`. The prior
  `useIntegratedTerminal` boolean is retained read-only and documented as
  deprecated so pins written before this change still resolve.
- `extension/src/exec/runner.ts` — added `resolveRunLocation`, the single place
  that reads `runLocation` first and falls back to the deprecated boolean, then
  the `defaultUseIntegratedTerminal` setting. `RunPlan` now carries `location`
  and `elevated` instead of `useTerminal`. `runPin` switches on location;
  `runInExternal` launches a separate window per platform: Windows via PowerShell
  `Start-Process` (`-Verb RunAs` for elevation, `cmd.exe /k` to hold the window
  open), macOS via Terminal.app/AppleScript (`sudo` for elevation), Linux via the
  first available terminal emulator probed with `which` (`pkexec` for elevation).
  An external run is fire-and-forget: VS Code does not own the spawned process,
  so it is not registered for Stop and emits no completion toast — the window is
  the feedback. A failed launch surfaces an error toast; an elevated run that
  drops per-pin env vars surfaces a warning toast.
- `extension/src/commands/configureRun.ts` — the "Run in" hub field now lists the
  external window; an "Administrator privileges" field appears only when the
  external location is selected. On save, `normalize` writes `runLocation` and
  clears the deprecated `useIntegratedTerminal` so a re-saved pin carries the
  location in exactly one field (no two-source drift). `seedLocation` maps the
  deprecated boolean when first opening the editor for an older pin.
- `extension/src/i18n/locales/en.json` — added the picker, toggle, and toast
  strings.

### Rationale for the deprecation approach

`useIntegratedTerminal` is persisted in shipped (`v1.0.0`) pin files, so it
cannot be dropped without breaking stored configs. Reading it in one resolver and
clearing it on the next save migrates pins forward lazily while keeping a single
read-time source of truth.

### Known limitations

- On Windows, an elevated window (`-Verb RunAs`) receives a fresh elevated
  environment; per-pin environment variables do not propagate. This is inherent
  to UAC and is surfaced to the user when it happens.
- macOS and Linux elevation (`sudo` / `pkexec`) is best-effort and was not
  exercised on those platforms; the Windows path is the verified one.

### Verification

- `npx tsc -p ./ --noEmit` — exit 0.
- `node esbuild.js` — exit 0.
- No automated tests exist in the repository; behavior of the external-window
  launch was not run on a device and warrants a manual smoke test.
