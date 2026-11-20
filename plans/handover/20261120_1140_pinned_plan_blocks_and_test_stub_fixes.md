# Handover — pinned_plan_blocks_and_test_stub_fixes
2026-11-20 11:40 -0500 · saropa_workspace / main · session (Sonnet 5.5)

## Corrections carried forward
- "Unrecognized document in plans/ = open work (amber)" → wrong. Documents with no work-item prefix are reference notes and never block. (source: 20261120_1057_release_board_plans_not_blockers)
- "A PLAN_ document is amber" → wrong. A `PLAN_*` is BLUE (deferred on purpose); amber only inside `bugs/`; a Status line (WIP to purple, Done to green) still applies. (source: 20261120_1057)
- NEW this session: "A pinned plan cannot block" → wrong. User answered "yes": a pinned `PLAN_` document MUST block the release. Implemented in `collectItems`.
- Do not claim done without evidence; say "unverified" for anything not run. User asked "so, done?" and the correct answer listed three open items. (source: this session and 20261120_1057)
- Machine safety: agents never run `npm test`, mocha or the full suite; run only individual test files via a throwaway esbuild bundle. The owner runs the full suite. (source: repo CLAUDE.md)
- Commit only when asked; user said "commit it" each time. Never `git add -A`; the tree holds another session's uncommitted work. (source: both sessions)
- User instruction: Task 5 (live board check on `saropa_lints`) is DEFERRED: "do not stop this release for this issue".

