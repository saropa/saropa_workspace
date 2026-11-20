# BUG: Release board treats unrecognized plan documents as NO-GO blockers

**Status: Closed**

<!-- Status values: Open → Investigating → Fix Ready → Closed -->

Created: 2026-11-20
Area: Suite
Severity: Wrong behavior
Extension version: current

---

## Summary

The release board assumes every markdown file in a project's `plans/` directory is a bug or proposal that must conform to the ISSUE_REPORT_GUIDE templates. Documents that don't match (generated review queues, checklists, notes) are flagged as invalid and escalated to NO-GO, blocking the entire project release. The board should gracefully handle documents it doesn't recognize — either skip them or show them as informational items, not blockers.

---

## Reproducer

1. In `saropa_lints`, have `plans/known_issues_review.md` present (a generated review queue with no `BUG:` / `PROPOSAL:` prefix).
2. Open the Saropa Release Board.
3. Observe: `saropa_lints` shows NO-GO with `known_issues.json manual review queue` flagged as a blocker.

**Frequency:** Always — any plan document without a recognized template prefix triggers it.

---

## Expected vs Actual

| | Behavior |
|---|---|
| **Expected** | Documents that don't match a known template type are shown as informational items or skipped — they do not block the release |
| **Actual** | Any unrecognized document in `plans/` escalates to NO-GO, blocking the project |

---

## Root Cause

The board's validation logic has no fallback for documents outside the `BUG:` / `PROPOSAL:` taxonomy. It treats "unrecognized" as "invalid" rather than "not a tracked issue."

---

## Suggested Fix

The release board should distinguish between:

1. **Tracked issues** (`BUG:`, `PROPOSAL:`) — validate against templates, include in release status.
2. **Everything else** — display as informational (or ignore). Never escalate to NO-GO.

Optionally, support a `REPORT:` prefix for generated documents with their own lifecycle (`Open → Reviewed → Closed`), but the core fix is: unrecognized ≠ blocker.

---

## Changes Made

Two rule changes, applied identically to the shipped defaults, the frozen test rules and the prototype rules:

1. `live-folders`: new `planWorkPrefix` param (`PLAN_`, `PROPOSAL_`). `plans/*.md` with one of those prefixes is blue (future work); every other `plans/*.md` falls to a new `live-plans-other` rule, status `reference`, kind `plan note`. Reference documents never enter the open-items list, so they cannot score as severe or cause NO-GO.
2. `doc-kinds`: a `PLAN_` document is blue, not amber, because a plan is future work. A new `plan-open` rule keeps it amber inside the folders in the new `planOpenFolders` param (`bugs`). The Status line now also applies to blue (`appliesTo` gains `blue`), so `Status: WIP` / `Status: Done` still move a plan to purple / green.

Files changed:
- `extension/src/board/defaultRules.json`, `extension/src/test/board/fixtures/saropaRules.json`, `scripts/release-board/saropa_board_rules.json` — the rule changes above
- `extension/src/test/board/fixtures/saropaRepos.tsv.gz` — regenerated from the engine; the diff against the old fixture is exactly 22 rows, amber/plan to blue/plan, every other row unchanged
- `extension/src/test/board/ruleEngine.test.ts` — web expected `{ red: 2, amber: 0, blue: 43 }` (was amber 26)
- `extension/src/test/board/ruleAssign.test.ts` — the assign menu now also offers `plan (Deferred on purpose)` and `plan note (Reference)`

Not done: a pinned plan is still not counted as a blocker, because blue is not an open status; a plan that must block belongs in `bugs/` or needs a status chosen from the board.

---

## Verification

- [ ] `tsc -p ./ --noEmit` clean
- [ ] `npm run build` succeeds
- [x] Rule engine, board model and rule-assign tests pass (43/43). Seven other board test files that load the shipped rules fail 22 tests on a clean HEAD checkout as well as with this change (106 pass either way; drive-letter case in the temp path and a write-failure simulation), so none are caused by it
- [x] A `plans/known_issues_review.md` without a work-item prefix no longer triggers NO-GO: classified with the shipped rules against the real `saropa_lints/plans`, it scores `extreme` severity and is now `reference` (was amber, so it stopped the release)
- [x] Other unrecognized markdown files in `plans/` are also handled gracefully: `ANALYSIS_dev_machine_stability.md`, `TESTING_AND_RELEASE.md` and `version_sync.md` are `reference` (checked with the first version of the fix, before `PLAN_` became blue; `PLAN_*` is blue by the second rule change, covered by the regenerated golden fixture)

---

## Commits

<!-- Add commit hashes as fixes land. -->

---

## Environment

- saropa_workspace version: current
- VS Code version: current
- OS: Windows 11 Pro
