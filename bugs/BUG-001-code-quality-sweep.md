# BUG-001: Code quality sweep — long files, long functions, missing docs and tests

**Status: Open**

Created: 2026-07-27
Area: Cross-cutting (code quality)
Severity: Low
Extension version: 0.6.x

---

## Summary

The `/finish` code-quality gate (2026-07-27) found no hard-cap violations but surfaced 13 files over 400 lines, 47 functions over 50 code lines, 17 undocumented exports, and 148 modules with no unit test. This report tracks cleanup to the project's own thresholds (file <=700, function <=50, all exports documented). Test coverage is included for visibility but is not gated — expand it where the risk/value ratio justifies it.

Clean areas (no action needed): zero `any` usages, zero hardcoded `show*Message` strings, only 2 TODO/FIXME markers.

---

## 1. Files over 400 source lines

Target: no file over 700 (hard cap); prefer under 400. None currently exceed 700, so this is advisory.

| Lines | File | Notes |
|------:|------|-------|
| 620 | `src/exec/routineRunner.ts` | Largest file; `writeRoutineSummary` alone is 114 lines |
| 602 | `src/test/_stub/vscode.ts` | Test stub — lower priority |
| 516 | `src/exec/actionRunner.ts` | |
| 504 | `src/commands/dailyReport.ts` | |
| 451 | `src/recipes/scheduledRecipes.ts` | |
| 433 | `src/exec/bloatScan.ts` | |
| 432 | `src/exec/processPoll.ts` | |
| 426 | `src/import/favoritesSettings.ts` | |
| 425 | `src/exec/folderWatchEngine.ts` | |
| 425 | `src/model/shortcutStoreRecipes.ts` | |
| 416 | `src/views/setParamsPanel.ts` | |
| 404 | `src/exec/ciStatus.ts` | Also has 5 undocumented exports |
| 403 | `src/views/scheduleEditorAssets.ts` | |

Suggested approach: extract helper functions into sibling modules (e.g. `routineRunnerSummary.ts`) rather than adding abstraction layers. Prioritize the top 3 (routineRunner, actionRunner, dailyReport) since they are closest to the hard cap.

---

## 2. Functions over 50 code lines (top 15)

Target: <=50 code lines per function.

| Lines | Function | File |
|------:|----------|------|
| 134 | `setupSecondaryViews` | `src/activation/wiringViews.ts` |
| 117 | `constructor` | `src/views/shortcutTreeItem.ts` |
| 114 | `writeRoutineSummary` | `src/exec/routineRunner.ts` |
| 92 | `handleLauncherMessage` | `src/views/launcherViewMessages.ts` |
| 74 | `buildAllItems` | `src/views/launcherViewData.ts` |
| 71 | `editCwd` | `src/commands/configureRunEnv.ts` |
| 71 | `switchShortcutSet` | `src/commands/setCommands.ts` |
| 70 | `pollProcesses` | `src/exec/processPoll.ts` |
| 69 | `switchEnvProfile` | `src/commands/envProfiles.ts` |
| 69 | `buildActions` | `src/views/scheduleStatusBarActions.ts` |
| 68 | `linkBranchToSet` | `src/commands/branchSetCommands.ts` |
| 67 | `scanRoot` | `src/exec/bloatScan.ts` |
| 65 | `renderShell` | `src/views/customizePanel.ts` |
| 64 | `buildCiMarkdown` | `src/exec/ciStatus.ts` |
| 64 | `importBookmarks` | `src/import/favoritesKdcroBookmarks.ts` |

32 more functions between 51-63 lines (not listed). Full list: 47 total.

Suggested approach: extract logical blocks into named helpers within the same module. `setupSecondaryViews` (134 lines) and `constructor` in `shortcutTreeItem.ts` (117 lines) are the most urgent — both are more than double the limit.

---

## 3. Undocumented exports (17 total)

Target: all exports carry a doc comment (currently 697/714, 97.6%).

| File | Symbol |
|------|--------|
| `src/exec/ciStatus.ts` | `interface CiStatus` |
| `src/exec/ciStatus.ts` | `function collectCiStatus` |
| `src/exec/ciStatus.ts` | `function parseAnnotations` |
| `src/exec/ciStatus.ts` | `function buildCiMarkdown` |
| `src/exec/ciStatus.ts` | `function registerCiStatusCommand` |
| `src/exec/overnightDelta.ts` | `function collectOvernightDelta` |
| `src/exec/overnightDelta.ts` | `function buildDeltaMarkdown` |
| `src/exec/promptTokens.ts` | `interface InteractiveToken` |
| `src/test/_stub/vscode.ts` | `function __errorMessages` |
| `src/test/_stub/vscode.ts` | `const workspace` |
| `src/test/_stub/vscode.ts` | `function __lastWebviewPanel` |
| `src/test/_stub/vscode.ts` | `function __resetWebviewPanels` |
| `src/views/scheduleStatusBar.ts` | `class ScheduleStatusBar` |
| `src/views/scheduleStatusBarActions.ts` | `function showScheduleStatusBarActions` |
| `src/views/setParamsPanel.ts` | `class SetParamsPanel` |
| `src/views/shortcutsTreeProvider.ts` | *(2 symbols — check file)* |

`ciStatus.ts` accounts for 5 of the 17 — documenting that one file covers nearly a third of the gap.

---

## 4. Unit test coverage (39.3%)

148 of 244 source modules have no matching `*.test.ts` file. This is informational — no coverage gate is enforced. Expanding coverage is worthwhile where modules contain branching logic or have caused regressions.

High-value candidates (non-trivial logic, no test):
- `src/commands/branchSetCommands.ts`
- `src/commands/configureRunEnv.ts`
- `src/commands/setCommands.ts`
- `src/exec/bloatScan.ts`
- `src/exec/processPoll.ts`
- `src/import/favoritesSettings.ts`

Low-value (wiring/glue, skip unless a regression hits):
- `src/activation/wiring*.ts`

---

## Suggested Fix Order

1. **Undocumented exports** — lowest effort, highest signal. One pass through `ciStatus.ts` + `overnightDelta.ts` + `promptTokens.ts` + `scheduleStatusBar*.ts` + `setParamsPanel.ts` closes the gap.
2. **Top 5 longest functions** — `setupSecondaryViews`, `ShortcutTreeItem.constructor`, `writeRoutineSummary`, `handleLauncherMessage`, `buildAllItems`. Each can be split into named helpers without changing behavior.
3. **Longest files** — natural follow-on from splitting functions; `routineRunner.ts` and `actionRunner.ts` are the top targets.
4. **Test coverage** — opportunistic; add tests when touching a file for another reason.

---

## Verification

- [ ] `npx tsc -p ./ --noEmit` clean after each batch
- [ ] `npm run build` succeeds
- [ ] `npm test` passes
- [ ] Re-run the `/finish` code-quality gate and confirm counts drop

---

## Commits

<!-- Add commit hashes as fixes land. -->
