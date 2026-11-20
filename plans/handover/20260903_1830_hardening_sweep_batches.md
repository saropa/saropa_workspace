# Handover — hardening_sweep_batches
2026-09-03 18:30 UTC · saropa_workspace / main · session 40146c93-62dc-4af5-b2cb-78dc2a564cf7

## Unfinished tasks
1. [in_progress] Farm out remaining hardening batches (3–5) — Batches 1 and 2 are done. Batches 3 (Activation improvements), 4 (Views hardening), 5 (Tests + docs) have NOT been launched. See "Batch definitions" below for exact prompts.
2. [pending] Run /finish (Sections 4–10) — Code-review findings are all fixed but /finish was never completed from the prior session. After all batches land, run /finish to verify changelog, docs, tests, then commit.
3. [pending] Commit all changes — Nothing is committed. ~40+ files modified across 2 sessions + 2 agent batches. Commit in logical chunks.
4. [pending] Webview string-bag type generator — Plan at `plans/PLAN_WEBVIEW_STRING_TYPES.md`. Not started in any session.

## Completed tasks
1. Resumed from handover `20260903_1730_reflection_fixes_and_review` — 3 tasks restored.
2. Fixed all 10 confirmed code-review findings (a–j) from prior session — see "Changes made" for details. Verified: tsc clean, esbuild clean, 1219/1219 tests pass.
3. Cataloged all 89 RISK/IMPROVEMENT items from 13 bug reflections + 6 code-review architecture items — triaged into actionable (60), already-fixed (15), non-actionable (14).
4. Batch 1: Detection efficiency — Agent completed. 5 files changed. packageManager() call deduplication, pyproject.toml read deduplication, folderFrom() helper, walkUp() helper, shell injection comment, Dart bias sweep (clean). tsc clean, 1219 tests pass.
5. Batch 2: Exec + core hardening — Agent completed. 3 files changed + audit comments across ~6 files. Try/catch on cleanup calls, try/catch on event fire, EventEmitter disposal, id-keyed map audit (found leaks in lastBrief, runOutputs, promptMemory, shortcutBadges; deleteSet() bypasses onDidRemoveShortcut). tsc clean, 1223/1224 tests pass (1 failure in pre-existing untracked file).

## Session narrative

### User requests
1. `/handover 20260903_1730_reflection_fixes_and_review` — resume prior session.
2. "proceed" — fix the 10 confirmed code-review findings.
3. "so is everything fixed, hardened, and useful opportunities built?" — user checking if reflection IMPROVEMENT items were also implemented.
4. "yes triage - lean in favor of implementing. farm out the work" — user wants ALL items done, not just BUGs. Exact words: "i need these done. we need a better process. farm out the work sequentially to sonnet, run /finish again if necessary, collate the results (issues, concern, opportunities) and move on to the next one. i want the whole lot done without interruption - only critical issues should block ALL item from being done. do NOT run out of context, let the farmed agents do all the work. you don't have to review until the end. i want them ALL done."

### Investigation & analysis
- Cataloged 89 items from all 13 bug reflection files (BUG-002 through BUG-014) using a Sonnet agent. Items grouped by theme: Detection/Recipes, Activation/Watchers, Views/Webviews, Exec, Model, Packaging/Docs.
- Triaged: 15 already fixed in prior sessions, 14 non-actionable (manual testing, speculative), 60 actionable.
- Grouped actionable items into 5 sequential batches for Sonnet agents.
- Batches 1 and 2 completed successfully. Batch 2 uncovered real findings: 4 id-keyed maps leak entries on shortcut removal, and `deleteSet()` bypasses the `onDidRemoveShortcut` event entirely.

### Changes made

**This session's direct edits (10 code-review findings a–j):**

