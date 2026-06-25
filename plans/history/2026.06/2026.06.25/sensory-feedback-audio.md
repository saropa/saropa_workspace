# Sensory feedback — audio event cues (recipe book section I, #64)

The recipe book's cross-cutting sensory layer had no implementation: a long-running
or unattended pin run announced its outcome only through an on-screen toast the user
had to be looking at. This change adds opt-in audio cues on run start, success, and
failure, using the operating system's own built-in sounds, with global settings and a
per-pin override.

## Finish Report (2026-06-25)

### Objective

Give a long-running or unattended pin run an audible outcome — a start cue and
distinct success/failure tones — without a bundled audio asset, an extra webview, or
any change to the existing visible-toast behavior.

### Playback-path decision (recorded, not assumed)

The recipe book asked for the playback path to be settled rather than presumed. The
cue uses the platform's own playback of its built-in system sounds:
`[System.Media.SystemSounds]::{Beep|Asterisk|Hand}.Play()` on Windows, `afplay` of a
`/System/Library/Sounds/{Tink|Glass|Basso}.aiff` on macOS, and `canberra-gtk-play -i
{bell|complete|dialog-error}` (falling back to `paplay` of a freedesktop `.oga`) on
Linux. Chosen over (a) a hidden webview hosting an `<Audio>` element — which would add
a bundled sound asset and a webview kept alive only to play a cue — and (b) the
editor's accessibility-signal surface, which is a user-configured editor feature, not
an extension-triggerable API with distinct custom outcomes. The system-sound path
needs no bundled asset, gives distinct success/failure tones, and inherits the OS
master volume and mute.

### What changed

- **`extension/src/exec/soundCue.ts` (new).** The cue engine. `playCue(event,
  override?)` decides whether to play (master toggle is the hard gate; a per-pin "on"
  bypasses the per-event toggles but still needs the master on; a per-pin "off"
  silences the pin) and spawns the platform player detached, ignoring output and
  swallowing every error — a cue is a convenience, never a failure path. Records the
  playback-path and haptics decisions in its header.
- **`extension/src/model/pin.ts`.** New `SoundOverride` type and `PinExecConfig.sound`
  field (extends the existing exec-config object rather than a parallel parameter).
- **`extension/src/exec/runner.ts`.** Emits the start cue in `runPin` (every location;
  honoring the pin override) and in the recipe shell-run path, and the success/failure
  cue in the background-run `settle()` (override threaded via a new optional
  `soundOverride` param) and in the captured-to-report finish. Terminal and
  external-window runs have no tracked exit, so they cue only on start — a documented
  limitation, not a gap.
- **`extension/src/commands/configureRun.ts`.** An **Audio cues** hub field
  (follow-settings / always / never) to set the per-pin override, mirroring the
  existing fileArg/extract field pattern, persisted via `normalize`.
- **Manifest / l10n.** Four `saropaWorkspace.sound.*` settings in `package.json`;
  descriptions in `package.nls.json`; the Configure Run field/option strings in
  `src/i18n/locales/en.json`.
- **Docs.** Root `CHANGELOG.md` "Added" entry; `plans/RECIPE_BOOK.md` marks section I
  (#64) shipped as audio, haptics deferred.

### Deferred

Haptics: VS Code exposes no first-party haptic API, so there is no platform path; no
haptic setting is offered (it would promise what cannot be delivered). Do-Not-Disturb /
focus-mode suppression is not implemented — that state is not cheaply readable from a
Node extension cross-platform; the OS mute/volume already governs the cue.

### Verification

Full-project `tsc -p ./ --noEmit` clean (0 errors); `esbuild` bundle builds (exit 0).
No automated test harness exists in this repository, so the actual sound playback per
platform and the gating logic are verified manually (see the handoff). The pure gating
function (`shouldPlay`) is unit-testable once a runner is established.
