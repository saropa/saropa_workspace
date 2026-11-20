# Handover — release_board_plans_not_blockers
2026-11-20 10:57 -0500 · saropa_workspace / main · session (Sonnet 5.5 after /model switch; started on Opus 4.6)

## Corrections carried forward
- "Unrecognized document in plans/ = open work (amber)" → wrong. Documents with no work-item prefix are reference notes and must never block. (source: bug report `suite_release_board_no_report_template.md`)
- "A PLAN_ document is amber" → wrong. User: "AMBER is the wrong status for a 'plan', that's future work!" A `PLAN_*` document is BLUE (deferred on purpose). (source: this session)
- "Plans are blue everywhere" → wrong. User: "unless in the bugs folder or some other secondary indication". A `PLAN_*` in `bugs/` stays amber (open work). The secondary indication implemented is the Status line (WIP to purple, Done to green, via `appliesTo` gaining `blue`). Pins as a secondary indication are NOT implemented (see task 2). (source: this session)
- Do not claim done without evidence. The user pushed back ("so is it fixed? i am confused"): the first "fixed" was never reproduced; the live check against real `saropa_lints/plans` was done later. Say "unverified" for anything not run. (source: this session; global CLAUDE.md)
- Bug status values are Open, Investigating, Fix Ready, Closed. "Fixed" is invalid. (source: bugs/ISSUE_REPORT_GUIDE.md line 84)
- Agents never run `npm test`, mocha or the full suite, and `tsc --noEmit` at most once and only when allowed; the owner runs them. I ran individual test files only, via a throwaway esbuild bundle. (source: repo CLAUDE.md "Machine safety")

## Session chain
- (no earlier handover; this is the first for this work). Git HEAD at handover: `6cc880a` (2026-11-20 10:47). Nothing of this session is committed.
- `docs/handover/` already holds 11 files (before this one); prune if it grows past 20.

## Unfinished tasks
1. [pending] Owner runs `tsc -p ./ --noEmit` and `npm run build` in `extension/` and ticks the first two boxes in the closed report. Not run by me (machine-safety rule). Changes are JSON rule files plus two test files, so a type error is unlikely but unchecked.
2. [pending] Decide whether a pinned `PLAN_` document should still block a release. Today it cannot: `collectItems` in `extension/src/board/boardModel.ts` (~line 82) skips every status not in `OPEN` (red, amber, purple) before the pin check, so a pinned blue plan is not counted. Fix would be in boardModel.ts, not the rules. No code written; owner has not asked for it.
3. [pending] Commit only this session's files (see Key files). The working tree is dirty with another session's work (folder watch, board HTML, GitHub dashboard plan, etc.); do not use `git add -A`. `CHANGELOG.md` contains both my two `[Unreleased]` Fixed bullets and someone else's edits; stage with `git add -p`. Per repo rules: commit message with no AI/assistant mention, American English, format `fix: description`.
4. [pending] The spelling hook (`scripts/hooks/spelling_guard.py`) blocks edits to the rules files and tests because they contain the status key `grey` (`grey -> gray`). It is non-bypassable; `grey` is the engine's `BoardStatus` value and renaming it breaks classification. The owner must exempt that key (or decide otherwise). I did not touch the hook.
5. [verify] Run the board on the real workspace with `saropa_lints` and confirm it is no longer NO-GO because of `plans/known_issues_review.md`. The classification was checked with the engine against the real `D:\src\saropa_lints\plans` files (see How to verify), not in the running extension.
6. [verify] 22 tests fail in seven other board test files that load shipped rules; they fail identically on a clean HEAD checkout (baseline 106 pass / 22 fail of 128). Causes seen: `d:` vs `D:` drive-letter case in the temp path (`boardExtraProjects`), and a write-failure simulation expecting different counts (`boardPatchHost`). Not caused by this work and not investigated further; a separate bug if wanted.