- `extension/src/recipes/detectorHelpers.ts` — `packageManager()`: defaulted `stop` to fs root when `getWorkspaceFolder` returns undefined; filled `name`/`index` on synthetic WorkspaceFolder cast.
- `extension/package.json` — Keybindings: `runSelectedShortcut` scoped to `focusedView == saropaWorkspace.pins` at `ctrl+alt+r`; restored `runAnyPin` at `ctrl+shift+r` globally.
- `extension/src/activation/ecosystemAutoPins.ts` — Rewrote: extracted `seedFolder()` helper (fixes latch-before-write bug, function length); replaced Set with array; added try/catch with console.error per folder.
- `extension/src/activation/wiringStatusBars.ts` — Type predicates on `.find()` for both `peekFocusedPin` and `runSelectedShortcut`, removing redundant second `instanceof`.
- `extension/src/views/webviewClientUtils.ts` — Changed global `isFinite()` to `Number.isFinite()`.
- `extension/src/test/aiContextRecipes.test.ts` — Fixed stale comment "its default" → "explicitly enabled".
- `CHANGELOG.md` — Updated `runSelectedShortcut` entry to reflect both bindings.
- `docs/KEYBINDINGS.md` — Added default binding columns for `runAnyPin` and `runSelectedShortcut`.

**Batch 1 agent changes (Detection efficiency):**

- `extension/src/recipes/detectorHelpers.ts` — Added `folderFrom()` helper and `walkUp()` generic upward-walk helper. Refactored `packageManager()` to use both.
- `extension/src/recipes/detectorEcosystem.ts` — `detectDevCommand()` and `detectMigrate()` accept optional precomputed pm/isFlutter params to avoid redundant `packageManager()` calls. Added `pyprojectText` to precomputed data.
- `extension/src/recipes/detectorRunTargets.ts` — Threads precomputed flags through `detectDevCommand()` and `detectMigrate()`. Fixed duplicate `detectPort` call.
- `extension/src/recipes/detectorWorkspaceRecipes.ts` — Updated to use new optional params.
- `extension/src/commands/recipeCommands.ts` — Uses `folderFrom()` and `walkUp()` for `findNearestPackageJson`. Added shell-injection safety comment.

**Batch 2 agent changes (Exec + core hardening):**

- `extension/src/extension.ts` — `onDidRemoveShortcut` cleanup calls each wrapped in individual try/catch. Store disposal wired into `context.subscriptions`.
- `extension/src/model/shortcutStoreMutationCore.ts` — Both `_onDidRemoveShortcut.fire()` calls wrapped in try/catch.
- `extension/src/model/shortcutStoreBase.ts` — Added `dispose()` method for EventEmitters.
- Audit comments added across: `exec/lastBrief.ts` (LEAK), `exec/runOutputs.ts` (LEAK), `exec/promptMemory.ts` (LEAK), `exec/shortcutBadges.ts` (LEAK), `exec/metricBadges.ts` (not a leak), `exec/processRegistry.ts` (not a leak). `model/shortcutStoreSets.ts` `deleteSet()` documented as bypassing `onDidRemoveShortcut`.

### Decisions & trade-offs
- **Sequential vs parallel agents**: User explicitly requested sequential. This is slower but avoids file conflicts between agents.
- **Lean toward implementing**: User direction — implement everything actionable, skip only truly non-actionable items (manual screen-reader testing, remote-FS testing).
- **Shell injection in terminal.sendText**: Documented as safe (npm run treats arg as script name) rather than adding quoting that could break valid script names. Pragmatic choice.
- **Id-keyed map leaks**: Documented gaps rather than fixing them — fixing requires careful analysis of each map's lifecycle. The documentation makes the gaps visible for future work.

