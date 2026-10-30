# Plan: code quality after the Release Board redesign

Status: owner decided D1 option 1 (Phase 0 only) and D2 (extractions A and B as two commits). Phase 0 implemented on branch worktree-agent-a9f56a040ca52c643: A = 0bfd071 (boardPanelEdits.ts), B = b297dab (boardPanelFuture.ts); boardPanel.ts is now 479 lines. Phases 1-3 remain undecided drafts. Smoke checklist not yet run in a development host.
Scope: `extension/src/**` and the quality gate in `scripts/modules/_quality.py`.

`bugs/` holds only `ISSUE_REPORT_GUIDE.md` (no plan-file convention), so this uses the fallback name.

## 1. Goal and why

- Goal: get the release past the quality gate, then pay down the debt the gate reports, without changing behavior.
- The gate blocks publishing because of exactly one file: `src/views/boardPanel.ts` (946 lines by `wc -l`, 947 in the gate; hard cap 700).
- Everything else the gate reports is a warning today. It does not block a release.

### The gate, as written (read from `scripts/modules/_quality.py` and `scripts/audit.py`)

- Thresholds: `FILE_LINES_WARN = 400`, `FILE_LINES_FAIL = 700`, `FUNCTION_LINES_WARN = 50`, `SPARSE_COMMENT_RATIO = 0.05`, `TOP_N = 15`.
- Scope: every `extension/src/**/*.ts` except `*.d.ts` and `*.test.ts`. Test fixtures and stubs under `src/test/` count as source.
- Blocking rule (`QualityReport.failures`): only files over 700 lines. Quote: "Only the hard file-length cap blocks; debt metrics are warnings so a release is never blocked by pre-existing gaps."
- Exit behavior: `run_quality_audit(strict)` returns the count of oversized files only when `strict` is true, else 0. `strict` is true on a full publish and with `python3 scripts/audit.py --quality --strict`. Without `--strict` the same finding prints as "informational; blocks only a full publish."
- Function length: heuristic brace scan, code lines only (comment-only lines excluded), warning at over 50.
- Doc metric: an exported `function|class|const|let|interface|type|enum` counts as documented when the nearest non-blank line above it ends with `*/` or starts with `//`. Re-exports (`export {`, `export * from`) are not counted. House style is `//` WHY-comments, not JSDoc.
- Sparse-comment metric: files under 5% comment lines, except template-dominated files (60% or more embedded template text), which are excused.
- Test metric: `foo.ts` is covered when any `foo.test.ts` exists anywhere under `src/`. It is a name match, not execution coverage. Warning only.
- Consequence for planning: the doc and test metrics are cheap to satisfy by name. The plan targets real coverage anyway (Phase 3 asserts behavior), not name-only stubs.

### Checks to run after every step

- `npm run check-types`, `npm run lint` (same `tsc --noEmit` today), `npm run build`, `npm test` (all in `extension/`, from `extension/package.json`), then `python3 scripts/audit.py --quality --strict` from the repo root.
- Read each exit code directly; no grep/tail pipes.
- The owner's "four checks" are taken here as the first four. Confirm in decision D7.

## 2. Summary table

Current size from the gate output. Targets are for the main file after extraction.

| File | Lines now | Target | Extract to | Phase |
|---|---|---|---|---|
| views/boardPanel.ts | 946 | under 560 | boardPanelEdits.ts, boardPanelFuture.ts | 0 |
| board/org/organizeEdit.ts | 656 | under 350 | organizeLoad, organizeOverrides, organizePreview | 1 |
| board/docFacts.ts | 596 | under 340 | docNeeds, docSteps | 1 |
| views/boardStrings.ts | 538 | under 300 | boardStringsPolish, boardStringsFuture | 1 |
| board/org/autoGroup.ts | 515 | under 280 | autoGroupName, autoGroupTypes | 1 |
| board/severityEdit.ts | 506 | under 320 | severityText, severityPreview | 1 |
| exec/scheduler.ts | 475 | under 300 | schedulerCatchUp, schedulerFire | 1 |
| commands/boardRuleAssign.ts | 473 | under 330 | boardRuleUndo, boardRuleText | 1 |
| board/ruleAssign.ts | 455 | under 330 | ruleSeverity | 1 |
| board/org/linksSignals.ts | 443 | under 330 | linksPhrase | 1 |
| board/scanner.ts | 424 | under 390 | scanFacts | 1 |
| recipes/scheduledRecipes.ts | 418 | under 330 | scheduledGitRituals | 1 |
| board/handoff.ts | 412 | under 330 | handoffMarkdown | 1 |
| views/boardPanelCore.ts | 408 | under 390 | one hook method | 1 |
| board/boardModel.ts | 402 | under 390 | boardModelLinks | 1 |

