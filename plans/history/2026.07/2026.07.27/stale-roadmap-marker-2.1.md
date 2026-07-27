# Stale roadmap marker correction (plan 2.1)

Plan 2.1, item 1 — correct the stale "Gap — Phase 2.1" marker in the ROADMAP
competitive-gap table for the Export / share pin sets feature.

## Finish Report (2026-07-27)

### Problem

Plan `2.1-export-share-pin-sets.md` recorded that the ROADMAP competitive-gap
table still marked Export / share pin sets as "Gap — Phase 2.1", even though the
feature had shipped. The plan called for updating the row to "Shipped (set file +
single-pin link)".

### Resolution

The competitive-gap table was removed from ROADMAP.md entirely during the
2026-06-25 roadmap consolidation (see
`history/2026.06/2026.06.25/roadmap-consolidation-to-plans.md`), which moved
per-item status into individual plan files. The stale marker no longer exists in
any tracked file. Plan 2.1 item 1 and its acceptance criterion updated to reflect
this — no code or ROADMAP edit needed.

### Remaining work in plan 2.1

Item 2 (test coverage for the export/import round-trip) remains open, blocked on
the Phase 4.1 harness.
