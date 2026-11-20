# Handover — group_merge_and_tag_menu
2026-11-20 13:55 EST · saropa_workspace / main · session 9431556a-791a-4124-aebb-733cd175ad94 (resumed from 20261120_1159)

## Corrections carried forward
- Wrong: HubGrid changelog goes in a new `## [Unreleased]`. Correct: under `## [2.8.0]` `### Added`; no Unreleased section (source: 20261120_1041, user: "you created a new unreleased version, instead put it in 2.8.0").
- Wrong: the engine records rate-limit state and has a public `reconcileWatchers()`. Correct: it does not; `reconcileWatchers` is private; wiring is in `extension/src/activation/wiringWatchers.ts` (source: 20261120_1041).
- Wrong: "nine webview panels". Correct: eleven `*Panel.ts` in `extension/src/views/` (source: 20261120_1041).
- Wrong: a subagent said phase 8 lacks a Gantt reorder drop zone and Org 3 lacks a test-match box. Correct: decision 53 makes manual reorder Board-tab only; `board/tagsEditorAssets.ts` already has test-match. Verify any subagent "gap" against plan and code before building (source: 20261120_1159).
- Wrong: the Org 3 row menu lacks Tags… / Move to group. Correct: `views/boardPanelEdits.ts` `rowMenu` already has both (source: 20261120_1159).
- Owner chose "build now on top of the other board edits, keep my hunks separable" (source: 20261120_1159). Do not wait for the other work to land.
- User confirmed the merge/tag design as proposed: "yes" (this session). Merge = one `assign` entry per member plus drop the source group override, one write, one Undo. New tag = shared-words extractor plus input boxes, saved via `organize.tags.add`; the full prefilled Tags editor is NOT part of this.
- Plain, short explanations with numbered options; the owner said "i dont understandf" once (source: 20261120_1159).
- Rules in force: no AI mention anywhere public or in commits; no Co-Authored-By; American English (the spelling hook blocks the British spelling of "color" as a bare word in any edited file; underscore identifiers such as `COLOUR_NAMES` pass because the hook uses word boundaries, but a bare key or property of that spelling does not); agents never run `npm test`, mocha, the suite; `tsc --noEmit` at most once and only when the owner allows; never edit other projects; commit only on request; changelog edits in root `CHANGELOG.md` only; never hard-wrap markdown prose; stage mixed files by building index blobs from HEAD plus only your hunks (no interactive `git add -p`).

## Session chain
- (this session) 9431556a — resumed 20261120_1159; built merge + new-tag heading menu, committed as `f53f7f0`.
- commit `f53f7f0` (2026-11-20 12:33) — "feat: group heading menu can merge a group into another and make a tag from its shared words".
- `20261120_1159_hubgrid_and_group_look_menu.md` — `plans/handover/20261120_1159_hubgrid_and_group_look_menu.md` — HubGrid commit, group look menu commit, plan status fixes.
- commit `a876814` (group look menu), commit `82a8ee1` (HubGrid) — hashes after a history rewrite; the old handover cites `b1252a3` and `c8e7f7c`.
- `20261120_1041_hubgrid_and_board_redesign_check.md` — `plans/handover/20261120_1041_hubgrid_and_board_redesign_check.md` — built HubGrid uncommitted, reviewed the HubGrid plan.
- `20260904_1600_github_repo_watches.md` — built the repo-watch feature HubGrid reads from.
- Handover docs moved from `docs/handover/` to `plans/handover/` in commit `6414aec`; older docs name the old path.