Functions over 50 code lines (18 found by the gate; the 3 not in the pasted output are `parseCompound` 51 in `src/test/_stub/fakeDomSelect.ts`, `applyRows` 51 in `commands/boardPatch.ts`, `cardsFor` 51 in `board/boardHtmlGroups.ts`):

| Function (file) | Now | Target |
|---|---|---|
| onActionMessage (views/boardPanel.ts) | 89 | 45 or less |
| loadOrganize (board/org/organizeEdit.ts) | 87 | 35 or less |
| organizeFromState (board/org/organizeEdit.ts) | 82 | 35 or less |
| buildBoard (board/boardModel.ts) | 69 | 50 or less |
| checkChange (board/patch.ts) | 68 | 50 or less |
| writeNeeds (commands/boardPatch.ts) | 67 | 50 or less |
| buildOrg (board/boardOrg.ts) | 65 | 50 or less |
| saveSeverityNow (commands/boardSeverityEdit.ts) | 64 | 50 or less |
| futureStrings (views/boardStrings.ts) | 63 | two parts, 35 each |
| phraseSignals (board/org/linksSignals.ts) | 56 | 50 or less |
| applyTextChangeNow (commands/boardRuleAssign.ts) | 56 | 50 or less |
| markdown (board/handoff.ts) | 55 | 50 or less |
| projectRows (board/sidebar.ts) | 55 | 50 or less |
| loadExtraProjects (commands/boardExtraProjects.ts) | 54 | 50 or less |
| losesData (board/ruleAssign.ts) | 53 | 50 or less |
| parseCompound (test/_stub/fakeDomSelect.ts) | 51 | 50 or less |
| applyRows (commands/boardPatch.ts) | 51 | 50 or less |
| cardsFor (board/boardHtmlGroups.ts) | 51 | 50 or less |

Evidence level: `boardPanel.ts` was read in full. For the other files, seams come from the declaration map (every top-level declaration with line numbers) and the importer grep; builders must read each function body before cutting and adjust the line ranges below.

## 3. Phase 0: release unblock (boardPanel.ts only)

Smallest change that turns the gate green: bring `boardPanel.ts` under 700. Nothing else is required to publish.

### Structure today

- `BoardPanelCore` (408) holds state and the scan loop; `BoardPanelWiring` (157) holds listeners; `BoardPanel extends BoardPanelWiring` is the 946-line message handler plus `openBoard()`.
- All state is `protected` on Core, so a method group can move to a new intermediate abstract class with no state change.
- No test imports `boardPanel.ts` (the only grep hit is `dashboardPanel.test.ts`). Nothing to repoint, but nothing guards it either: see the smoke checklist below.

### Extraction A: `src/views/boardPanelEdits.ts` (about 390 lines)

- New `export abstract class BoardPanelEdits extends BoardPanelWiring`.
- Moves from `boardPanel.ts` (current line ranges):
  - Fields and consts: `assigning` (60-61), `UNDO_MS` (49).
  - Busy helpers and `post`: `busyText`, `busyReason`, `baseBusy`, `post` (396-413).
  - The write-with-Undo group: `rowMenu` (417), `needsChange` (471), `writeNeeds` (491), `drop` (503), `docChange` (543), `inlineChange` (558), `offerUndo` (600), `undoChange` (611), `patchApply` (654), `noRule` (368).
  - `openItem` (818), because `rowMenu` calls it; and `tagsRules` + `editorInput` (730-750), because `rowMenu` and `drop` call them.
- Visibility: `private` becomes `protected` for every moved method that `BoardPanel` still calls (`noRule`, `rowMenu`, `drop`, `patchApply`, `undoChange`, `offerUndo`, `openItem`, `tagsRules`, `busyReason`, `busyText`, `baseBusy`, `post`).
- `BoardPanel` then `extends BoardPanelEdits` (or `BoardPanelFuture`, below).

