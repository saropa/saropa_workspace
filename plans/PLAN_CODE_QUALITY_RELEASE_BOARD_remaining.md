# Plan: code quality after the Release Board redesign (remaining work)

Status: open. Split from the original plan, which is archived at `plans/history/2026.11/2026.11.20/PLAN_CODE_QUALITY_RELEASE_BOARD.md` (Phase 0 and most of Phase 1 landed there; its goal, gate description and Phase 0/1 seams live in that file).
Scope: `extension/src/**` and the quality gate in `scripts/modules/_quality.py`.

## 1. Open items

### 1.1 Phase 1 residuals (three files missed their size targets)

<!-- quality-table:start -->
| File | Now | Target | Plan |
|---|---|---|---|
| commands/boardRuleAssign.ts | 369 | under 330 | trim by moving the remaining helpers next to `boardRuleText.ts` / `boardRuleUndo.ts`; split `applyTextChangeNow` into check-unsaved and write-and-verify |
| views/boardPanelCore.ts | 432 | under 390 | move `refreshEdited` / `scheduleEdited` / `refreshOutside` to a helper class, or leave (decision D3) |
| board/boardModel.ts | 301 | under 390 | create `boardModelLinks.ts` for the `attach*` / `build*` helpers and split `buildBoard` into `makeContext` and the assembly; widest fan-in (35 importers), do last |
<!-- quality-table:end -->

- Refresh the Now column with `python3 scripts/plan_quality_table.py --write`, then re-run `python3 scripts/audit.py --quality --strict`; line ranges and function lengths in the archived plan are pre-extraction and no longer match.
- Functions over 50 code lines at the time of the original plan were not re-measured after Phase 1; the gate output is the source of truth.

### 1.2 Phase 0 smoke checklist (never run in a development host)


- Open the board; change a status via a row menu; Undo within 10 seconds; let the Undo expire.
- Drag a row to another status band; a Waits on drop; assign a folder rule; apply a pasted patch; Undo the batch.
- Future tab: set a field, hand to chat, open a listed document.
- Tags and rules editor opens and saves; keywords Restore defaults.


## 2. Phase 2: documentation

Metric today: exports documented 2348 of 2355 (99.7%); 7 undocumented, all in files with in-flight edits.

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

## 3. Phase 3: tests for untested modules

52 modules have no `*.test.ts` of the same name. The metric is name-based, and some are tested indirectly (for example `linksSignals.ts` is exercised by `boardLinksInfer.test.ts`, `boardPatch.ts` by `boardPatchHost.test.ts`). Each new test asserts behavior; no wall-clock budgets (repo policy: timing tests are best-of-3 with a generous budget, and these need none).

### Group A: pure logic first (highest value, no host needed)

- `board/ganttModel.ts`: row ordering, date-span and clamping on empty and single-item input; same input gives same output.
- `board/boardProposals.ts`: which proposals are offered, rejected keys are excluded, ordering is stable.
- `board/org/layout.ts`: band and MAX stability against `OrgPrevious` (layouts stay stable between runs; a changed group count moves bands as designed).
- `board/org/appearance.ts`: every org color constant has a hex; unknown names fall back; emoji and color resolution order.
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

## 4. Rules for the work

- One extraction per PR-sized commit. Behavior-preserving only. No feature work (repo policy: new ideas go to the plan as deferred items).
- After each commit run the four checks and `python3 scripts/audit.py --quality --strict`; read each exit code directly.
- Merge main first (`git merge main` is the first step of every brief; worktrees start from old commits). Merge branches one at a time, oldest first.
- Keep old import paths working with re-exports; migrate importers separately.
- Never raise `FILE_LINES_FAIL`, `FILE_LINES_WARN` or `FUNCTION_LINES_WARN` to pass. Never edit the gate in the same change as the code it measures.
- Characterization test first for any untested module being split (`autoGroup`, `boardOrg`, `losesData`).
- Review: diff review per commit with `git diff --color-moved`; one fix round per build; a second only for data-loss or security (repo policy). Self-check list from `CLAUDE.md` applies to any new HTML or message handling (Group B tests).
- Comments move with their code; no plan-decision numbers in comments.
- Do not touch translated files; l10n key set must not change (run the release audit: `python3 scripts/audit.py --release`).

## 5. Risks and checklist

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

## 6. Owner decisions needed

D1 and D2 are closed (Phase 0 only before release, extractions A and B as two commits; both landed). D3-D9 are closed.

- D3. Closed: keep thresholds 400 and 50; leave `views/boardPanelCore.ts` unless touched for another reason; the `boardModel.ts` residual is closed (301 lines).
- D4. Closed: test helpers under `src/test` are excluded from the doc-comment and sparse-comment metrics.
- D5. Closed: type-only modules are excluded from the untested metric.
- D6. Closed: panel tests after Phase 0, before Phase 1 touches the board model.
- D7. Closed: the four checks are `check-types`, `lint`, `build`, `test`; the owner runs `test`.
- D8. Closed: order by risk, lowest first.
- D9. Closed: doc comments in the same commit as each move.