## Unfinished tasks
1. [pending] Org 3 hover-card tag pill menu (Edit tag…, Not this document via `saveUntag` in `commands/boardOrganizeEdit.ts`, Add a word…) — conflicts with deferred item 8 (native title tooltips cannot hold pills). Needs an owner decision before any code.
2. [pending] New-tag color — "New tag from this group" copies the first tag row in the file (`addTagText` in `board/org/groupOps.ts`) because the spelling hook blocks the British-spelled `TagRow` color key as a bare word in new code. Pass the group's color through; options: a helper added to `organizeEditCore.ts` (hook scans the whole edited file and that file already has bare uses, so it would block) or construct the row from a typed copy without writing the key. Decide with the owner.
3. [pending] Org 4 title-signal input to link inference (`board/org/linksSignals.ts`, `linksInfer.ts`) — plan does not specify it; ask the owner for the spec first. Front-matter `needs` is deferred.
4. [pending] Phase 9 items 9 and 10 and the plan section 19 test coverage (zero-pill, single-red) — not evidenced in code; read `plans/PLAN_RELEASE_BOARD_REDESIGN.md` section 19 and add the missing tests. Items 6, 7 owner-deferred; item 8 not buildable with native tooltips.
5. [pending] Test the dialog flows — `editGroupLook` and `editGroupOp` (`views/boardGroupLook.ts`, `views/boardGroupOps.ts`): add `showInputBox` and `showQuickPick` to `extension/src/test/_stub/vscode.ts` first, then test.
6. [pending] Owner runs the suite (agents may not): `npm test` in `D:\src\saropa_workspace\extension`. Files to watch: `test/board/org/groupOps.test.ts` (asserts `organize.tags.add[]` and `organize.assign[]` shapes, never run), the `boardPolish` heading-menu test, HubGrid tests (`hubGridData`, `hubGridPanel`, `folderWatchEngine`, `folderWatchCommands`). Fix whatever fails.
7. [verify] F5 host: group heading menu (Group by Group, kebab on a group heading: Rename, Emoji, Color, Merge with…, New tag from this group…, Back to automatic, Undo bar; all hidden on a project heading); HubGrid (filters, j/k, Enter, Copy link, Refresh, empty state, rate-limit banner via a 403).
8. [verify] One `tsc --noEmit` if the owner allows. Risk points: `where: undefined` and `satisfies AssignRefusal` in `groupOps.ts`; `switch (msg.type)` narrowing in `views/hubGridPanel.ts`; `as FolderWatch` casts in `hubGridData.test.ts`; `Parameters<typeof editGroupOp>[0]` in `boardPanel.groupOp`.

## Completed tasks
1. Merge with… and New tag from this group… on the group heading menu — committed `f53f7f0` (11 files). Not run, verified by reading only.
2. Staleness check of 20261120_1159 — only a path-move commit landed after it; no task was resolved.

## Session narrative

### User requests
1. `/handover 20261120_1159_hubgrid_and_group_look_menu` (resume).
2. "yes" to the proposal: build Merge with… and New tag from this group; hover-card pills stay deferred.
3. "commit the merge and tag menu".
4. "what is left to do?" then `/handover`.

### Investigation & analysis
- Plan section 18.5 lists Merge with… and New tag from this group (prefills patterns from the words members share) but 18.6 defines no merge storage; the only mechanism is `setAssign` (`board/org/organizeOverrides.ts:86`), one entry per document, capped by `LIMITS.assigns` (5000).
- No existing entry opens the Tags editor prefilled; tag storage goes through `loadText` / `applyState` / `rowProblem` in `board/org/organizeEdit.ts` and `organizeEditCore.ts`.
- `titleWords` returns stems (so "billing" becomes "bill"); a whole-word tag pattern must keep the original word, so `sharedWords` uses `splitWords` unstemmed.
- The spelling hook matches whole words case-insensitively with ``; underscore identifiers pass, a bare key of the British spelling does not.
- Other processes landed commits during the session (`ea3737f`, `a00237d`, `684ebf3`, `f93cbcc`, `7a466f5`) and touched `board/org/tokens.ts` (WHY comment on `STOP`).

