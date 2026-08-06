# Fix double toast on external-window script runs

Running a file shortcut routed to an external OS window produced two
simultaneous information toasts: "Running {name}" (from `runShortcut` in
`runner.ts`) and "Launched {name} in a new external window" (from
`runInExternal` in `externalLauncher.ts`). The generic "Running" toast was
unconditional, fired before the location switch, while the external launcher
emitted its own location-specific toast after a successful launch.

## Finish Report (2026-08-06)

**Root cause:** `runShortcut` showed `l10n("run.starting")` for every run
location. The terminal and background paths have no secondary toast, so the
generic one was their only feedback. The external path, however, already
emitted a more descriptive toast from `runInExternal`, making the generic one
redundant.

**Fix (double toast):** Gated the `run.starting` toast behind
`plan.location !== "external"`. Terminal and background runs still receive
the generic toast; external runs receive only their own "Launched…in a new
external window" (or the elevated variant).

**Feature (showRunToasts setting):** Added a `saropaWorkspace.showRunToasts`
boolean setting (default `true`) that lets power users suppress all
run-start toasts across every location — file runs (`runner.ts`), shell
recipe runs (`actionRunner.ts`), routine starts (`routineRunner.ts`), and
external-window launches (`externalLauncher.ts`). Error toasts, warning
toasts (e.g. the elevated-env-drop warning), and background-run completion
toasts are unaffected. The setting appears in the Terminal section of the
Settings panel and is described in `package.nls.json`. The convention is
documented in STYLEGUIDE.md §4.1.

**Hardening:** Removed the unused `import * as path from "path"` in
`runner.ts`. Audited all `showInformationMessage` calls containing run/routine
l10n keys across the codebase — the four gated call sites are the complete
set of run-start toasts; all other toasts are completions, warnings, or
errors and are intentionally ungated.

**Files changed:**
- `extension/src/exec/runner.ts` — external-location guard + showRunToasts read + unused import removed
- `extension/src/exec/externalLauncher.ts` — showRunToasts guard on external toast
- `extension/src/exec/actionRunner.ts` — showRunToasts guard on shell-recipe toast
- `extension/src/exec/routineRunner.ts` — showRunToasts guard on routine-start toast
- `extension/src/views/settingsPanel.ts` — showRunToasts toggle in Terminal section
- `extension/package.json` — new `showRunToasts` configuration property
- `extension/package.nls.json` — setting description
- `extension/src/i18n/locales/en.json` — settings panel label
- `plans/guides/STYLEGUIDE.md` — §4.1 updated with showRunToasts convention
- `CHANGELOG.md` — `[Unreleased]` entries for fix and feature

**Testing:** Type-check passes for all touched files. A pre-existing error
in `wiringViews.ts` (from other uncommitted work) is unrelated to this
change. No existing unit tests cover the `runShortcut` dispatch path (host
API dependency); the change is a manual-verification item in the Extension
Development Host.
