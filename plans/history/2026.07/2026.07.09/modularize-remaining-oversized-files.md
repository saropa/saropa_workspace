# Modularize remaining oversized files, long functions, and undocumented exports

A code-quality scan reported 22 TypeScript source files over the project's
400-line warning threshold (one, `views/launcherAssets.ts` at 843 lines, over the
700-line hard cap), 54 functions over the 50-line function-length guideline, and
109 exported symbols with no doc comment. The scan's own printed report truncates
each category to its worst 15 offenders, so only those were visible up front; the
full totals surfaced only after the visible 15/15/109 were cleared and the audit
was re-run. This is the second modularization pass in this codebase (the first is
recorded at `plans/history/2026.06/2026.06.26/modularize-largest-source-files.md`)
and follows the same conventions that pass established.

## Finish Report (2026-07-09)

### Scope

VS Code extension only (`extension/src/**`, TypeScript). No Dart, no dependency
changes, no docs-only changes. Pure structural reorganization and additive
documentation — intended to be a zero-behavior-change pass.

### What changed

**File splits (the visible 15 of 22 flagged files).** Each split reused one of
three conventions already established in this codebase:

- Barrel re-export (`export *`), matching `model/shortcut.ts`'s existing pattern:
  `model/shortcutStoreShared.ts` now re-exports `shortcutStoreRecipeGroups.ts` and
  `shortcutStoreDefaultGroups.ts`.
- The `ShortcutStore` class-inheritance chain: `shortcutStoreMutationCore.ts` had
  `shortcutStoreAdd.ts` inserted above it; `shortcutStoreMutation.ts` had
  `shortcutStoreFieldUpdates.ts` and `shortcutStoreRestore.ts` inserted above it; a
  file-length regression discovered after the fact in `shortcutStoreRefresh.ts`
  (see below) added a further `shortcutStoreRecipeSeed.ts` layer.
- Feature-suffix command/view splits with either a thin re-import point or a
  STYLE/SCRIPT + fragment-directory split (mirroring the existing
  `plannerAssets.ts`/`plannerScript.ts`/`views/planner/*` pattern):
  `launcherAssets.ts`, `launcherView.ts`, `launcherItems.ts`, `dashboardAssets.ts`,
  `dashboardPanel.ts`, `exec/schedule.ts`, `commands/shortcutSelection.ts`,
  `commands/shortcutInteraction.ts`, `commands/folderWatchCommands.ts`,
  `activation/wiring.ts`, `views/plannerPanel.ts`, `views/shortcutTreeItem.ts`.

`views/launcherAssets.ts` (843 lines, the only file over the 700-line hard cap)
dropped to 347 lines (style only); its script split into `launcherScript.ts` plus
four fragment files under `views/launcher/`.

**Function decomposition (the visible 15 of 54 flagged functions).** Each was
split into named helper functions colocated in the same file, following naming
conventions already present elsewhere in the codebase (`wireX` for activation
wiring, `buildXItems` for QuickPick construction, `detectX`/`pushX` pairs for
recipe categories, `registerXCommands` for command sub-registrars). One function,
`runInBackground`, was only partially decomposed (spawn setup and the `settle()`
closure's dedupe-guard/registry-write ordering were deliberately kept together,
per that file's own header comment defending the single-closure design against a
full split).

**Documentation.** Every exported symbol lacking a comment (109 originally, 120
after the splits above introduced new exports) received a `//` prose comment in
this codebase's house style — no JSDoc exists anywhere in this project; comments
state the *why*, not the *what*.

### Self-introduced regressions caught and fixed before this report

The splits and the doc pass introduced their own debt, all found and corrected in
the same pass rather than left behind:

- Two functions produced by the `shortcutTreeItem.ts` split
  (`buildShortcutTooltipLines`, `buildShortcutRowDescription`) were themselves
  still over 50 lines; both were decomposed further (into
  `buildTooltip{Header,Status,Outcome,Metadata}Lines` and
  `computeRowStateBadge`/`computeRowMetricText` respectively).
