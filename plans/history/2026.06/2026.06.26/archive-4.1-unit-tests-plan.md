# Archive 4.1 unit-tests plan to history

The Phase 4.1 unit-test plan was fully shipped (its own Finish Report of
2026-06-25 records `tsc` clean and 130 `node --test` tests green) but had been
retained in `plans/roadmap/` because sibling plans cited it as their
test-harness dependency. This task moved the completed plan into the history
archive and repointed every reference so no link dangles.

## Finish Report (2026-06-26)

### Objective

Remove a completed plan from the active roadmap directory without breaking the
cross-references that other roadmap plans hold to it.

### What changed

- `plans/roadmap/4.1-unit-tests.md` moved (via `git mv`, history preserved) to
  `plans/history/2026.06/2026.06.25/4.1-unit-tests.md`. The 2026.06.25 dated
  folder matches the plan's own completion date and its same-day siblings.
- Eight references across seven roadmap files repointed from the bare
  `4.1-unit-tests.md` (sibling-relative) to
  `../history/2026.06/2026.06.25/4.1-unit-tests.md` (the new location relative to
  `plans/roadmap/`):
  - `README.md` — two references: the Phase 4 catalog entry and the
    suggested-order list item.
  - `1.1-extend-favorites-import.md`, `1.2-multi-root-refinements.md`,
    `2.1-export-share-pin-sets.md`, `3.3-local-run-analytics.md`,
    `additional-import-formats.md` — each a single "Tests depend on the Phase 4.1
    harness" dependency note.
  - `4.2-integration-smoke-test.md` — the "no integration harness exists" pointer
    back to the 4.1 plan.

### Verification

A repository grep for both the bare-filename link target and the inline-code
mention of `4.1-unit-tests.md` returns no matches after the edits, confirming no
reference still points at the vacated `plans/roadmap/` path. The optional
`@vscode/test-electron` host suite remains tracked separately as
`4.2-integration-smoke-test.md`; this archival does not affect it.

### Status

Complete. Docs-only change: one plan moved to history, all referrers updated.
