# Handover — code_quality_remaining_work_and_plan_remeasure_script
2026-11-20 11:33 EST · saropa_workspace / main · session 25a2d1b1-d16c-4f82-ab09-8a11b9a5d776

Goal (verbatim): do the remaining work in plans/PLAN_CODE_QUALITY_RELEASE_BOARD_remaining.md (Phase 1 residuals: boardRuleAssign.ts, boardPanelCore.ts, boardModel.ts; Phase 2 docs; Phase 3 tests; decisions D3-D9 open, use the plan's recommendations) AND build the previously brainstormed unrequested feature: a script that re-measures the plan's summary table from the quality gate output so numbers never go stale.

## Corrections carried forward
- "Machine safety": agents never run `npm test`, mocha or any full-suite / compile-heavy command (it has crashed the owner's machine). `tsc --noEmit` at most once, only when the brief allows. The owner runs the full suite. (source: repo `CLAUDE.md`)
- Never resume a stopped agent without first checking its worktree (`git status`, `git diff --stat`) and reporting to the owner. (source: repo `CLAUDE.md`)
- A worktree starts from an old commit: first step of every brief is `git merge main`. (source: repo `CLAUDE.md`)
- Review cap: one fix round per build; a second only for data-loss or security findings. (source: repo `CLAUDE.md`)
- American English is enforced by a write-time hook (`scripts/hooks/spelling_guard.py`). It blocks any edit to a file that already contains a British spelling, even one you did not write. The codebase has an org color type and a hex-map constant spelled the British way in `board/org/appearance.ts`, so never write those identifiers in markdown; say "org color constant" instead. (source: this session)
- Never hard-wrap markdown prose: one bullet or paragraph per source line. (source: memory `no-hard-wrapping-prose.md`)
- Every code comment must explain WHY; missing comments are a critical defect; update CHANGELOG with every code change (root `CHANGELOG.md`, under `## [Unreleased]`; never edit `extension/CHANGELOG.md`). (source: global `CLAUDE.md`)
- No AI/Claude/Anthropic mention anywhere in commits, public docs, code comments. Commit format `type: description`; no Co-Authored-By; in Bash use repeated `-m` flags. (source: global and repo `CLAUDE.md`)
- Never run Dart/Flutter static analysis CLIs (not relevant here, TS repo). Never edit the quality gate in the same change as the code it measures; never raise `FILE_LINES_FAIL`, `FILE_LINES_WARN`, `FUNCTION_LINES_WARN` to pass. (source: plan section 4)
- Model rule: recommend Sonnet for implementation; session is on `claude-sonnet-5-5`. Opus only for planning.

## Session chain
- (this handover) — `docs/handover/20261120_1133_code_quality_remaining_work_and_plan_remeasure_script.md` — plan audit, plan archive/split, handover for the remaining work
- (commit `0813a28`, 2026-11-20) — no handover — archived the original plan to `plans/history/2026.11/2026.11.20/PLAN_CODE_QUALITY_RELEASE_BOARD.md` and created `plans/PLAN_CODE_QUALITY_RELEASE_BOARD_remaining.md`
- (commit `ea72610`, 2026-11-20) — no handover — refreshed the plan's status, summary table and decisions to match the landed Phase 0/1 work
- `20261120_1057_release_board_plans_not_blockers.md` — `docs/handover/20261120_1057_release_board_plans_not_blockers.md` — earlier session; lists dirty-tree files not from that session (leave them alone)
- Branch `worktree-agent-a9f56a040ca52c643`: Phase 0 extractions A = `0bfd071` (boardPanelEdits.ts), B = `b297dab` (boardPanelFuture.ts); Phase 1 extractions also landed (commit hashes not recorded; verify with `git log`).

## Unfinished tasks
1. [pending] Phase 1 residual: `extension/src/board/boardModel.ts` is 426 lines (target under 390). Create `board/boardModelLinks.ts` for the `attach*` / `build*` helpers and keep the `BuildContext` type in `boardModel.ts` (type import only); split `buildBoard` (was 69 lines) into `makeContext(...)` and the assembly. 35 src importers, about 45 tests, so keep every export (`export type`, `export { titleFromPath }`) and do this last. Re-read the file first; the plan's line ranges (196-318) are pre-extraction.
2. [pending] Phase 1 residual: `extension/src/commands/boardRuleAssign.ts` is 361 lines (target under 330). `boardRuleUndo.ts` and `boardRuleText.ts` already exist. Move what remains that belongs with them and split `applyTextChangeNow` (56 lines) into check-unsaved and write-and-verify. Keep the sequence of awaits exactly; `boardPatch.ts` re-exports `hasUnsavedEdits` / `plainWriteError` from here, keep those paths. Characterization / table test first for the write path (data-loss class: one fix round allowed).
3. [pending] Phase 1 residual: `extension/src/views/boardPanelCore.ts` is 432 lines (grew 24 since the plan; target under 390). Decision D3 recommends leaving it unless touched for another reason. Default: leave, record the ruling in the plan. Only extract (`refreshEdited` / `scheduleEdited` / `refreshOutside` to a helper class) if the owner says so.
4. [pending] Phase 1 functions: the 18 over-50-line functions were never re-measured after Phase 1. Run `python3 scripts/audit.py --quality --strict` (and `python3 scripts/audit.py --quality`) from repo root, read the exit code, and fix what it still lists (candidates: `buildBoard`, `checkChange` in `board/patch.ts`, `writeNeeds` / `applyRows` in `commands/boardPatch.ts`, `buildOrg` in `board/boardOrg.ts`, `saveSeverityNow`, `phraseSignals`, `projectRows` in `board/sidebar.ts`, `loadExtraProjects`, `losesData`, `parseCompound`, `cardsFor`).
5. [pending] Decisions D3-D9: apply the plan's recommendations as rulings and record them in `plans/PLAN_CODE_QUALITY_RELEASE_BOARD_remaining.md` as the ruling only (no trailing justification). D3 keep thresholds, leave `boardPanelCore.ts` / `boardModel.ts` unless touched. D4 exclude test fixtures from doc and sparse-comment metrics (changes the gate: own commit, numbers before and after, needs the owner's yes: ASK before editing `scripts/modules/_quality.py`). D5 exclude type-only modules from the untested metric (same gate caveat). D6 panel tests after Phase 0, before Phase 1 touches the board model. D7 "four checks" are `check-types`, `lint`, `build`, `test` (owner runs `test`). D8 order by risk. D9 doc comments in the same commit as each move.
6. [pending] Phase 2 documentation: 281 undocumented exports (counts per file in the remaining plan, section 2). House style is a `//` WHY-comment of one to three lines directly above the export; never restate the name; no plan-decision numbers. If an export needs no comment and nothing imports it, un-export it (grep first). Test fixtures (60 of the 281) wait on D4. Do it in batches by directory; checks are `tsc --noEmit` at most once plus the gate.
7. [pending] Phase 3 tests: 52 modules lack a same-name `*.test.ts`. Order: Group A pure logic (`ganttModel`, `boardProposals`, `org/layout`, `org/appearance`, `org/autoGroup` characterization, `org/frontMatter`, `org/linksInfer`, `boardOrg`, `placement`, `reportSignals`, `org/naming`, `org/tags`, `org/settings`, `org/overrides`, `patchApply`), then Group B (build `boardWebviewFixture.ts` like `launcherWebviewFixture.ts`; tests for `boardHtmlDrag`, menus, handoff, projects, chats, keyword and tags editors), then Group C host-dependent (`boardWrite`, `boardPatch`, `boardOrganizeEdit` first: assert write, refusal and Undo snapshot; panel tests for `boardPanelEdits.ts`: stale `rev` ignored, busy refuses a second write, Undo restores). Style: `node:test` + `assert/strict`, no `Date.now()` budgets. Agents must NOT run the tests; write them and hand the owner the command.
8. [pending] The unrequested feature: a Python script (durable scripts are Python; put it in `scripts/`, check the existing layout first) that runs the gate (`scripts/audit.py --quality`), parses the file-length and function-length output, and rewrites the plan's summary table (Was / Target / Now / Result) so numbers never go stale. Search `scripts/modules/_quality.py` for a reusable measurer before writing a parser. Do not edit the gate in the same change. Note the plan files are not generated, so decide whether the script prints the table or rewrites a marked block; one proposed action: print markdown to stdout and rewrite only between `<!-- quality-table:start -->` / `<!-- quality-table:end -->` markers, which also means adding the markers to the remaining plan. Add a test under `scripts/` only if a Python test convention exists there.
9. [verify] Run the Phase 0 smoke checklist (remaining plan, section 1.2) in a development host: change a status via row menu, Undo within 10 s, let Undo expire; drag a row to another band; assign a folder rule; apply a pasted patch and Undo the batch; Future tab set field / hand to chat / open document; tags and rules editor opens and saves; keywords Restore defaults. Owner action, not an agent task.
10. [verify] After each step the owner (not an agent) runs `npm run check-types`, `npm run lint`, `npm run build`, `npm test` in `extension/` and `python3 scripts/audit.py --quality --strict` and `python3 scripts/audit.py --release` from the repo root.

## Completed tasks
1. Plan audit — a read-only sub-agent compared the plan to the tree: Phase 0 done (boardPanel.ts 477 lines, boardPanelEdits.ts 480, boardPanelFuture.ts 99, class chain Core -> Wiring -> Edits -> Future -> BoardPanel confirmed); 20 of 21 Phase 1 extraction files exist (all except `boardModelLinks.ts`); gate thresholds unchanged (400 / 700 / 50 / 0.05). Verified by `wc -l` and grep in the sub-agent; the main session did not re-measure.
2. Plan refresh — commit `ea72610` (only `bugs/PLAN_CODE_QUALITY_RELEASE_BOARD.md` staged): status line, summary table with Was/Target/Now/Result, Phase 0 and 1 headers, decisions D1/D2 closed, spelling fixed.
3. Plan archive and split — commit `0813a28`: original moved to `plans/history/2026.11/2026.11.20/PLAN_CODE_QUALITY_RELEASE_BOARD.md` with a `## Finish Report (2026-11-20)` section; open work in `plans/PLAN_CODE_QUALITY_RELEASE_BOARD_remaining.md` (sections: 1 open items, 2 Phase 2, 3 Phase 3, 4 rules, 5 risks and checklist, 6 decisions D3-D9).

## Session narrative

### User requests
1. "review to fix: D:\src\saropa_workspace\bugs\PLAN_CODE_QUALITY_RELEASE_BOARD.md"
2. "commit this"
3. "why is the doc not archived?"
4. "finish the work" (ran the `/finish` skill; docs-only scope)
5. "do the remaining work - including the unrequested feature" (triggered this handover because context passed 300k)

### Investigation & analysis
- The plan read as future work although Phases 0 and 1 had landed. A read-only sub-agent measured current line counts for all 15 summary-table files and checked for the 21 planned extraction files.
- Current sizes: boardPanel 477, organizeEdit 113, docFacts 308, boardStrings 201, autoGroup 269, severityEdit 97, scheduler 249, boardRuleAssign 361 (miss), ruleAssign 209, linksSignals 249, scanner 372, scheduledRecipes 249, handoff 318, boardPanelCore 432 (miss, grew), boardModel 426 (miss).
- Archive convention: no written rule; `plans/history/YYYY.MM/YYYY.MM.DD/` is what exists. The only reference to the old `bugs/` path was in a git-ignored handover note, left unchanged.
- Spelling guard: it blocks on pre-existing British spelling in the file being edited (plan line 250, a British spelling of "color"), not only on new text.

### Changes made
- `plans/history/2026.11/2026.11.20/PLAN_CODE_QUALITY_RELEASE_BOARD.md` (moved from `bugs/`): status line, summary table, phase headers, decisions, spelling, finish report.
- `plans/PLAN_CODE_QUALITY_RELEASE_BOARD_remaining.md` (new, 142 lines): generated by a shell `sed` extraction of the old plan's sections 5-9, renumbered to 2-6.
- No source code was changed in this session.

### Decisions & trade-offs
- Treated the three misses as open work rather than rewriting the targets (never raise the thresholds).
- Archived the original and split the rest because Phases 2-3 are not started (the `/finish` partial-complete rule).
- Left the git-ignored handover note's stale `bugs/` reference alone.

### Rejected / dismissed / deferred
- Leaving the plan in `bugs/` (option 1 offered to the owner) was superseded by "finish the work".
- Phase 2/3 not started in this session; deferred to the next one for context reasons (hook warned at about 321k tokens).

### User feedback & corrections
- None explicit from the user this session. The spelling hook acted as a correction on a British spelling of "color".

## Key files & paths
- `plans/PLAN_CODE_QUALITY_RELEASE_BOARD_remaining.md` — the live plan to execute.
- `plans/history/2026.11/2026.11.20/PLAN_CODE_QUALITY_RELEASE_BOARD.md` — archived original (gate description in section 1, Phase 0/1 seams).
- `scripts/modules/_quality.py`, `scripts/audit.py` — the gate (read-only for this task).
- `extension/src/board/boardModel.ts`, `extension/src/commands/boardRuleAssign.ts`, `extension/src/views/boardPanelCore.ts` — the three residual files.
- `extension/src/views/boardPanelEdits.ts` — write-with-Undo group; target of the panel tests.
- `extension/src/test/_stub/vscode*.ts`, `extension/src/test/launcherScriptFolded.test.ts` — test stubs and style reference.

## How to verify
- From repo root: `python3 scripts/audit.py --quality --strict` (exit 0 = clean) and `python3 scripts/audit.py --release` (unchanged).
- In `extension/`: `npm run check-types`, `npm run lint`, `npm run build`, `npm test`. Owner runs these; agents do not.
- `git diff --color-moved` on each extraction to confirm moves are byte-identical.

## Gotchas & traps
- HEAD at handover time is `da2c5fb`, not `0813a28`: another commit landed after the archive commit. Run `git log --oneline -5` and read what changed before touching files. The working tree also holds unrelated dirty files (folder-watch, hub grid, rule hide, `boardHtmlAssets.ts`, `boardHtmlMenus.ts`, `scanner.ts`, `types.ts`, `package.json`, `en.json`, `CHANGELOG*.md`, several tests). Stage and commit only your own files by name.
- `scanner.ts` and `boardRuleAssign.ts` appear in that dirty set, and both are on this task's list. Check `git diff` on them before editing; they hold someone else's in-flight changes.
- Plan line ranges are pre-extraction. Re-read before cutting.
- The gate counts test fixtures and stubs as source; do not weaken the gate to pass (D4/D5 need the owner's yes).
- Webview messages: do not rename message `type`s; grep each before and after a move.
- Scheduler work is already done; do not reopen it.