- Two files grew past the 400-line warning as a side effect of the function
  decomposition landing in the same file: `commands/configureRun.ts` (to 489
  lines) was split into `configureRun.ts` + `configureRunHub.ts`;
  `model/shortcutStoreRefresh.ts` (to 406 lines) was split into
  `shortcutStoreRefresh.ts` + `shortcutStoreRecipeSeed.ts` (a new chain layer).
- A deep-review pass (five parallel reviewers, one per source-tree area) over the
  full diff caught and corrected eight further issues before this report: a real
  behavior-divergence risk in `injectDefaultGroups` (it re-read
  `vscode.workspace.workspaceFolders` instead of the folder snapshot `refresh()`
  had already captured before its `await`-heavy loop — now passed in explicitly);
  an unused `filterState` field left on `extension.ts`'s `TreeViewParts` after
  extraction; a value import that should have been `import type`
  (`configureRunHub.ts`'s `ConcurrencyEdit`, matching the sibling
  `configureRunMode.ts` convention); a missing doc comment on one of two sibling
  command handlers in `favoritesImportCommands.ts`; a redundant parameter in
  `pushBuildTestLintRecipes` duplicating a value already available on its `flags`
  argument; one vague what-not-why doc comment (`detectorHelpers.ts`'s `url()`);
  one WHY comment dropped (not relocated) during the `shortcutRowDescription.ts`
  extraction; and four new helper functions in the tooltip/description builders
  that had more than three positional parameters, violating this project's own
  "extend an existing options object" rule — all four already had a fitting input
  struct one file away and were changed to accept it directly.
- The review also confirmed one apparent behavior change was not one:
  `detectorRunTargets.ts`'s dependency-recipe grouping reordered the
  install/typecheck/upgrade/clean push sequence relative to compose/migrate/format,
  but `model/shortcutStoreRecipes.ts` already sorts all detected recipes
  alphabetically by label before assigning tree order, so the reorder has no
  observable effect.

### Verification

- `npx tsc -p ./ --noEmit` from `extension/` — clean throughout, including after
  every fix above.
- `node esbuild.js` from `extension/` — production bundle builds throughout.
- The project's own quality audit (`scripts/modules/_quality.py`) confirms: 0
  files over the 700-line hard cap (unchanged — was already 0 before this pass'
  one offender was fixed), 0 undocumented exports (642/642, was 457/566), and
  every one of the 15 originally-flagged long functions now under 50 lines.
- A targeted test run (esbuild-bundled, `node --test`, scoped to the 9 test files
  covering the review-flagged changes: `configureRunEnv`, `configureRunCommand`,
  `setMetric`, `shortcutStoreRefresh`, `suiteRecipes`, `detectorRunTargets`,
  `detectors`, `scheduledRecipes`, `detectorHelpers`) — 76/76 pass.
- No test file exists for `backgroundRunner.ts`, `shortcutRowTooltip.ts`,
  `shortcutRowDescription.ts`, `shortcutsTreeProvider.ts`,
  `configureRun.ts`/`configureRunHub.ts`, or `shortcutCommands.ts` — a pre-existing
  coverage gap the deep-review pass flagged but did not introduce; correctness for
  the logic-bearing extractions in those files (`backgroundRunner.ts`'s
  `attachOutputCapture`/`handleRunSettled` split, the tooltip/description
  builders, the tree provider's root/group child-building) was instead verified
  by a line-by-line diff against the pre-extraction code.

### Not fully in scope (discovered, not addressed)

The scan's report truncated each category to 15 items; the true totals were 22
oversized files and 54 long functions. After this pass, 8 files remain over the
400-line warning threshold (none over the 700-line hard cap) and 42 functions
remain over 50 lines — all pre-existing, none named in the original visible
report. Left untouched pending a decision on whether to extend this pass to the
full totals.

### Unrelated event during this work

A release commit (`chore: release v1.5.17`, tag `v1.5.17`, pushed to
`origin/main`) landed mid-task from outside this work, capturing an incomplete
snapshot of the file splits above (before the function decomposition and
documentation passes, and before the review-pass fixes). Not investigated
further per scope; flagged to the user as an open item.

### Not a behavior change

No control flow, string, default, or persisted-format change was intended or
found, aside from the confirmed-inert recipe-push reorder noted above. The
changelog records this pass under `[Unreleased]` / `### Internal`.
