# organize-output folder-picker prompt

The organize-output library script asked for its target folder through a bare
`${prompt:...}` text box, requiring a hand-typed path with no indication of
what shape of value was expected or where the workspace root even was — a
contributing factor to the earlier incident where a misconfigured/blank answer
pointed the script at the wrong directory.

## Finish Report (2026-07-20)

### What changed

**`extension/src/exec/promptTokens.ts`**: added a third interactive run-token
kind, `${pickFolder:Label}`, alongside the existing `${prompt:...}` (free
text) and `${pick:a,b,c}` (fixed options). It opens a native
`vscode.window.showOpenDialog` folder-browse dialog, defaulting to the
workspace root (or the last-picked folder, if one is remembered for this
shortcut) rather than an empty text box. Resolved and remembered through the
same `resolveInteractiveTokens` / `promptMemory` path as the other two kinds.

**`extension/scripts/library/library.json`**: `organize-output`'s `args` now
use `${pickFolder:Choose the folder to organize (e.g. logs or reports)}`
instead of a free-text `${prompt:...}`.

**`extension/src/i18n/locales/en.json`**: added `prompt.pickFolderFallback`
and `prompt.pickFolderOpenLabel`; updated `scripts.organizeOutput.description`
to describe the folder-browse dialog.

**`extension/src/test/_stub/vscode.ts`**: added a settable
`showOpenDialog` handler (`__setOpenDialogHandler`), matching the existing
input/pick handler pattern, so `${pickFolder:...}` resolution is testable
under `node --test` without the extension host.

**`extension/src/test/promptTokens.test.ts`**: added coverage for
`hasInteractiveTokens` detecting `${pickFolder:...}`, `resolveInteractiveTokens`
resolving it via the dialog (asserting the `defaultUri` is the workspace
root), and the cancel path returning `undefined`.

**`plans/guides/STYLEGUIDE.md`**: documented the new `${pickFolder:...}` token
convention under "Native-first surfaces" — a folder-typed interactive run
token uses a native browse dialog, never a bare free-text prompt.

**`CHANGELOG.md`**: added a `### Fixed` bullet under `Unreleased`.

## Finish Report (2026-07-20, low-friction rerun follow-up)

The first pass above replaced the free-text prompt with a folder-browse
dialog but still asked on every run. The actual requirement was that the
script is set up with a folder once and reruns reuse it with low friction —
matching how a bundled script (unlike a parameterized user shortcut meant to
vary per run) is normally used.

### What changed

**`extension/src/exec/scriptRunner.ts`**: `runLibraryScript` no longer hands
its synthesized shortcut straight to `runShortcut` (which always prompts fresh
via `resolveInteractiveTokens`). It now resolves interactive tokens itself
with `resolveRememberedTokens` first — the same bypass a user shortcut gets
through the explicit "Run with Last Parameters" command — then runs the
already-resolved clone. Only a token never answered before still prompts; once
answered, it is silent on every later run. Canceling the one still-needed
prompt aborts with a toast and nothing executed, same as before.

**`extension/src/test/scriptRunner.test.ts`**: added a test that runs a script
with a `${pickFolder:...}` arg twice — asserts the folder-browse dialog opens
on the first run and is NOT reopened on the second, reusing the remembered
value. Initializes `promptMemory` with a fresh `fakeContext()` per test (the
same pattern `promptMemory.test.ts` uses) so memory does not leak across
tests.

**`CHANGELOG.md`**: extended the existing bullet to describe the low-friction
rerun behavior.

### Tests

`npm test` (extension) — 986 tests pass, 0 failures (8 new across both
passes: 3 `${pickFolder:}` token tests in `promptTokens.test.ts`, 1
low-friction-rerun test in `scriptRunner.test.ts`; the remaining 4 were
already-existing tests this session's earlier work added before compaction).

### Not built (surfaced, not implemented)

Once a bundled script's folder is remembered, there is currently no UI to
change it — only clearing extension workspace state resets it. Pins solve
the equivalent problem by offering both a default (fresh-prompt) Run and a
separate "Run with Last Parameters" command; scripts only have one Run
gesture, and this change makes that gesture the low-friction one, so there is
no remaining "ask again" affordance. Not built without being asked — flagged
here as a likely next request (a "Change folder…" context-menu action on a
script with interactive tokens, calling `promptMemory.forget` then
re-running).

### Verification

- `npx tsc -p ./ --noEmit` — clean.
- `node esbuild.js` — bundle builds.
- Manual smoke test not performed in this environment (no Extension
  Development Host run in this session); the dialog wiring is exercised only
  through the unit tests above and by code inspection against the existing
  `folderWatchAddCommands.ts` `showOpenDialog` usage this pattern was modeled
  on.

## Manual test handoff

### What to test

1. In an Extension Development Host with a workspace folder open, run the
   **Organize output folder** script from the Scripts view.
2. Confirm a native folder-browse dialog opens (not a text input box),
   defaulting to the workspace root.
3. Pick a subfolder (e.g. `logs/` or `reports/`) and confirm the script runs
   against it in the terminal.
4. Re-run the script and confirm the dialog reopens on the previously-picked
   folder (the "remembered last value" behavior).
5. Cancel the dialog (Esc) and confirm the run aborts with nothing executed.

### Not yet verified

- The dialog has not been exercised in a live VS Code host in this session —
  only unit-tested against the `vscode` stub.

### Open questions for you

None — the request ("organize reports script is a mess, too hard to
configure the directory, doesn't explain itself") was addressed directly by
replacing the free-text prompt with a folder-browse dialog; no ambiguous
sub-decision required a check-in.

### Handoff reflection

1. **Least confident about:** (a) whether `showOpenDialog`'s `defaultUri`
   behaves identically across VS Code's Windows/macOS/Linux native dialog
   backends when the path does not exist (the dialog is only opened with a
   real workspace-root URI, so this should not arise in practice); (b) the
   remembered-last-value default when the last-picked folder no longer exists
   on disk — `vscode.Uri.file(lastValue)` is still passed as `defaultUri`
   unconditionally, not verified to exist first; (c) no manual/host-level
   smoke test was run.
2. **If this breaks in 3 months, the most likely reason is:** a future
   shortcut or script author reaches for `${prompt:...}` out of habit for a
   folder-typed argument instead of the new `${pickFolder:...}`, since nothing
   enforces the choice at authoring time beyond the STYLEGUIDE.md convention
   added in this change.
3. **Unstated assumptions:** that a folder-typed run argument is always best
   served by a browse dialog — a scripted/headless or CI-style use of the
   scheduler still cannot use `${pickFolder:...}` (per the existing
   `hasInteractiveTokens` unattended-skip rule, same as `${prompt:...}` and
   `${pick:...}` already).
4. **One unrequested feature:** a "type to filter, or browse…" combined
   QuickPick that lists recently-used folders as one-click chips above a
   "Browse…" option, avoiding the full native dialog for the common
   pick-the-same-folder-again case. Not built — brainstorm only.