### Extraction B: `src/views/boardPanelFuture.ts` (about 120 lines)

- New `export abstract class BoardPanelFuture extends BoardPanelEdits`.
- Moves: `editing` field (57-58), `futureTarget` (248), `futureEdit` (256), `futureHand` (290), `futureOpen` (319).
- Uses only Core state (`futureShown`, `futureOutsideShown`, `run`, `cached`, `scanning`, `futureSort`, `refreshFuture`), all already `protected`.
- Chain: `Core -> Wiring -> Edits -> Future -> BoardPanel`.

### Result and order

- `boardPanel.ts` after A: about 590. After A and B: about 470 (message router `onMessage`/`onActionMessage`, `tidyMove`, `tidyReport`, `liveBug`, `keywords`, `pathAction`, `reviewAndAccept`, `accept`, `projectsMessage`, `startup`, `scopeItems`, `sendRows`, `openBoard`).
- A alone gets under 700 (margin about 110). B gives room for the next feature and is cheap. Order: A, run checks, commit; then B, run checks, commit.
- Imports: move each import to the file that uses it; delete from `boardPanel.ts` what is unused (`tsc` with `noUnusedLocals` if enabled, else grep).

### Risks

- Cyclic imports: Edits and Future import from `commands/*`, `board/*`, `boardPanelActions`, `boardPanelWiring`. None of them import `boardPanel.ts` (importers of it: `releaseBoardCommands`, `boardBackground`, `processMonitorCommands`, which only use `openBoard`). No cycle.
- Class field order: `post` is an arrow-function field using `this.panel` (set in the Core constructor). Fields initialize after `super()` returns, so the order is unchanged. Keep it a field; do not turn it into a method (it is passed as a callback: `handoffDoc(this.post, ...)`).
- The `current` module variable and `onClosed` stay in `boardPanel.ts` (they reference the concrete class).
- `onMessage` is `protected abstract` in Core; `BoardPanel` keeps the only implementation. Edits and Future stay abstract.
- Behavior drift: moved bodies must be byte-identical except `private` to `protected`. The reviewer diffs with `git diff --color-moved`.

### Smoke checklist (no test covers the panel)

- Open the board; change a status via a row menu; Undo within 10 seconds; let the Undo expire.
- Drag a row to another status band; a Waits on drop; assign a folder rule; apply a pasted patch; Undo the batch.
- Future tab: set a field, hand to chat, open a listed document.
- Tags and rules editor opens and saves; keywords Restore defaults.

### Phase 0 done when

- `python3 scripts/audit.py --quality --strict` exits 0 ("Quality gate clean").
- The four checks pass; the smoke checklist passes in a development host.

## 4. Phase 1: other files over 400 lines and functions over 50

Rules: behavior-preserving; keep the old module's public names via `export { ... } from "./newModule"` so importers and tests need no change; migrate importers in a later, separate commit only if wanted. Re-exports do not count in the doc metric. Order is by risk, lowest first, within what the gate flags.

### 4.1 Pure data and text modules (lowest risk)

- `views/boardStrings.ts` 538 (3 src importers, 9 tests, all via `strings()` and key lists).
  - Move `POLISH_KEYS` (230-501, about 270 lines) and `polishStrings` (502) to `boardStringsPolish.ts`. Re-export `POLISH_KEYS`.
  - Move `futureStrings` (165-229, 63 lines) to `boardStringsFuture.ts` and split into `futureListStrings` + `futureEditStrings`; `strings()` merges them.
  - Risk: key order and key set. Test: `boardStrings.test.ts` plus a new assertion that `Object.keys(strings())` is identical before and after (capture once, compare).
- `board/handoff.ts` 412 (5 importers).
  - Move `preamble`, `markdown` (278, 55 lines), `fenceFor`, `COMMON`, `NO_REV`, `code` (237-334) to `handoffMarkdown.ts`; `buildHandoff` stays and calls it.
  - Split `markdown` into `projectBlock` + `itemBlock` helpers to get under 50.
  - Risk: output text is compared by tests (`handoff.test.ts`, `boardHandoff.test.ts`); keep exact strings.
