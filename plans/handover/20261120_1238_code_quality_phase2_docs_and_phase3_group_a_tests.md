# Handover — code_quality_phase2_docs_and_phase3_group_a_tests
2026-11-20 12:38 EST · saropa_workspace / main · continuation of session 25a2d1b1-d16c-4f82-ab09-8a11b9a5d776

Goal (verbatim from the prior handover): do the remaining work in plans/PLAN_CODE_QUALITY_RELEASE_BOARD_remaining.md (Phase 1 residuals: boardRuleAssign.ts, boardPanelCore.ts, boardModel.ts; Phase 2 docs; Phase 3 tests; decisions D3-D9 open, use the plan's recommendations) AND build the script that re-measures the plan's summary table.

## Corrections carried forward
- Handover folder is now `plans/handover/` (commit `6414aec` moved history and handover from `docs/` to `plans/`). The old prior handover was read from `docs/handover/`; new ones go to `plans/handover/`. (source: this session)
- Machine safety: agents never run `npm test`, mocha, `node --test`, esbuild or any full-suite / compile-heavy command. `tsc --noEmit` at most once, only when the brief allows (a second tsc run was denied by the permission classifier this session). The owner runs the suite. (source: repo `CLAUDE.md`)
- Never resume a stopped agent without checking its worktree state first. (source: repo `CLAUDE.md`)
- Review cap: one fix round per build; a second only for data-loss or security findings. (source: repo `CLAUDE.md`)
- American English is enforced by `scripts/hooks/spelling_guard.py` at write time and blocks any edit to a file already containing a British spelling, and any test file that spells the British-spelled identifiers (the British-spelled color field, type, hex-map and name-list constants, the allowed-color predicate and the tag color input property, all in `board/org/`). Never write those in markdown; say "org color constant". (source: prior handover 20261120_1133, confirmed this session)
- Never hard-wrap markdown prose: one bullet or paragraph per source line. (source: memory `no-hard-wrapping-prose.md`)
- Every code comment must explain WHY; update root `CHANGELOG.md` for user-visible changes (never `extension/CHANGELOG.md`). (source: global `CLAUDE.md`)
- No AI/Claude/Anthropic mention in commits, public docs, code comments. Commit format `type: description`; no Co-Authored-By; in Bash use repeated `-m` flags. Stage files by name only. (source: global and repo `CLAUDE.md`)
- Never edit the quality gate (`scripts/modules/_quality.py`) in the same change as the code it measures; never raise thresholds; D4/D5 gate changes need the owner's yes. (source: plan section 4)
- Sub-agent output is not user input; an agent that cannot do something (e.g. blocked by the spelling hook) must be reported, not worked around. (source: this session)
- Delegated agents once dropped the space after `=` on six `export const` lines while adding comments (caught by diffing non-comment changed lines before commit). Always diff for non-comment changes before committing agent edits. (source: this session)

## Session chain
- (this handover) — `plans/handover/20261120_1238_code_quality_phase2_docs_and_phase3_group_a_tests.md` — script, boardModel split, Phase 2 docs, Phase 3 Group A tests
- `20261120_1133_code_quality_remaining_work_and_plan_remeasure_script.md` — `plans/handover/20261120_1133_code_quality_remaining_work_and_plan_remeasure_script.md` — plan audit, archive and split; this session resumed from it
- (commit `0813a28`, 2026-11-20) — no handover — archived original plan, created the remaining plan
- (commit `ea72610`, 2026-11-20) — no handover — refreshed the plan's status and decisions
- (commit `63f461d`, this session) — `scripts/plan_quality_table.py` plus test, plan markers
- (commit `f99c210`, this session) — boardModel split
- (commit `ea3737f`, this session) — 236 export doc comments
- (commit `a00237d`, this session) — 11 new test files
- Unrelated handovers by other sessions in the same folder: `20261120_1140_pinned_plan_blocks_and_test_stub_fixes.md`, `20261120_1159_hubgrid_and_group_look_menu.md`.

## Unfinished tasks
1. [pending] Phase 1 residual: `extension/src/commands/boardRuleAssign.ts` is 369 lines (target under 330). Still has someone else's uncommitted changes: check `git status` first; do not start while dirty. `boardRuleUndo.ts` and `boardRuleText.ts` exist. Move what belongs with them and split `applyTextChangeNow` into check-unsaved and write-and-verify, keeping the await sequence exactly. `boardPatch.ts` re-exports `hasUnsavedEdits` / `plainWriteError` from here: keep those paths. Characterization test for the write path first (data-loss class: one fix round allowed).
2. [pending] Phase 1 functions still over 50 code lines (gate, measured mid-session): `onActionMessage` 95 and `onMessage` 54 (both `views/boardPanel.ts`), `rowMenu` 59 (`views/boardPanelEdits.ts`, dirty), the constructor 56 (`views/boardPanelWiring.ts`). Re-run `python scripts/audit.py --quality` and `python scripts/plan_quality_table.py` for the live list. `boardPanelEdits.ts` was 511 lines at last measure and `folderWatchEngine.ts` 434, `boardModelParts.ts` 419, `settingsPanel.ts` 401: all over the 400 warn line.
3. [pending] `views/boardPanelCore.ts` (432 lines, target under 390): decision D3 says leave unless touched for another reason. Record that ruling in the remaining plan (ruling only, no justification). Extract only if the owner says so.
4. [pending] Record decisions D3-D9 in `plans/PLAN_CODE_QUALITY_RELEASE_BOARD_remaining.md` as rulings only. D3 keep thresholds; leave `boardPanelCore.ts`; `boardModel.ts` is now 301 lines so that residual is closed. D4 exclude test fixtures from doc and sparse-comment metrics and D5 exclude type-only modules from the untested metric both change the gate: own commit, numbers before and after, ASK the owner before editing `scripts/modules/_quality.py`. D6 panel tests after Phase 0 and before Phase 1 touches the board model. D7 the four checks are `check-types`, `lint`, `build`, `test` (owner runs test). D8 order by risk. D9 doc comments in the same commit as each move.
5. [pending] Update the plan's Section 1.1 table and Section 2 numbers: run `python scripts/plan_quality_table.py --write` (boardModel row is now 301, closed). Section 2 text still says 2158/2439 exports documented; it is now 2527/2603.
6. [pending] Phase 2 leftovers, 76 undocumented exports: about 60 are test fixtures and stubs (wait on D4); `board/boardHtmlMenus.ts` (2), `board/scanner.ts` (1), `board/types.ts` (2) were skipped because they held in-flight work; `board/org/tokens.ts` (8) was in no agent's result: check and document. Re-list with `python -c` on `_exported_symbol_doc_coverage` (see Gotchas). Same style: `//` WHY comment of 1-3 lines above the export.
7. [pending] Phase 3 Group A leftovers: `org/appearance.test.ts` and `org/tags.test.ts` are not written because the spelling guard blocks the British-spelled identifiers. A draft of `tags.test.ts` (35 tests) is at `D:\.claude_temp\claude\6801cc1bf45e4be2\d08a60e5-0163-4bd4-97fd-fd97a41fc56f\scratchpad\tags.test.ts.txt` (may be cleared). Needs an owner decision: allow the identifiers in the hook, build the key as `"col"+"our"`, or rename the identifiers (a rename is a bigger change). ASK. Also `org/autoGroup` and `boardOrg` already had tests.
8. [pending] Phase 3 Group B: build `extension/src/test/board/boardWebviewFixture.ts` modeled on `launcherWebviewFixture.ts`; tests for `boardHtmlDrag`, menus, handoff, projects, chats, keyword and tags editors. Untested module count was 84 at the last gate run (before Group A's 11 files).
9. [pending] Phase 3 Group C host-dependent: `boardWrite`, `boardPatch`, `boardOrganizeEdit` first (assert write, refusal, Undo snapshot); panel tests for `boardPanelEdits.ts`: stale `rev` ignored, busy refuses a second write, Undo restores. Style: `node:test` + `assert/strict`, no `Date.now()` budgets. Agents write tests and hand the owner the command; they never run them.
10. [pending] Possible bug found by a test agent: in `board/patchApply.ts` an empty `group` on a `setGroup` row appears to create a group named `""` in `setDocGroup`. Unconfirmed (read-only analysis). `patchApply.ts` currently has someone else's uncommitted edits: check `git diff` before touching.
11. [verify] Owner runs the 11 new unverified test files (see How to verify). Expected values were derived by reading source, never executed, so expect some failures; fix the expectation or the code deliberately, never weaken an assertion. Lower-certainty cases listed in Gotchas.
12. [verify] Owner runs `npm run check-types` in `extension/` to confirm the `boardModel.ts` fix (`profile: ctx.profile`) compiles; the only compile run this session happened before that one-token fix.
13. [verify] Phase 0 smoke checklist (remaining plan section 1.2) in a development host. Owner action.

## Completed tasks
1. Re-measure script — commit `63f461d`: `scripts/plan_quality_table.py` reuses `collect_quality()` from `_quality.py` (no output parsing), rewrites only the Now column between `<!-- quality-table:start -->` / `<!-- quality-table:end -->` in the remaining plan, lists functions over the limit, exits 1 for rows naming unmeasured files. `scripts/tests/test_plan_quality_table.py` has 5 tests; run and passed (`python scripts/tests/test_plan_quality_table.py`).
2. `boardModel.ts` split — commit `f99c210`: nine helpers (`collectNeeds`, `attachLinks`, `buildSuggestions`, `buildChainSteps`, `attachLive`, `buildTidyView`, `needsRuleFolders`, `linkFlags`, `attachChats`) moved unchanged to `board/boardModelLinks.ts` (type-only import of exported `BuildContext`); `buildBoard` split with `makeContext`, `markOnlyLinks`, `flagMakeDep`. 431 to 301 lines, `buildBoard` below 50 lines. One `tsc --noEmit --noUnusedLocals` run caught `profile` out of scope; fixed by `profile: ctx.profile`; not recompiled.
3. Phase 2 documentation — commit `ea3737f`: 236 exports across 79 files got `//` WHY comments by three agents (batches by directory). Verified by gate: 2527 of 2603 exports documented (97.1%), from 2307. Diff checked for non-comment lines; six whitespace-damaged `export const` lines in `board/org/organizeEditCore.ts`, `organizeOverrides.ts`, `organizePreview.ts` restored before commit. Some existing British spellings inside comments were respelled.
4. Phase 3 Group A tests — commit `a00237d`: 11 new files, never run. See Changes made.

## Session narrative

### User requests
1. Resume from handover 20261120_1133 (the `/handover` argument).
2. "yes" to my proposal: commit or stash in-flight changes first, then start with `boardRuleAssign.ts` (the file stayed dirty, so I worked on the clean `boardModel.ts` instead).
3. "start the Phase 2 documentation pass"
4. "start Phase 3 Group A tests"

### Investigation & analysis
- `collect_quality()` in `scripts/modules/_quality.py` returns `QualityReport` with `FileQuality.rel_path` (`src/...`), `.lines`, `.long_functions`; this made parsing unnecessary.
- Gate at resume: 7 files over 400, 5 functions over 50 (not 18), 294 undocumented exports, 84 untested modules.
- Groups for Phase 2: A (`src/board/*` non-org, 91), B (`src/board/org/*`, 70), C (commands, exec, views, 59). Lists were dumped from `_exported_symbol_doc_coverage()` to `D:\tmp\undoc_*.txt`.
- Group A candidates: `autoGroup` and `boardOrg` already had tests; 13 modules lacked one; appearance and tags were blocked.

### Changes made
- `scripts/plan_quality_table.py` (new), `scripts/tests/test_plan_quality_table.py` (new), `plans/PLAN_CODE_QUALITY_RELEASE_BOARD_remaining.md` (markers, script mention).
- `extension/src/board/boardModel.ts` (431 to 301), `extension/src/board/boardModelLinks.ts` (new, 157 lines).
- 79 source files: comment-only additions (see commit `ea3737f`).
- New tests: `test/board/ganttModel.test.ts` (40 tests), `boardProposals.test.ts` (25), `placement.test.ts` (12; overlaps existing `boardPlacement.test.ts`), `reportSignals.test.ts` (19), `patchApply.test.ts` (45), `test/board/org/layout.test.ts` (17), `frontMatter.test.ts` (17), `linksInfer.test.ts` (30), `naming.test.ts` (34), `overrides.test.ts` (25), `settings.test.ts` (23).
- No changelog entry: no `[Unreleased]` section exists in root `CHANGELOG.md` (top section is 2.8.0) and none of this is user-visible. Add one if the owner wants test and doc work noted.

### Decisions & trade-offs
- Worked on `boardModel.ts` instead of `boardRuleAssign.ts` because only the former was clean.
- Excluded dirty files and test fixtures from the Phase 2 batches; D4 pending.
- Did not un-export anything during Phase 2 (agents were told to comment only).
- Tests were delegated to agents that cannot run them; owner runs the suite.
- Changelog skipped for internal-only changes (see above).

### Rejected / dismissed / deferred
- Renaming the British-spelled identifiers to unblock tests: out of scope, big blast radius; needs the owner.
- Working around the spelling hook with string concatenation: not done; owner decision.
- Second `tsc` run: denied by the permission classifier; not retried.

### User feedback & corrections
- None explicit beyond "yes" and the two phase-start instructions. The hook and classifier acted as corrections (see Corrections carried forward).

## Key files & paths
- `plans/PLAN_CODE_QUALITY_RELEASE_BOARD_remaining.md` — live plan; size table between markers.
- `scripts/plan_quality_table.py` — refreshes the table; `scripts/audit.py --quality [--strict]` — the gate.
- `extension/src/board/boardModel.ts`, `boardModelLinks.ts` — split model build.
- `extension/src/test/board/` and `.../org/` — new tests.
- `D:\tmp\undoc_A.txt`, `undoc_B.txt`, `undoc_C.txt` — the lists used for Phase 2 (may be stale).

## How to verify
- Owner, in `extension/`: `npm run check-types`, `npm run lint`, `npm run build`, `npm test`. Focus on the 11 new test files; failures there are expectation errors until proven otherwise.
- Repo root: `python scripts/audit.py --quality --strict` (exit 0 clean), `python scripts/audit.py --release`, `python scripts/tests/test_plan_quality_table.py`.
- Lower-certainty test cases: `boardProposals.test.ts` bare-mention case (assumes `mentionSignals` resolves a project-relative path); `buildProposals` with a config lacking `organize` (assumes `settingsOf(undefined)` returns defaults); `linksInfer.test.ts` assumes the Needs-link state `"open"` is valid for `Link.state`.

## Gotchas & traps
- Dirty tree owned by other work: `CHANGELOG.md`, `CHANGELOG_HISTORY.md`, `boardHtmlAssets.ts`, `boardHtmlMenus.ts`, `docFacts.ts`, `needsEdit.ts`, `patchApply.ts`, `scanner.ts`, `types.ts`, `boardRuleAssign.ts`, `boardPanelEdits.ts`, `boardStringsPolish.ts`, `en.json`, `STYLEGUIDE.md`, plus untracked `fences.ts`, `ruleHide.ts`, `test/board/fences.test.ts`. Leave alone; stage only your own files by name. `patchApply.ts` changes may invalidate assertions in the committed `patchApply.test.ts`.
- To list all undocumented exports: from `scripts/`, `python -c "import sys;sys.path.insert(0,'.');from modules._quality import _exported_symbol_doc_coverage as f;d,t,u=f();print(d,t);print('\n'.join(u))"`. The gate prints only the first 15.
- The heuristic function-length numbers shift as files change; the gate output is the source of truth.
- Scheduler work is done; do not reopen. Do not rename webview message `type`s.
- 3 handover-folder files exist from other sessions; folder has fewer than 20 files? Run `ls plans/handover` and mention pruning if over 20.
