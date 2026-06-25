# Phase 3 start: sibling favorites scan, run-status, interactive run tokens

The Saropa Workspace extension entered roadmap Phase 3 with a cross-project
favorites importer, gained a last-run status surface and interactive run-time
parameter tokens (two roadmap "standout" items), and had three correctness/UX
defects in the existing tree and runner corrected.

## Finish Report (2026-06-24)

### Scope

VS Code extension only (`extension/src/**`, TypeScript) plus documentation
(`ROADMAP.md`, root and extension `CHANGELOG.md`). No Dart/Flutter code. The
extension carries no automated test suite yet (roadmap Phase 6 is the dedicated,
not-yet-started test phase), so pure-logic additions were verified by inspection
and by a full `tsc --noEmit` type-check plus an esbuild bundle.

### Changes

**Sibling-projects favorites scan (roadmap 3.1, partial).**
`favoritesImport.ts` gained `detectSiblingFavorites()` and
`importSiblingFavorites()`. The scan looks one directory level up from each open
workspace folder, detects favorites files in the immediate sibling folders —
kdcro101 `.favorites.json` (absolute paths) and the extension's own
`.vscode/saropa-workspace.json` (folder-relative paths) — and imports a
user-selected subset. A sibling favorite is an absolute path outside the current
workspace folder, so it cannot be a folder-relative project pin; it is therefore
added as a global pin. The scan is exposed as an explicit, user-invoked command
(`saropaWorkspace.scanSiblingFavorites`) with a pre-checked multi-select
QuickPick; it never runs automatically on activation, preserving the
no-surprise posture for cross-project disk reads. Import reuses the store's
absolute-path de-duplication, so re-running is idempotent. Open sibling folders
are skipped (their favorites are project pins) and shared parents/files are
de-duplicated.

**Last-run status in the tree (roadmap 7.2).** A new in-memory, per-session
`runStatus.ts` registry records the last completed background run per pin
(outcome, exit code, duration, end time). It is never persisted and never
transmitted (no telemetry). The runner records into it on process `close`/`error`,
and `pinTreeItem.ts` renders a green check (`testing.iconPassed`) or red error
(`testing.iconFailed`) icon, a compact inline badge (`ok 2.3s` / `exit 1 2.3s`),
and a tooltip line. The background runner now also surfaces completion: a quiet
info toast on success, and an error toast with a one-click "Show Output" button
on failure. A `saropaWorkspace.showOutput` command reveals the shared output
channel from the view-title overflow and each pin's context menu. Only background
runs are tracked; integrated-terminal runs are interactive and, at the
extension's minimum VS Code version, expose no exit code.

**Interactive run-parameter tokens (roadmap 7.1).** A new `promptTokens.ts`
resolves `${prompt:Label}` (input box) and `${pick:a,b,c}` (QuickPick) tokens in a
pin's command, arguments, or working directory at run time. A token reused across
fields is asked once; canceling any prompt aborts the run with nothing executed
and the stored pin unchanged (substitution clones the pin for that run only).
These are distinct from the static `$name` tokens (`tokens.ts`) because they
require async UI. The scheduler is guarded by `hasInteractiveTokens`: an
unattended scheduled fire cannot answer a prompt, so a scheduled pin with
interactive tokens is skipped with an output-channel note and its schedule is
advanced (preventing a same-slot tight loop). The Configure Run help text lists
the token forms inline.

### Defects corrected

1. **Section headers showed per-pin actions.** `PinGroupItem.contextValue` was
   `"pinGroup"`, which matched the per-pin menu `when` clauses (`viewItem =~
   /^pin/`), leaking Run / Unpin / Rename onto the Project Pins and Global Pins
   headers. The value is now `"group"`. A header has no single file to act on.

2. **Non-runnable files were thrown at the shell.** Double-clicking a pin with no
   interpreter (a `.txt`, `.md`, an image) assembled a bare file path and ran it
   as a command. `isRunnable()` now gates this: a pin is runnable only when it has
   an explicit command (including an explicit empty string, i.e. a deliberate
   direct run) or its extension has a configured default interpreter. A
   non-runnable pin opens instead (the open is the visible feedback) and an info
   toast explains it has no run command. Configured/interpreter-backed pins run
   exactly as before.

3. **Failed background spawn could double-report.** Node can emit both `error`
   and `close` for one failed run. The background runner now settles once behind a
   `settled` flag, so the status is recorded and the toast shown a single time.

### i18n

All new user-facing strings are externalized: the command title via the NLS
`%key%` pipeline (`package.nls.json`); runtime strings via `l10n()` and
`src/i18n/locales/en.json`. The dead `run.noInterpreter` key (defined, never
referenced) was removed.

### Verification

`npx tsc -p ./ --noEmit` clean and `node esbuild.js` bundles successfully after
each change. No automated tests exist to run; behavior was audited by inspection.
Candidates for roadmap 6.1 when the test harness lands: `formatDuration`
boundaries, `isRunnable` truth table, interactive-token collection/dedup and
cancel handling, and sibling-scan path resolution for both source formats.