## Completed tasks
1. Root cause of the bug confirmed: `live-plans` in `live-folders` matched every `plans/*.md` as amber; `known_issues_review.md` scores severity `extreme` (verified with `scoreDocument`), so it became a stopping item and made the project NO-GO.
2. `plans/*.md` with no work-item prefix become `reference` (rule `live-plans-other`, kind `plan note`). Verified against the real `saropa_lints/plans`: `known_issues_review.md`, `ANALYSIS_dev_machine_stability.md`, `TESTING_AND_RELEASE.md`, `version_sync.md` classified `reference`.
3. `PLAN_*` is blue; amber only under `bugs/` (rule `plan-open`, param `planOpenFolders: ["bugs"]`). Status line `appliesTo` now includes `blue`.
4. Golden fixture `saropaRepos.tsv.gz` regenerated from the engine: diff against old is exactly 22 rows (amber/plan to blue/plan); all other rows identical, which validates the regeneration method. Web counts now `{red 2, amber 0, blue 43}`.
5. Tests updated: `ruleEngine.test.ts` web expectation; `ruleAssign.test.ts` category list gains `plan (Deferred on purpose)` and `plan note (Reference)`. Ran `ruleEngine`, `boardModel`, `ruleAssign` test files: 43/43 pass.
6. Same rule changes applied to the frozen test rules (`saropaRules.json`) and the prototype rules (`scripts/release-board/saropa_board_rules.json`).
7. Changelog: two bullets under `## [Unreleased]` > `### Fixed` in root `CHANGELOG.md` (one line per bullet).
8. Bug report archived and closed at `plans/history/2026.11/2026.11.20/suite_release_board_no_report_template.md` (status Closed, Changes Made and Verification filled; first two verification boxes honestly unchecked). Old `bugs/` path had no references.

## Session narrative

### User requests
1. "review to fix: D:\src\saropa_workspace\bugs\suite_release_board_no_report_template.md"
2. "so is it fixed? i am confused"
3. "just fix it"
4. "if you think you fixed it then archive the doc, write the changelog and close it"
5. "close the gap!"
6. "AMBER is the wrong status for a 'plan', that's future work!"
7. "unless in the bugs folder or some other secondary indication"
8. /handover

### Investigation & analysis
- The bug text says `BUG:`/`PROPOSAL:` prefixes; the engine actually uses file-name prefixes `BUG_`, `PLAN_` (rule set `doc-kinds`) and folder rules (`live-folders`). Rule sets are tried in order, first match wins; a rule's `path` and `name` conditions are ANDed (`ruleEngine.ts` `classifyFile`).
- Statuses: `OPEN` = red, amber, purple (`boardModelParts.ts:276`). Only open items are collected, scored and can be `stopping`/`blocks`. Grey/blue/green/reference are only counted. NO-GO comes from `counts.red > 0 || items.some(stopping) || blockedStop > 0` or failing health (`boardModel.ts` ~167). Grey only makes a project UNVERIFIED, not NO-GO.
- Folder projects use the SHIPPED rules (`boardConfigLoad.ts` `readRules`/`layerUserRules`); a user rules file layers over them by rule-set name. `saropa_lints` has no rules file defining `live-plans`, so the shipped fix reaches it.
- Severity of `known_issues_review.md` = `extreme` (phrase dictionary on its text); that is why an unprefixed file blocked.

### Changes made
- `extension/src/board/defaultRules.json`: `doc-kinds` gains param `planOpenFolders ["bugs"]`; new rule `plan-open` (path `{$planOpenFolders}/*.md` + name `{$planPrefix}*`, amber, kind plan) placed before `plan`, which is now blue; `live-folders` gains param `planWorkPrefix ["PLAN_","PROPOSAL_"]`, `live-plans` now needs that name prefix and is blue, new `live-plans-other` (reference, kind `plan note`); `status-line.appliesTo` = red, amber, blue.
- `extension/src/test/board/fixtures/saropaRules.json` and `scripts/release-board/saropa_board_rules.json`: same changes (applied by script, re-serialised with 1-space indent; diff reviewed, no noise).
- `extension/src/test/board/fixtures/saropaRepos.tsv.gz`: regenerated (22 rows).
- `extension/src/test/board/ruleEngine.test.ts`: web expectation `{ red: 2, amber: 0, blue: 43 }` with explanatory comment.
- `extension/src/test/board/ruleAssign.test.ts`: category list expectation (line ~20).
- `CHANGELOG.md`: two Unreleased Fixed bullets.
- Bug report moved `bugs/` to `plans/history/2026.11/2026.11.20/`, status Closed.
- Temp scripts in `D:\tmp` were deleted; a temporary git worktree at `D:\tmp\base_wt` was created for the baseline test run and removed (`git worktree list` shows only main).