- `board/docFacts.ts` 596 (12 src importers, 22 tests import it; keep all names re-exported).
  - `docNeeds.ts`: `needsLineParts`, `parseNeeds`, `mapLinks`, `needsSeparators`, `needsTargets`, `stripWrap`, `WRAP_LEAD`, `WRAP_TAIL` (about lines 197-355, 160 lines).
  - `docSteps.ts`: `headingText`, `checkboxText`, `isHeaderRow`, `rowState`, `openRowText`, `scanSteps` (385-497, about 115 lines). Move `DocStep` here and re-export from `docFacts` to avoid a value cycle.
  - Risk: `docFactsHostile.test.ts` exercises limits (`MAX_LINE`, `MAX_FACTS_CHARS`); constants must stay single-sourced.

### 4.2 Org engine (medium risk, pure logic)

- `board/org/organizeEdit.ts` 656 (4 src importers, 5 tests). Also `loadOrganize` 87 and `organizeFromState` 82.
  - `organizeLoad.ts`: `PATCH_KEYS`, `ADD_KEYS`, `keepsUnknownEntries`, `loadOrganize`, `stateFromOrganize` (158-281). Split `loadOrganize` into `readTagsPart`, `readLinkWordsPart`, `readNamingPart`, each about 30 lines, returning the same `Loaded`.
  - `organizeOverrides.ts`: `GROUP_ID`, `groupIdOk`, `cleanGroupOverride`, `groupOverrides`, `setGroupOverride`, `pinOk`, `setAssign`, `setUntag` (532-656, about 125 lines). Needs `editOrganize`, `EditOutcome`, `isStr`: export these from `organizeEdit.ts`, or first move them to `organizeEditCore.ts` (preferred, avoids a cycle).
  - `organizePreview.ts`: `parseImport`, `exportText`, `importDiff`, `testMatch`, `namingPreview` and their types (375-450, about 75 lines).
  - `organizeFromState` (290-374): split into `tagsOf(s)`, `linkWordsOf(s)`, `namingOf(s)` and merge.
  - Risk: round-trip (`loadOrganize` then `organizeFromState`) is relied on by the Tags editor and by `lossy` checks. Test: round-trip property test over the existing fixtures before and after.
- `board/org/autoGroup.ts` 515 (1 importer, no test file).
  - Write a characterization test through public `organize()` first (Phase 3), then split.
  - `autoGroupTypes.ts`: `G`, `Env`, `Node`, `byKey`, `cleanerOf`, `folderOf`, `scoped`, `why`, `push`, `folderLabel`, `make`, `subtree` (17-78).
  - `autoGroupName.ts`: `splitOver` (79-132) and `nameLayer` (133-265, 133 lines; also split into 2-3 steps).
  - Remainder: `other`, `buildTree`, `flatten`, `manualName`, `organize`.
  - Risk: shared mutable `Env`/`G` objects; keep object identity (no cloning).
- `board/org/linksSignals.ts` 443 (3 importers). `phraseSignals` 56.
  - `linksPhrase.ts`: `forwardPattern`, `FORWARD_CACHE`, `BLOCKS_THIS`, `THIS_BLOCKS`, `NEGATED`, `HIGH_PHRASE`, `phraseSignals` (339-417). Extract the per-line match step of `phraseSignals` to get under 50.
  - `Resolver` class (207-265) stays; `phraseSignals` takes it as an argument already.
  - Risk: module-level regex cache (`FORWARD_CACHE`) must stay one instance.
- `board/boardOrg.ts` `buildOrg` 65 (file is 100 lines; only the function splits): extract `layoutsFor(...)` and `groupViews(...)`. Test via `boardOrgWiring.test.ts`.

### 4.3 Board model and rule edits (higher risk, wide fan-in)

- `board/boardModel.ts` 402, `buildBoard` 69 (35 src importers, about 45 tests).
  - `buildBoard` already delegates (`collectItems`, `buildProject`, `attachLinks`...). Move the five `attach*`/`build*` helpers (196-318, about 120 lines) to `boardModelLinks.ts` and keep the `BuildContext` type in `boardModel.ts` (type import only).
  - Split `buildBoard` into `makeContext(...)` and the assembly.
  - Do last in this group: it has the widest blast radius. `export type` and `export { titleFromPath }` re-exports stay as they are.
