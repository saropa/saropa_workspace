# Branch-aware pin sets, run-input enhancements, runner/dashboard module split

A batch of Pins-view features landed alongside the module extractions that
support them: git-branch-bound pin sets, drop-a-file-onto-a-script runs, a
failure-toast fix-command button, and an extract-from-output clipboard capture.
The runner and dashboard modules were split so each carries one responsibility.

## Scope

VS Code extension (TypeScript, `extension/`). No Dart, no docs-only.

## What changed

### Features

- **Branch-aware pin sets.** `saropaWorkspace.branchAware.enabled` (default off)
  plus **Link / Unlink Current Branch to Pin Set** commands bind a git branch to a
  pin set. Checking out a bound branch switches the Pins view to its set and emits a
  toast naming the set and branch; one pin may be designated to run on the switch,
  routed through the normal runner so its output is visible. Inert outside a git
  repository. Bindings are kept per-workspace in `globalState`. New modules:
  `exec/branchSets.ts`, `commands/branchSetCommands.ts`.
- **Drop a file onto a script pin.** Dragging an Explorer file onto a runnable pin
  runs the script against it; the path is exposed as a `$droppedFile` token, or
  appended as the final argument when the token is absent. The saved pin config is
  unchanged — the file applies to the single run.
- **Run-fix button on failure.** A failed background run whose output names an
  install fix (`npm install …`, `pip install …`, `yarn add …`) gets a **Run: …**
  button on the failure toast that executes the full command in the integrated
  terminal. Unrecognized output leaves the toast unchanged.
- **Extract from output.** Configure Run gains a regex field whose first capture
  group is copied to the clipboard when a background run finishes, with a toast. An
  invalid pattern or no match is noted in the output channel and otherwise ignored.

### Refactors (no behavior change)

- `configureRun.ts` and `dashboardPanel.ts` were split, extracting
  `exec/backgroundRunner.ts`, `exec/terminalRunner.ts`, `exec/externalLauncher.ts`,
  `exec/runPlanning.ts`, `exec/actionRunner.ts`, and `views/dashboardAssets.ts`.

## i18n

New manifest commands and config use `%key%` keys in `package.nls.json`; new
runtime strings use `l10n()` keys in `i18n/locales/en.json`.

## Verification

- `npx tsc -p ./ --noEmit` — clean (exit 0).
- `node esbuild.js` — bundle built, no errors.
- `npm test` — 188 pass, 0 fail, including `branchSets.test.ts`.

The root `CHANGELOG.md` Unreleased section already documents the four user-facing
features. No new npm dependencies were added.