## Session chain
- `20261120_1140_pinned_plan_blocks_and_test_stub_fixes.md` — `docs/handover/20261120_1140_pinned_plan_blocks_and_test_stub_fixes.md` — this one: pinned blue plan blocks, Windows test-stub fixes
- `20261120_1057_release_board_plans_not_blockers.md` — `docs/handover/20261120_1057_release_board_plans_not_blockers.md` — rules change: unprefixed plans/ notes are reference, PLAN_ is blue
- (commit `da2c5fb`, 2026-11-20) — fix: Release Board no longer blocks a release on unprefixed plan notes, and PLAN_ documents are blue (committed this session from the 1057 handover's work)
- (commit `c7a12cf`, 2026-11-20) — fix: pinned PLAN_ blocks the release; Windows path fixes in the board test stub

## Unfinished tasks
1. [pending] Owner decision: should `scripts/hooks/spelling_guard.py` skip the `grey` status key? The hook reports `grey -> gray` after every edit to `boardModel.ts`, `defaultRules.json`, `saropaRules.json` and `boardExtraProjects.test.ts` (it scans whole files, not the edit). `grey` is a real `BoardStatus` value; renaming it breaks classification. The edits still land. User said "i dont understand" and was given the explanation; no answer yet. Do not edit the hook without a yes.
2. [pending] Owner runs the full suite (`npm test` in `extension/`). The stub `Uri.path` change in `extension/src/test/_stub/vscodeTypes.ts` could affect test files not run this session. Agents must not run it.
3. [verify] DEFERRED by the user, do not block the release: open the real Release Board on `saropa_lints` and confirm it is no longer NO-GO because of `plans/known_issues_review.md`. Classification was verified with the engine against the real files, not in the running extension.

No implementation code is pending.

## Completed tasks
1. `tsc --noEmit` and `npm run build` — owner ran both; no errors, build finished clean.
2. Commit `da2c5fb` — rules, regenerated golden fixture (22 rows), `ruleEngine`/`ruleAssign` tests, closed bug report, two changelog bullets (staged alone via a crafted blob, other session's CHANGELOG edits left in the tree).
3. Task 2, pinned blue plan blocks — `extension/src/board/boardModel.ts` `collectItems`: `pinned` is computed first; `status = pinned && r.status === "blue" ? "amber" : r.status`; the OPEN check, the `blocked` note check, the item `status` and `blocks` use `status`. `counts[r.status]` still records blue. Test added at the end of `extension/src/test/board/boardBlocksFlag.test.ts`; file passes 12/12. Changelog bullet added.
4. Task 6, the failing board tests — causes were Windows test-harness bugs, not product bugs:
   - `extension/src/test/_stub/vscodeTypes.ts` `Uri.path`: a Windows file path now reads like the real URI path (`/D:/a/b`, forward slashes). Production `readResultFile` compares `uri.path` to a joined path, which never matched a Windows temp folder. `boardPatchHost` went 12 failures to 0 (34/34).
   - `extension/src/test/board/boardExtraProjects.test.ts`: `tmp()` runs the folder through `folderKey` (production lower-cases the drive letter on purpose, `extraProjects.ts` `folderKey`); the `sub.path` assertion normalizes separators (stub `joinPath` joins with `/`); title `cancelling` to `canceling`. 9 failures to 0 (32/32).
   - Verified individually: `boardBlocksFlag` 12, `boardExtraProjects` 32, `boardPatchHost` 34, `boardModel` 7, `ruleEngine` 7, `ruleAssign` 29, `boardConfigLoad` 7, `boardFileSource` 7, `boardOutside` 5, `boardGitIgnored` 4, `_stub/vscode.test` 20; all 0 fail.
5. Commit `c7a12cf` — all of item 3 and 4 plus a changelog bullet.

## Session narrative

### User requests
1. /handover resume of 20261120_1057.
2. Pasted tsc/build output (both clean).
3. "commit it".
4. "Task 2: yes / Task 4: i dont understand / Task 5: deferred - do not stop this release for this issue / Task 6: fix".
5. "so, done?"
6. "commit it".
7. /handover.

### Investigation & analysis
- Task 2: `collectItems` skipped non-OPEN statuses before reading the pin, so a pinned blue plan was never listed and could not set `blocks`/`stopping`.
- Task 6: handover said 22 failures in seven files; this session saw 21 in two files (`boardExtraProjects` 9, `boardPatchHost` 12). Root causes above. The remaining files in the old count were not reproduced separately; they pass in the files run.
- Throwaway harness: `D:\tmp\t6\run.js` (esbuild bundle of named test files to `D:\tmp\t6\out`, `vscode` aliased to the stub). Needs the absolute path to `extension/node_modules/esbuild`. `ruleEngine.test` must be bundled into `extension/out/test/board/` because it resolves fixtures relative to its bundle location; a bundle in `D:\tmp` gives a false ENOENT failure.

### Changes made
- `extension/src/board/boardModel.ts`, `extension/src/test/board/boardBlocksFlag.test.ts`, `extension/src/test/_stub/vscodeTypes.ts`, `extension/src/test/board/boardExtraProjects.test.ts`, `CHANGELOG.md` (one bullet under Unreleased/Fixed). Details above.
- Earlier commit `da2c5fb` files: `defaultRules.json`, `saropaRules.json`, `saropaRepos.tsv.gz`, `ruleEngine.test.ts`, `ruleAssign.test.ts`, `scripts/release-board/saropa_board_rules.json`, closed report under `plans/history/2026.11/2026.11.20/`.
- `D:\tmp\cl_staged.md`, `D:\tmp\t6\` are throwaway; safe to delete.

### Decisions & trade-offs
- A pinned blue plan is promoted to amber (existing status type) rather than adding `blue` to the item status union. Reason: minimal ripple through rendering, sorting and Gantt code that expect red/amber/purple. Cost: the row shows amber, not blue, while pinned.
- Fixed the stub (root cause) rather than editing every test's expectations for `uri.path`.
- Left `grey` words alone; the hook conflict is an owner decision.

### Rejected / dismissed / deferred
- Task 5 live check: deferred by the user.
- Spelling-hook change: not done, awaiting a yes.

### User feedback & corrections
- "Task 4: i dont understand": explained that the hook flags the word `grey` that is also a status key.
- "so, done?": answered with three open items; do not claim done while those stand.

## Key files & paths
- `extension/src/board/boardModel.ts` — `collectItems`, pinned blue promotion.
- `extension/src/test/_stub/vscodeTypes.ts` — stub `Uri`; `path` getter changed.
- `extension/src/test/board/boardExtraProjects.test.ts`, `boardBlocksFlag.test.ts`, `boardPatchHost.test.ts` — touched or verified tests.
- `extension/src/board/extraProjects.ts` — `folderKey` (lower-cases the Windows drive letter by design).
- `scripts/hooks/spelling_guard.py` — non-bypassable hook; not edited.

## How to verify
- Owner: `npm test` in `d:\src\saropa_workspace\extension` (full suite; expect only failures unrelated to this work, if any).
- Single files: bundle with `node D:\tmp\t6\run.js board/boardBlocksFlag.test.ts ...` then `node --test D:\tmp\t6\out\<name>.cjs`.
- Pinned plan in the running extension: pin a `PLAN_*.md` on the Release Board; the project should turn NO-GO and the plan should list as open.

## Gotchas & traps
- The spelling hook prints `grey -> gray` on every edit to files that contain the status key; the edit still lands.
- Never `git add -A`: 17 other files from another session are dirty (folder watch, HubGrid, board HTML, plans). `CHANGELOG.md` holds that session's edits too; stage hunks by building the blob from `git show HEAD:CHANGELOG.md` plus your lines, then `git update-index --cacheinfo`.
- `ruleEngine.test` golden test reads fixtures relative to its bundle; bundle it inside `extension/out/test/board/`.
- Public surfaces must not mention AI/assistants; American English.
- `docs/handover/` holds 14 files with this one; prune past 20.