### Changes made
- `extension/src/board/org/groupOps.ts` (new): `GroupMember`, `sharedWords` (words in every member, else words in at least half and at least two; max 5; excludes `STOP` and `KIND` words, numbers, words under 3 chars), `mergeGroupsText` (loop of `setAssign`, then `setGroupOverride(...undefined)`), `newTagId`, `addTagText` (starts from the first tag row, effects all on, `where` undefined, refuses via `rowProblem`).
- `extension/src/views/boardGroupOps.ts` (new): `GROUP_OP_ACTS` (`gMerge`, `gTag`), `isGroupOpAct`, `editGroupOp`; QuickPick of other groups in the same project with counts; two input boxes for the tag (name, then words prefilled with shared words); `parseWords`.
- `extension/src/views/boardPanel.ts`: import, `scopeMenu` condition and branch, new private `groupOp` (offers Undo, sets `dirty`, refreshes, shows `releaseBoard.failed` on error).
- `extension/src/board/boardHtmlMenus.ts` (`scopeMenu` gains two items), `boardHtmlAssets.ts` (`openMenu` hides `gMerge` and `gTag` unless the id starts `group:`), `views/boardStringsPolish.ts` (4 keys), `i18n/locales/en.json` (4 menu keys plus 11 `releaseBoard.groupOps.*` keys).
- `extension/src/board/org/tokens.ts`: `STOP` exported.
- `extension/src/test/board/org/groupOps.test.ts` (new, 8 tests); `test/board/boardPolish.test.ts` heading-menu test lists the two new acts.
- `CHANGELOG.md`: one bullet under 2.8.0 Added.
- Staging script `D:\tmp\stage_ops.py` (builds index blobs from HEAD plus only my hunks).

### Decisions & trade-offs
- Merge also drops the emptied group's look override, in the same write.
- Tag color is the first shipped row's color, not the group's (spelling hook); the owner edits it in the Tags editor.
- Whole words, not stems, in suggested patterns.
- No tsc, no tests (machine-safety rule).

### Rejected / dismissed / deferred
- Hover-card tag pill menu: deferred, conflicts with native tooltips.
- Prefilled full Tags editor for New tag: not built; input boxes used.
- Gantt reorder drop zone: rejected (decision 53).
- Org 4 front-matter `needs`: deferred by the plan.

### User feedback & corrections
- Confirmed the proposed design with "yes"; no corrections this session.

## Key files & paths
- `extension/src/board/org/groupOps.ts` — pure merge, shared-words and add-tag logic.
- `extension/src/views/boardGroupOps.ts` — dialogs and write for the two entries.
- `extension/src/views/boardGroupLook.ts` — the earlier look entries (Rename, Emoji, Color, Back to automatic).
- `extension/src/views/boardPanel.ts` — `groupLook`, `groupOp`, `scopeMenu` dispatch.
- `extension/src/board/boardHtmlMenus.ts`, `boardHtmlAssets.ts`, `views/boardStringsPolish.ts`, `i18n/locales/en.json` — menu items, hide rule, strings.
- `plans/PLAN_RELEASE_BOARD_REDESIGN.md` — section 18.5 (in-place editing), 18.6 (storage), 19 (tests).

## How to verify
- `cd D:\src\saropa_workspace\extension` then `npm test`. Subset after one build: `node --test out/test/board/org/groupOps.test.cjs out/test/board/boardPolish.test.cjs out/test/hubGridData.test.cjs out/test/hubGridPanel.test.cjs out/test/folderWatchEngine.test.cjs out/test/folderWatchCommands.test.cjs`. Run timing-sensitive `hubGridPanel` alongside other files.
- F5: see task 7.

## Gotchas & traps
- Remaining uncommitted files belong to another process: `board/ruleHide.ts`, `views/boardPanelEdits.ts`, `board/scanner.ts`, `board/types.ts`, `commands/boardRuleAssign.ts`, `test/githubClient.test.ts`, STYLEGUIDE 4.16, the hide keys in `en.json`, hide hunks in `boardHtmlAssets.ts`, `boardHtmlMenus.ts`, `boardStringsPolish.ts`, `boardPolish.test.ts`, and `CHANGELOG_HISTORY.md`. Stage by building index blobs from HEAD plus only your hunks; the same line (`openMenu` in `boardHtmlAssets.ts`) is edited by both parties.
- `en.json` has mixed LF/CRLF line endings; anchor edits on exact-line prefixes and keep each anchor line's ending.
- Python on Windows cannot open `/d/tmp/...`; use `D:/tmp/...`.
- Handover folder is `plans/handover/` now, not `docs/handover/`.
- Opus-only planning is done; use Sonnet for the remaining work.
