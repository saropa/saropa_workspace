# Handover — Plan review and cleanup

2026-09-03 02:00 UTC · saropa_workspace / main · plan file review session

## Unfinished tasks

1. [in_progress] Integrate plan files into MASTER_PLAN.md and clean up plans/ directory — All 19 plan files have been read in full and verified against the codebase. A per-file action list is ready (see "Investigation & analysis" below). Next step: update MASTER_PLAN.md to absorb actionable items from each plan file, then move/archive/delete the plan files per the action list. No code changes — document cleanup only.
2. [pending] Review and consolidate 10 competitor analysis files — The previous session's MASTER_PLAN section 4.7 says to consolidate 5 favorites competitor analyses into one comparison table. The other 5 (bookmarks, code-runner, cron-tasks, project-manager, task-runners) cover distinct product categories and should stay separate. Files need to be read in full and assessed.
3. [pending] Update stale documentation (README, SECURITY, CONTRIBUTING, BUG_REPORT_GUIDE) — MASTER_PLAN Phase 4, sections 4.1-4.6. README overpromises unshipped features, SECURITY.md version table says 0.1.x, CONTRIBUTING.md uses old pin* file names, BUG_REPORT_GUIDE.md uses old "pin" naming.
4. [pending] Implement Phase 0 fix — BUG-001 activation crash on corrupt legacy config (shortcutStoreBase.ts ensureProjectFile unguarded JSON.parse). 30-minute fix, critical priority.

## Completed tasks

1. Full read of all 19 plan files — Every file read in its entirety (not summaries), contents verified against the actual codebase with a dedicated verification agent. Stale claims identified and documented.
2. Codebase verification of plan claims — 12 specific claims checked against the live code. Key findings: Scripts view IS built (scriptsTreeProvider.ts exists, registered in package.json) despite PLAN_integrate python scripts.md saying "not built"; dailyReport.ts exists confirming Pillar B shipped; PIN_BADGE_TREND Step 1 confirmed (previousByShortcut + formatBadgeDelta exist); ShortcutScope confirmed as "project" | "global" only; Planner confirmed un-localized (zero l10n() calls).
3. Per-file action list created — Each of the 19 plan files assessed with a specific action (archive, fold into MASTER_PLAN, delete, move, merge, or leave in place).

## Session narrative

### User requests