- `board/ruleAssign.ts` 455 (19 src importers). `losesData` 53.
  - `ruleSeverity.ts`: `SEVERITY_LEVELS`, `SEVERITY_KEY`, `SeverityOverride`, `overrideKey`, `severityOverrides`, `SeverityResult`, `setDocSeverity`, `isDocStatusRule`, `statusRuleLists`, `docStatusKeys`, `clearDocStatus` (323-455, about 130 lines). Re-export all from `ruleAssign.ts`; `boardPanel` and `severityUser.test.ts` import `SEVERITY_LEVELS` from it.
  - `losesData`: extract one named predicate per data-loss case.
  - Risk: `losesData` guards user data on write. Add a table test for each branch before touching it (data-loss class: one fix round allowed here).
- `commands/boardRuleAssign.ts` 473 (7 importers). `applyTextChangeNow` 56.
  - `boardRuleUndo.ts`: `undoRulesWrite`, `undoRulesNow`, `RulesSnapshot` (153-163, 254-303).
  - `boardRuleText.ts`: `readRules`, `sameRead`, `isLink`, `hasUnsavedEdits`, `hasUnsavedCopy`, `linkedRules`, `plainWriteError` (27-71, 176-187, 460-473). `boardPatch.ts` already re-exports `hasUnsavedEdits`/`plainWriteError` from here: keep those paths.
  - Split `applyTextChangeNow` into check-unsaved and write-and-verify.
  - Risk: write ordering and unsaved-edit guards; keep the sequence of awaits exactly.
- `board/severityEdit.ts` 506 (6 importers).
  - `severityPreview.ts`: `PreviewDoc`...`previewChanges` (423-506, about 85 lines).
  - `severityText.ts`: `EditRefusal`, `EditResult`, `rewrite`, `put`, `applyDraft`, `removeSeverity`, `draftOfText`, `dictOfSeverity` (296-420, about 125 lines). Keep `LIMITS` and draft types where they are.
- `commands/boardSeverityEdit.ts` `saveSeverityNow` 64: split into confirm step and write step.

### 4.4 Commands, patch, scanner, runtime

- `board/patch.ts` `checkChange` 68: one validator per op in `PATCH_OPS` (`checkSetStatus`, `checkSetSeverity`, `checkNeeds`, `checkSetGroup`) plus a dispatch table. Tests: `patch.test.ts`, `boardPatchHost.test.ts`. Refusal order must not change (the first refusal wins).
- `commands/boardPatch.ts`: `writeNeeds` (153) 67 and `applyRows` (78) 51. Extract the per-document read/modify/write into one helper used by both. Risk: snapshots for Undo (`BatchSnapshot`); partial failure must still leave an Undo. No test imports this module by name except `boardPatchHost.test.ts`.
- `commands/boardExtraProjects.ts` `loadExtraProjects` 54: extract the per-folder probe-and-read into a helper next to `probe`/`readFolderRules`. Test: `boardExtraProjects.test.ts`.
- `board/sidebar.ts` `projectRows` 55: extract the blocker-row builder. Tests: `sidebar.test.ts`, `umbrellaView.test.ts`.
- `board/boardHtmlGroups.ts` `cardsFor` 51: extract one small helper. Test: `boardHtmlGroups.test.ts`.
- `test/_stub/fakeDomSelect.ts` `parseCompound` 51: split tokenizer from matcher. It is test support with its own test (`fakeDomSelect.test.ts`).
- `board/scanner.ts` 424 (9 src importers, 21 tests): small overage. Move `readPending`, `factsOptions`, `factsKeyOf`, `completeFacts` (317-345, 393-418) to `scanFacts.ts`. Risk: `ScanSnapshot` types stay in `scanner.ts`.
- `exec/scheduler.ts` 475 (class `Scheduler`, 3 test files: `scheduler`, `schedulerCatchUp`, `wiringEngines`).
  - `schedulerCatchUp.ts`: `fireMissedShortcuts`, `runCatchUp`, `waitForIdle`, `fireStartupShortcuts` (110-236, about 125 lines) as functions taking a small context `{ isDisposed, sleep, fire }`.
  - `schedulerFire.ts`: `runAndRecord`, `recordFireResult` and `plainReason` (359-417, 442-448).
  - Risk: timers, `sleepers` and `disposed` are instance state; pass accessors, do not copy values. Tests use fake timers; keep the public `Scheduler` API unchanged. Highest runtime risk in this plan, so do it last and only with the catch-up tests green.