### Decisions & trade-offs
- Chose rule changes over engine changes: the engine knows no folder names by design (`ruleEngine.ts` header); every name is a rule param.
- Added a param `planWorkPrefix` to `live-folders` rather than reusing `doc-kinds`'s `planPrefix`, because a project may use `live-folders` without `doc-kinds`. Cost: two prefix lists.
- Added `blue` to Status-line `appliesTo` so Done/WIP plans still move to green/purple. Side effect (accepted): a file in a `deferred/` folder with `Status: Done` or `WIP` now moves to green/purple. The fixture regeneration showed no existing row changed because of this.
- Regenerated the golden fixture from the engine (after confirming only the 22 intended rows differ) instead of hand-editing. Known weakness: this makes the golden test confirm self-consistency with the new rules, not independent correctness.
- Did not run `tsc`/build (owner's rule). Did not change the spelling hook.

### Rejected / dismissed / deferred
- Rejected: making every unmatched `plans/*.md` amber but excluding by name patterns (`*_review*`, `*_queue*`): fragile.
- Rejected: only flipping `live-plans` to `reference`: would silently drop genuine prefixed plans for projects using `live-folders` without `doc-kinds`.
- Rejected: optional `REPORT:` prefix with its own lifecycle (bug report's optional idea): out of scope.
- Deferred: pinned blue plan still not blocking (task 2); the 22 pre-existing test failures (task 6); the `grey` spelling-hook conflict (task 4).

### User feedback & corrections
- "so is it fixed? i am confused": I had over-claimed; answered with an itemised list of unverified gaps.
- "just fix it": stop asking, act.
- "AMBER is the wrong status for a 'plan', that's future work!" and "unless in the bugs folder or some other secondary indication": drove the blue-plan rule, the `bugs/` exception and the Status-line behavior.
- Model reminders (global rule): conversation began on Opus 4.6 for a bug fix; user switched to Sonnet 5.5 mid-session.

## Key files & paths
- `extension/src/board/defaultRules.json` — shipped rules (source of truth)
- `extension/src/test/board/fixtures/saropaRules.json` — frozen copy of the owner's rules used by the golden test
- `extension/src/test/board/fixtures/saropaRepos.tsv.gz` — frozen file list with expected status/kind/rule (tab-separated: project, path, status word, status, kind, rule, ruleSet)
- `extension/src/test/board/ruleEngine.test.ts`, `ruleAssign.test.ts` — touched tests
- `scripts/release-board/saropa_board_rules.json` — prototype rules, kept in sync
- `extension/src/board/ruleEngine.ts`, `boardModel.ts`, `boardModelParts.ts`, `severity.ts`, `commands/boardConfigLoad.ts` — read-only context for how classification becomes the light
- `CHANGELOG.md` — `[Unreleased]` entries (the file also carries unrelated edits from another session)
- `plans/history/2026.11/2026.11.20/suite_release_board_no_report_template.md` — the closed report
- Files in the dirty tree NOT from this session: folder watch files, `boardHtmlAssets.ts`, `boardHtmlMenus.ts`, `scanner.ts`, `types.ts`, `boardRuleAssign.ts`, `package.json`/`package.nls.json`, `en.json`, `boardContrast`/`boardPolish`/`githubClient` tests, `CHANGELOG_HISTORY.md`, `plans/PLAN_GITHUB_Dashboard.md`, `plans/PLAN_RELEASE_BOARD_REDESIGN*`, `plans/guides/STYLEGUIDE.md`, `bugs/PLAN_CODE_QUALITY_RELEASE_BOARD.md`. Leave them alone.

## How to verify
- From `d:\src\saropa_workspace\extension`: bundle and run only the touched tests with esbuild (see `esbuild.test.js` for the alias of `vscode` to `src/test/_stub/vscode.ts`), files `board/ruleEngine.test.ts`, `board/boardModel.test.ts`, `board/ruleAssign.test.ts`. Expect 43 pass, 0 fail. A throwaway script outside the repo needs `NODE_PATH=<extension>/node_modules` to find esbuild.
- Real-data check: classify `D:\src\saropa_lints\plans\*.md` with `compileProject(defaultRules + a project with ruleSets folder-states, reference-docs, doc-kinds, live-folders, status-line)` and `classifyFile`; expected: `known_issues_review.md` reference, `PLAN_*` blue.
- Owner: `tsc -p ./ --noEmit`, `npm run build`, then open the Release Board with `saropa_lints` and confirm the light.
- Baseline comparison: seven other board test files give 22 failures on clean HEAD and with this change (106 pass).

## Gotchas & traps
- The spelling hook reports `grey -> gray` after every edit to the rules files and tests. Pre-existing and caused by the `grey` status key; it is not a signal that an edit failed.
- The working tree mixes another session's uncommitted work. Never `git add -A`; never stash or reset (it would take their work).
- `JSON.stringify(cfg, null, 1)` does not round-trip the rules files byte for byte (inline arrays), but the resulting diff was verified small and clean; check `git diff` after any scripted rewrite.
- The golden test's fixture rows carry the rule id; renaming a rule id means regenerating the fixture.
- `plans/`, `bugs/` and `.claude/` content is git-ignored or private per repo rules, but `plans/history/...` shows as tracked/modified in status; confirm with `git status` before committing the closed report.
- Public surfaces (changelog, README, code comments, commit messages) must not mention AI/assistants.