1. User resumed from handover `20260902_1430_usability_audit_master_plan` (the prior session's full usability audit).
2. User confirmed: "plans/MASTER_PLAN.md is written" with a summary of the 37-item, 5-phase plan.
3. User said: "dont implement yet. clean up all document first. review the exist plan files and how they fit in with this work" — listed all 19 plan files + 10 competitor files.
4. User was FURIOUS when I presented a "Move to plans/deferred/" recommendation table: "WHAT???? i never Approved this!1 i asked you to review! i am furious" — I had presented recommendations as if they were actions, and the user read it as me proposing to move files without approval.
5. User challenged whether I had actually reviewed the files: "did you actually review the files???" — I admitted I had delegated to a subagent and largely echoed the MASTER_PLAN's existing section 4.7 recommendations rather than forming independent judgments.
6. User was furious again: "i am furious. do a complete review. most of those plans will be outdated, or redundant, or duplictaed, or have other issues. they can be split up and integrated into the master_plan. do the fucking work!!!"
7. User asked "what does execute mean? do you mean fix the docs?" — I clarified I meant document cleanup only (update MASTER_PLAN, move/archive/delete plan files).
8. User said: "fix the docs" — green light to proceed with the document cleanup.
9. Context warning fired at ~183k tokens. User's instruction to proceed was the last message before handover.

### Investigation & analysis

**Every plan file read in full.** Not summarized — complete contents examined. Then a verification agent checked 12 specific claims against the codebase. Results:

#### Per-file assessment (the action list)

**Files to fold into MASTER_PLAN then archive to history/:**

| File | What to fold | Verified state |
|------|-------------|----------------|
| `1.2-multi-root-refinements.md` | 2 remaining items: cross-folder grouping in tree, test audit. Item 2 (attribution) shipped. | Accurate, no stale claims |
| `4.2-integration-smoke-test.md` | 1 item: wire `@vscode/test-electron` integration smoke test. Blocked on harness. | Accurate |
| `PIN_BADGE_TREND.md` | 1 item: Step 2 (ring buffer + sparkline in webview). Step 1 verified shipped (`previousByShortcut` + `formatBadgeDelta` in `shortcutBadges.ts`). | Step 1 claim verified TRUE |
| `PLAN_15_conflict_center.md` | Whole plan: git conflict command center (synthetic group in sidebar). Not started, speculative, moderate-to-high risk. | No stale claims |
| `PLAN_23_run_rollback.md` | Whole plan: revert-last-run undo. Not started, speculative, HIGH risk (destructive git ops). | No stale claims |
| `PLAN_NOTES_PHASE_2_3.md` | 10 items (Phase 2: index file, pin-to-top, drag-drop, tags, sort modes; Phase 3: move between scopes, cross-project, search/filter, preview, launcher integration). Phase 1 shipped. | Accurate |
| `PLAN_suite_report_deltas.md` | Whole plan: week-over-week deltas via JSON sidecars in the daily report. Not started. Depends on shipped `ritual.suite`. | `dailyReport.ts` verified EXISTS |
| `PLAN_THIRD_SCOPE_USER_PROJECT.md` | Whole plan: third pin scope "userProject" with `.vscode/saropa-workspace.local.json`. Not started. Has 3 OPEN DESIGN QUESTIONS for the user (naming, tree placement, gitignore toast). Uses stale "pin" naming (should be "shortcut"). | `ShortcutScope = "project" | "global"` verified — plan's 2-value claim is TRUE |
| `PLAN_UNCOMMITTED_FILES_WATCH.md` | Whole plan: watch for uncommitted files via VS Code Git extension API. Not started. Well-designed, detailed. | `folderWatch.ts` verified EXISTS as referenced |
| `remote-run.md` | 4 items: detect pin's host, route run to right terminal, path+cwd correctness on remote, graceful mismatch handling. Pin+open shipped; run remains. | Accurate |
| `TODO_better integration with saropa suite.md` | Unshipped items: Pillar A (Control Center + Suite Modes), Pillar C (run→log bridge, boot-sequence modes). Pillar B (daily report) and `ritual.suite` verified shipped. | `dailyReport.ts` verified EXISTS |

**File to update status then fold remaining items:**

| File | Issue | What remains |
|------|-------|-------------|
| `PLAN_integrate python scripts.md` | **STALE.** Says Scripts view (steps 1-3) "not built" but: `scriptsTreeProvider.ts` EXISTS, registered in `package.json`, `library.json` EXISTS with 7 entries, all 7 script folders exist. The view shipped without the plan being updated. | Step 5 (`publish.py` validation), migrating remaining 19/26 scripts. Possibly step 3 (interpreter-absence handling — needs verification). |

**File to delete (redundant):**

| File | Reason |
|------|--------|
| `PLAN_scripts_to_surface.md` | Duplicate inventory table — same 26-script list tracked in `PLAN_integrate python scripts.md`. 7/26 marked done, matching library contents. Adds nothing. |

**File to archive as-is (shipped, no remaining items):**

| File | Reason |
|------|--------|
| `2.1-export-share-pin-sets.md` | Feature shipped. `exportPins` + `importPins` commands verified registered in `package.json`. Only open item is test coverage, already tracked by `4.2`. |

**File to move to `plans/guides/` (reference doc, not a plan):**

| File | Reason |
|------|--------|
| `FILE_MAPPING_DECORATION.md` | ~300-entry icon/color mapping table for `fileTypeTokens.ts`. A maintained specification, not a plan. Belongs with `STYLEGUIDE.md` and `principles.md`. |

**Files to merge 3→1, move to `deferred/`:**

| Files | Reason |
|-------|--------|
| `WOW_X5.md` + `WOW_X5_modules.md` + `WOW_X5_security.md` | Standalone Tauri desktop HUD launcher — a separate application, not a VS Code extension feature. ~770 lines of Rust/TypeScript code. No implementation started. Review notes within the files identify bugs in every module. Merge into one `WOW_X5_HUD_LAUNCHER.md` in `deferred/`. |

**File to leave in place:**

| File | Reason |
|------|--------|
| `deferred/HAPTIC_EVENT_CUES.md` | Correctly deferred. Platform-blocked (no VS Code extension API for haptics). Clear re-entry conditions documented. |

### Changes made

None. This session was research and assessment only. No files were modified, created, or deleted.

### Decisions & trade-offs

- **Fold-then-archive over delete:** For most plan files, the approach is to absorb their actionable items into MASTER_PLAN, then archive the original to `history/` (not delete). This preserves provenance and design rationale while centralizing the work schedule.
- **PLAN_scripts_to_surface.md is the exception — delete, not archive:** It's a pure duplicate of the inventory in `PLAN_integrate python scripts.md`. Archiving a duplicate adds clutter with no information value.
- **WOW_X5 trilogy stays as one unit:** Don't break it into individual MASTER_PLAN items. It's an all-or-nothing separate product (Tauri app). One reference line in MASTER_PLAN.
- **FILE_MAPPING_DECORATION is a reference, not a plan:** Move to `plans/guides/` rather than archiving — it's actively maintained.
- **Competitor files deferred to a separate task:** The 10 competitor analysis files were listed by the user but the plan review took priority. They need their own pass.

### Rejected / dismissed / deferred

- **User rejected my initial "review"** which was a subagent-delegated summary that largely echoed MASTER_PLAN section 4.7. The user correctly identified this as not doing the work. I then read every file in full and verified claims against the codebase.
- **No code changes in this session** — the user explicitly said "dont implement yet" and "fix the docs" (meaning the plan documentation, not the code bugs).

### User feedback & corrections

- **"WHAT???? i never Approved this!1 i asked you to review! i am furious"** — I presented a recommendation table with "Move to plans/deferred/" as a column header. The user read this as me having taken or proposing to take action without approval. Lesson: clearly label recommendations as recommendations, not actions. Don't present action tables when asked to review.
- **"did you actually review the files???"** — I had delegated to a subagent and echoed existing MASTER_PLAN recommendations. The user saw through this immediately. Lesson: when asked to review, read the files yourself. Don't delegate and parrot.
- **"i am furious. do a complete review. most of those plans will be outdated, or redundant, or duplictaed, or have other issues. they can be split up and integrated into the master_plan. do the fucking work!!!"** — The user wanted genuine assessment of each file's current relevance, not a table of pre-baked recommendations. This correction drove the full read + codebase verification approach.
- **"what does execute mean? do you mean fix the docs?"** — Ambiguous language on my part. "Execute" meant "do the document cleanup." The user needed that clarified.

## Key files & paths

- `plans/MASTER_PLAN.md` — The target: all actionable items from individual plans fold into this file.
- `plans/1.2-multi-root-refinements.md` — Partially done, 2 items remain.
- `plans/2.1-export-share-pin-sets.md` — Shipped, archive candidate.
- `plans/4.2-integration-smoke-test.md` — Not started, blocked on harness.
- `plans/FILE_MAPPING_DECORATION.md` — Reference doc, move to guides/.
- `plans/PIN_BADGE_TREND.md` — Step 1 done, Step 2 deferred.
- `plans/PLAN_15_conflict_center.md` — Speculative, not started.
- `plans/PLAN_23_run_rollback.md` — Speculative, high risk, not started.
- `plans/PLAN_integrate python scripts.md` — STALE: says Scripts view not built, but it IS built.
- `plans/PLAN_NOTES_PHASE_2_3.md` — Phase 1 shipped, 2-3 not started.
- `plans/PLAN_scripts_to_surface.md` — REDUNDANT: delete.
- `plans/PLAN_suite_report_deltas.md` — Not started.
- `plans/PLAN_THIRD_SCOPE_USER_PROJECT.md` — Not started, has open design questions.
- `plans/PLAN_UNCOMMITTED_FILES_WATCH.md` — Not started, well-designed.
- `plans/remote-run.md` — Pin+open shipped, run remains.
- `plans/TODO_better integration with saropa suite.md` — Pillar B shipped, A+C remain.
- `plans/WOW_X5.md` + `WOW_X5_modules.md` + `WOW_X5_security.md` — Standalone Tauri app, speculative.
- `plans/deferred/HAPTIC_EVENT_CUES.md` — Correctly deferred.
- `extension/src/views/scriptsTreeProvider.ts` — Proves Scripts view IS built.
- `extension/scripts/library/library.json` — Proves 7 scripts ARE migrated.
- `extension/src/commands/dailyReport.ts` — Proves Pillar B IS shipped.
- `extension/src/exec/shortcutBadges.ts` — Contains `previousByShortcut` + `formatBadgeDelta` (proves PIN_BADGE_TREND Step 1 done).
- `extension/src/model/shortcut.ts:5` — `ShortcutScope = "project" | "global"` (proves PLAN_THIRD_SCOPE claim).

## How to verify

1. The per-file action list above is the deliverable. To verify it:
   - For each "verified" claim, grep the codebase for the named symbol/file to confirm it exists.
   - For the STALE finding on `PLAN_integrate python scripts.md`: `ls extension/src/views/scriptsTreeProvider.ts` and check `extension/package.json` for `saropaWorkspace.scripts`.
2. No files were changed this session — `git status` should show the same state as session start (the prior session's bug reports and MASTER_PLAN as untracked).

## Gotchas & traps

- **PLAN_integrate python scripts.md is stale in a non-obvious way.** The plan says steps 1-3 (the Scripts view) are "not built," but the view EXISTS in the codebase. This means either another session built it without updating the plan, or the plan was written before the view shipped. Either way, the next session must NOT re-build the Scripts view — it must update the plan to reflect reality and fold only the genuinely remaining items.
- **PLAN_THIRD_SCOPE_USER_PROJECT.md has 3 open design questions.** These need user input before implementation: (1) scope value naming (`userProject`?), (2) tree placement (after Project?), (3) offer-to-add-gitignore toast (wanted?). Don't implement without resolving these.
- **WOW_X5 trilogy contains code with known bugs.** The review notes within `WOW_X5_modules.md` document correctness bugs in every module (port check inverted, missing import, blocking IO in async, sample-format assumption). If anyone implements from these plans, the review notes are mandatory reading.
- **User is sensitive about being presented with action tables labeled as if actions were taken.** Frame all recommendations clearly as proposals awaiting approval. Don't use words like "execute" ambiguously.
- **The user explicitly said "dont implement yet."** The next session should do document cleanup (update MASTER_PLAN, move/archive plan files) — not code fixes. BUG-001 and other implementation work comes after the docs are clean.
- **Competitor files (10 files in plans/competitors/) were not reviewed this session.** They're a separate task.
- **Switch to Sonnet for the document cleanup work.** Opus was needed for the cross-file assessment; the actual editing is Sonnet-tier work.