- `recipes/scheduledRecipes.ts` 418 (1 test): move the git ritual set (`sinceYesterdayRitual`, `standupRitual`, `sunriseStatsRitual`, `pushGitRituals`, 228-322) to `scheduledGitRituals.ts`. Data and detectors only; `detectScheduledRecipes` stays.
- `views/boardPanelCore.ts` 408: only 8 lines over the soft cap. Options: leave, or move `refreshEdited`/`scheduleEdited`/`refreshOutside` (224-320) to a helper class. Recommended: leave (decision D3).

## 5. Phase 2: documentation

Metric today: exports documented 2158 of 2439 (88.5%); 281 undocumented; comments 19.5%.

### What a good doc comment looks like here (house style)

- A `//` block directly above the export, stating the reason or the contract in plain language, not restating the name. Examples of the existing style: "The listed document and its project folder for an index the page sent; the index is resolved against the Future list this panel painted, never a path from the page." and "Keeps what the last change replaced for ten seconds; the page's bar is taken away when it ends."
- One to three lines. Say what it returns or guarantees, what the input is trusted to be, and any limit. No plan-decision numbers in comments (repo policy). No restating types.
- For a constant: what it bounds and why that number. For an interface: what one instance stands for.

### Undocumented exports by file (281, from a read-only run of the gate's own counter)

| Count | File |
|---|---|
| 30 | test/plannerWebviewFixture.ts |
| 23 | board/org/organizeEdit.ts |
| 22 | test/launcherWebviewFixture.ts |
| 11 | board/org/tags.ts |
| 10 | board/handoff.ts |
| 9 | board/severityEdit.ts |
| 8 | board/org/orgTypes.ts, board/org/tokens.ts, board/patch.ts, exec/repoChecks.ts, exec/versionChecks.ts, test/dashboardWebviewFixture.ts (8 each) |
| 6 | board/recipeEvidence.ts, test/board/org/orgFixtures.ts |
| 5 | board/futureBlock.ts, board/org/naming.ts, board/releaseReadiness.ts |
| 4 | board/futureResearch.ts, board/placement.ts, board/reportSignals.ts, board/ruleAssign.ts, commands/boardOrganizeEdit.ts |
| 3 | board/org/appearance.ts, board/org/overrides.ts, board/tagsEditorHtml.ts, commands/boardExtraProjects.ts, views/boardChats.ts |
| 2 | 20 files (board/extraProjects, futureList, ganttModel, inProgress, org/layout, org/linksInfer, org/linksSignals, org/settings, reportSummary, commands/boardFuture, boardKeywordSettings, boardRuleAssign, boardSeverityEdit, exec/feedJobs, test/_stub/fakeDom, views/keywordStrings, and others) |
| 1 | 36 files, including the first ones the gate listed (activeNow, boardHtml, boardHtmlDrag, boardHtmlGroups, boardHtmlHandoff, boardHtmlMenus, boardHtmlProjects, boardHtmlUtil, boardMenuPlace, boardOrg, docFacts, scanner, tidy, types, health, openBeside, startupToggle, needsEdit, keywordMark, and views/commands files) |

- Test fixtures account for 60 of the 281 (planner 30, launcher 22, dashboard 8; plus `orgFixtures` 6 and `fakeDom` 2). See decision D4.
- Low-comment files (under 5%): `boardStrings.ts` 2.8% (real code: add a one-line comment per string group), the three `*WebviewFixture.ts` files and `org/frontMatter.ts` 3.5% (document the parsing rules and limits). Template-dominated webview asset modules also show low ratios but the gate already excuses them.
- Method: document in the same commit as any Phase 1 move for the symbols that move (comments travel with the code); handle the rest in batches by directory. Doc-only commits change no code, so the checks are `check-types` and the gate.
- Do not write comments to satisfy the counter (no restating the name). A comment that adds nothing is dropped, not added; if an export needs none, reduce its visibility instead (`export` to local) where nothing imports it. Check with grep before un-exporting.

## 6. Phase 3: tests for untested modules

52 modules have no `*.test.ts` of the same name. The metric is name-based, and some are tested indirectly (for example `linksSignals.ts` is exercised by `boardLinksInfer.test.ts`, `boardPatch.ts` by `boardPatchHost.test.ts`). Each new test asserts behavior; no wall-clock budgets (repo policy: timing tests are best-of-3 with a generous budget, and these need none).