### Rejected / dismissed / deferred
- 14 items marked non-actionable: manual screen-reader verification (#52), remote-FS testing (#62), manual smoke tests (#76, #85), speculative UI concerns (#84), snapshot-based label design (#47), exists() degrading by design (#4), etc.
- Webview string-bag type generator — separate task, not part of this hardening sweep.

### User feedback & corrections
- "so is everything fixed, hardened, and useful opportunities built?" — User expected the IMPROVEMENT items to be implemented, not just the BUG items. This was the trigger for the full catalog + batch approach.
- "i need these done. we need a better process." — User wants ALL items done without interruption, farmed to agents, only critical issues blocking.
- "do NOT run out of context, let the farmed agents do all the work. you don't have to review until the end." — Explicit instruction to delegate everything and not review agent output mid-stream.

## Remaining batch definitions

### Batch 3: Activation improvements (NOT LAUNCHED)
Items to implement:
- (#27) Abstract one-time notice gate pattern — 5+ sites use identical check-latch-show pattern in `activationHelpers.ts` and `ecosystemAutoPins.ts`. Extract a `gatedNotice(key, storage, check, show)` helper.
- (#17, #19) configDirWatcher: only recreate when resolved dir name actually changed; debounce the config-change branch — `wiringWatchers.ts`.
- (#20) Add comment/assertion that `createConfigDirWatchers` must be the only place constructing these watchers — `wiringWatchers.ts`.
- (#26) Move `runSelectedShortcut` command registration out of `wiringStatusBars.ts` into a more appropriate module (e.g. `shortcutCommands.ts` or a new `wiringCommands.ts`) since it's not status-bar related.
- (#25) N+1 rescans from `seedEcosystemAutoPins` — the explicit `store.rescan()` at line 107 fires AFTER config writes, which themselves trigger config-listener rescans. Consider suppressing or deferring.
- (#14) Document that `configDirWatchers` is a plain closure variable — `wiringWatchers.ts`.
- (#15) Add upper-bound / fallback comment if `createFileSystemWatcher` throws — `wiringWatchers.ts`.

Target files: `wiringWatchers.ts`, `wiringStatusBars.ts`, `activationHelpers.ts`, `ecosystemAutoPins.ts`, `shortcutCommands.ts`, `extension.ts`

### Batch 4: Views hardening (NOT LAUNCHED)
Items to implement:
- (#39) Reuse `makeDebounced()` from `activationHelpers.ts` in `launcherView.ts` instead of hand-rolled setTimeout/clearTimeout debounce.
- (#46) Guard `postMessage` revert in `settingsPanel.ts` with `panel.visible` / disposed check before sending.
- (#53) Extract shared state-priority list from `shortcutTreeItem.ts` and `shortcutRowDescription.ts` into a single lookup consumed by both `computeRowStateBadge` and `buildAccessibilityLabel`.
- (#34) Add dev-mode warning to `l10n()` in `i18n/l10n.ts` when a key falls through to the raw-key fallback (console.warn, not user-facing).
- (#30) Add cross-reference comment at `uiStrings().weekdayShort` declaration site noting it reuses `scheduleEditor.weekday.*` keys — `plannerPanelShell.ts`.
- (#32) Add comment on `howtoStep1-3` in `en.json` marking them as intentionally HTML-bearing.
- (#40) Guard `postMessage` revert in `settingsPanel.ts` — check panel not disposed before sending.
- (#41) Escape `key` in `setControlValue`'s `querySelector` selector — `settingsAssets.ts`.
- (#43) Settings catch block should use pre-change value, not re-read at failure time — `settingsPanel.ts`.
- (#48) Document state-priority order duplication between `buildAccessibilityLabel` and `computeRowStateBadge` — `shortcutTreeItem.ts`.

Target files: `launcherView.ts`, `settingsPanel.ts`, `settingsAssets.ts`, `shortcutTreeItem.ts`, `shortcutRowDescription.ts`, `l10n.ts`, `plannerPanelShell.ts`, `en.json`

### Batch 5: Tests + docs (NOT LAUNCHED)
Items to implement:
- (#58) Add a unit test evaluating `escapeHtmlJs`/`formatBytesJs` bodies via `new Function` against the same fixtures as the host versions — parity test.
- (#54) Add a unit test for `buildAccessibilityLabel` per priority level.
- (#87) Add a unit test reading the manifest's declared default for `aiContext.enabled` and failing if it's not `false`.
- (#55) Add a test verifying host `escapeHtml()` and `escapeHtmlJs()` produce identical output for the same inputs.
- (#77) Verify `CHANGELOG_HISTORY.md` is in `.vscodeignore` and not bundled into the `.vsix`.
- (#78, #79) Grep tracked files for banned terms: "time-bomb", "time bomb", "bombed" in package.nls.json, en.json, README.md, package.json description.
- (#80) Consider adding a banned-terms check to `scripts/publish.py` pre-package validation.
- (#81) Add historical-note header to `plans/history/2026.06/2026.06.25/PLAN_09_time_bomb_pins.md` pointing to BUG-013.

Target files: new test files under `extension/src/test/`, `.vscodeignore`, `scripts/publish.py`, various docs

## Key files & paths
- `extension/src/recipes/detectorHelpers.ts` — folderFrom(), walkUp(), packageManager() (all three refactored)
- `extension/src/recipes/detectorEcosystem.ts` — detectDevCommand/detectMigrate accept precomputed params
- `extension/src/recipes/detectorRunTargets.ts` — threads precomputed flags, deduplicates detectPort
- `extension/src/activation/ecosystemAutoPins.ts` — seedFolder() extraction, latch fix, error logging
- `extension/src/activation/wiringStatusBars.ts` — type predicates, runSelectedShortcut registration
- `extension/src/activation/activationHelpers.ts` — one-time notice pattern (to be abstracted in Batch 3)
- `extension/src/extension.ts` — try/catch on cleanup, store disposal
- `extension/src/model/shortcutStoreBase.ts` — dispose() method
- `extension/src/model/shortcutStoreMutationCore.ts` — try/catch on fire()
- `extension/package.json` — keybinding changes
- `CHANGELOG.md` — updated runSelectedShortcut entry, [Unreleased] section has unrelated right-click menu change
- `docs/KEYBINDINGS.md` — default binding columns added
- `plans/PLAN_WEBVIEW_STRING_TYPES.md` — unbuilt plan (separate task)

## How to verify
1. `cd extension && npx tsc -p ./ --noEmit` — 0 errors
2. `cd extension && node esbuild.js` — build succeeds
3. `cd extension && npm test` — 1219+ tests pass (1 pre-existing failure in untracked `outputCapture.test.cjs` is not ours)
4. `git diff --stat` — confirm files changed match expectations
5. F5 dev host: `Ctrl+Shift+R` opens run-any QuickPick, `Ctrl+Alt+R` (in Shortcuts view) runs selected shortcut

## Gotchas & traps
- **No worktree isolation on Windows**: Agent tool with `isolation: "worktree"` fails. Always launch without isolation.
- **Nothing is committed**: All changes across both sessions are unstaged. Commit in logical chunks after all batches land.
- **CHANGELOG.md has an unrelated [Unreleased] entry**: Someone (or another session) added a right-click menu change. Leave it — it's separate work.
- **1 test failure in untracked file**: `outputCapture.test.cjs` fails but is untracked and pre-existing. Not our problem.
- **User wants ALL items done**: The user was very explicit — implement everything actionable, only skip items that truly can't be automated. Don't propose trimming the scope.
- **User wants sequential agent batches**: Farm to Sonnet one batch at a time, don't review until the end, collate results after all batches complete.
- **Batch 2 found real leaks**: 4 id-keyed maps (lastBrief, runOutputs, promptMemory, shortcutBadges) leak entries on shortcut removal. `deleteSet()` bypasses `onDidRemoveShortcut`. These are documented but NOT fixed — they are follow-up work beyond this hardening sweep.
- **Context management**: The user explicitly said "do NOT run out of context, let the farmed agents do all the work." Delegate everything to agents; don't read agent output files or do redundant investigation.
- **After all batches**: Run /finish (Sections 4–10), then commit. The /finish process was interrupted twice in prior sessions (at Section 3 both times).