### Group A: pure logic first (highest value, no host needed)

- `board/ganttModel.ts`: row ordering, date-span and clamping on empty and single-item input; same input gives same output.
- `board/boardProposals.ts`: which proposals are offered, rejected keys are excluded, ordering is stable.
- `board/org/layout.ts`: band and MAX stability against `OrgPrevious` (layouts stay stable between runs; a changed group count moves bands as designed).
- `board/org/appearance.ts`: every `OrgColour` has a hex; unknown names fall back; emoji/colour resolution order.
- `board/org/autoGroup.ts`: characterization test through `organize()` on a small fixed document set: group names, nesting, `loose` documents, split of an over-size group. Write before the 4.2 split.
- `board/org/frontMatter.ts`: parse valid, missing, malformed and oversized front matter; unknown keys are preserved; limits enforced.
- `board/org/linksInfer.ts`: inferred links for sequence, stem, phrase and mention signals; confidence levels; the per-document cap.
- `board/boardOrg.ts`: `buildOrg` output shape for 0, 1 and many documents; cache reset via `resetOrgCache`.
- Small pure ones in the same batch: `board/placement.ts`, `board/reportSignals.ts`, `board/org/naming.ts`, `board/org/tags.ts`, `board/org/settings.ts`, `board/org/overrides.ts`, `board/org/orgTypes.ts` (types only: exempt, see D5), `board/patchApply.ts`.

### Group B: page-script and HTML modules (headless render)

- Approach already in the repo: `src/test/_stub/fakeDom*.ts` with a fixture per webview (`launcherWebviewFixture.ts`, `plannerWebviewFixture.ts`, `dashboardWebviewFixture.ts`) and tests such as `launcherScriptFolded.test.ts`. Build a `boardWebviewFixture.ts` the same way (render `renderBoard`, load the page script into the fake DOM, collect posted messages).
- `boardHtmlDrag.ts`: dragging a row onto a band posts a `drop` message with ids only; Alt+Up/Down posts a keyboard move; a drag with no valid target posts nothing.
- `boardHtmlMenus.ts`, `boardHtmlHandoff.ts`, `boardHtmlProjects.ts`, `boardHtmlChats.ts`: each menu entry renders, escapes interpolated values, carries valid ARIA roles, and posts the expected message on click.
- `keywordEditorHtml.ts`, `keywordEditorAssets.ts`, `tagsEditorHtml.ts`, `tagsEditorAssets.ts`: the editor renders with default state; Save posts the state; invalid input shows the problem text.
- Asset modules (big template strings) can only be tested by executing them in the fake DOM; do not assert on the raw string.

### Group C: host-dependent modules

- `commands/boardPatch.ts`, `boardGroupPick.ts`, `boardKeywordSettings.ts`, `boardKeywordPreview.ts`, `boardOrganizeEdit.ts`, `boardRecipeEvidence.ts`, `boardWrite.ts`, `exec/feedJobs.ts`, `views/board*.ts`, `views/tagsEditorPanel.ts`, `views/severityPart.ts`, `views/*Strings.ts`: use `src/test/_stub/vscode*.ts`. Priority: anything that writes user files (`boardWrite`, `boardPatch`, `boardOrganizeEdit`): assert write, refusal and Undo snapshot.
- `views/boardPanel*.ts`: the panel has no tests. After Phase 0, `boardPanelEdits.ts` can be tested with the vscode stub: a message with a stale `rev` is ignored; a busy state refuses a second write; Undo restores and clears the bar. This closes the Phase 0 smoke-checklist gap. Size this separately (decision D6).
- Type-only modules (`model/androidProfileTypes.ts`, `org/orgTypes.ts`) and test fixtures (`orgFixtures.ts`) are better excluded from the metric than given empty tests (D5).

### Test rules

- One behavior per test; assert outputs and posted messages, not internals.
- No `Date.now()` budgets. Use fixed timestamps or the fake frame queue (`page.frames.flush()`).
- New tests follow the style of `launcherScriptFolded.test.ts` (`node:test`, `assert/strict`).

## 7. Rules for the work

- One extraction per PR-sized commit. Behavior-preserving only. No feature work (repo policy: new ideas go to the plan as deferred items).
- After each commit run the four checks and `python3 scripts/audit.py --quality --strict`; read each exit code directly.
- Merge main first (`git merge main` is the first step of every brief; worktrees start from old commits). Merge branches one at a time, oldest first.
- Keep old import paths working with re-exports; migrate importers separately.
- Never raise `FILE_LINES_FAIL`, `FILE_LINES_WARN` or `FUNCTION_LINES_WARN` to pass. Never edit the gate in the same change as the code it measures.
- Characterization test first for any untested module being split (`autoGroup`, `boardOrg`, `losesData`).
- Review: diff review per commit with `git diff --color-moved`; one fix round per build; a second only for data-loss or security (repo policy). Self-check list from `CLAUDE.md` applies to any new HTML or message handling (Group B tests).
- Comments move with their code; no plan-decision numbers in comments.
- Do not touch translated files; l10n key set must not change (run the release audit: `python3 scripts/audit.py --release`).

## 8. Risks and checklist

Risks:

- Panel split with no test net: mitigated by byte-identical moves, smoke checklist and Group C panel tests.
- Re-export barrels hide cycles: check with `npm run build` (esbuild bundle) and a grep that no new file imports its parent for values.
- Webview message handling regresses silently (page and host share message names): do not rename messages; grep each message `type` before and after.
- Scheduler timers and catch-up state: highest runtime risk; last, with fake-timer tests green.
- `losesData` and `ruleAssign` write paths guard user data: table test first.
- Gate heuristics are string-based: a refactor can move a function across the 50-line line by formatting alone; verify with the gate, not by eye.
- Line counts shift as other branches land; re-run the gate before each step.

Checklist (per step):

- [ ] `git merge main` done; tree clean.
- [ ] Code moved byte-identically; only visibility or imports changed.
- [ ] Old names still exported (or importers updated in the same commit, grep-verified).
- [ ] `npm run check-types`, `npm run lint`, `npm run build`, `npm test`: all exit 0.
- [ ] `python3 scripts/audit.py --quality --strict`: exit 0; the file or function it targeted is off the list.
- [ ] `python3 scripts/audit.py --release` unchanged.
- [ ] Smoke checklist run for panel, scheduler and rule-write steps.
- [ ] Commit message names the one change.

## 9. Owner decisions needed

Nothing below is decided.

- D1. Scope before release.
  - Option 1: Phase 0 only (A, or A and B), release, schedule the rest. Recommended: it is the only blocker, and extra refactors delay the release and add regression risk.
  - Option 2: Phase 0 plus the function-length fixes in `boardPanel.ts` before release.
  - Option 3: all of Phase 1 before release.
- D2. Phase 0 size: A alone (about 590 lines, margin 110) or A and B (about 470). Recommended: A and B, as two commits; B is small and adds headroom.
- D3. Soft threshold: keep 400 and 50, or raise any. Recommended: keep both. Never raise to pass. `boardPanelCore.ts` (408) and `boardModel.ts` (402), `scanner.ts` (424) are marginal: recommended to leave `boardPanelCore.ts` and `boardModel.ts` alone unless touched for another reason.
- D4. Exclude test fixtures (`src/test/**/*Fixture.ts`, `src/test/_stub`, `orgFixtures.ts`) from the doc-comment and sparse-comment metrics, or document them. Recommended: exclude them in `_source_files()`/the metric (they are 60 of 281 undocumented exports and 3 of 5 low-comment files); this changes what the gate counts, so it needs your yes and goes in its own commit with the numbers before and after.
- D5. Exclude type-only modules from the "untested" metric, or give them a test. Recommended: exclude; an empty test only satisfies the name match.
- D6. Panel tests (Group C): do them after Phase 0 in this plan, or defer. Recommended: after Phase 0, before Phase 1 touches the board model, since they protect the next steps.
- D7. Confirm the "four checks": this plan assumes `check-types`, `lint`, `build`, `test` from `extension/package.json`. `lint` and `check-types` run the same command today.
- D8. Order after Phase 0: by risk as written (strings, handoff, docFacts, org, model, commands, scheduler), or by user-visible area. Recommended: by risk, lowest first.
- D9. Doc comments (Phase 2): in the same commit as each move (recommended), or one sweep at the end.
