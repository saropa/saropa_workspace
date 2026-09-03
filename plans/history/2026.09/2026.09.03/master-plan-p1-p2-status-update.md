# Master plan status update and audit script

The master plan (`plans/MASTER_PLAN.md`) lacked completion status on items that
had already shipped. A codebase audit verified the current state of all Phase 1
through Phase 5 items against source files, `package.json`, and locale catalogs.
A Python audit script was added to keep the plan current automatically. The
CHANGELOG_HISTORY version typo (1.4.18 → 1.5.18) was also fixed.

## Finish Report (2026-09-03)

### Changes

- `plans/MASTER_PLAN.md` — Added verified status annotations to 14 items across
  Phases 1–5:
  - **P1.1 (Flatten Explorer context menu):** marked done.
  - **P1.2 (Reduce view-title icon clutter):** marked done.
  - **P2.1 (Lazy activation):** marked not started.
  - **P2.2 (Cap background output):** marked done.
  - **P2.3 (Case-sensitive path comparison):** marked done.
  - **P3.1 (Unify pin/shortcut):** marked partially done — 4 leaks remain
    (`launcher.pin`, `pin.autoEcosystemSeeded`, `appearance.iconKeyword.location`,
    `shadowsAuto.tooltip`).
  - **P3.2 (Dead imports):** marked not started.
  - **P3.3 (Heartbeat CSV rotation):** marked not started.
  - **P3.4 (Report file accumulation):** marked not started.
  - **P3.5 (Async Python scan):** marked not started.
  - **P4.1 (README.md):** marked partially done — stale paths cleaned, tables remain.
  - **P4.5 (CHANGELOG.md):** marked partially done — typo fixed, archival done.
  - **P5.1 (Drag-and-drop):** marked done — `TreeDragAndDropController` already
    registered.
- `plans/MASTER_PLAN.md` — Removed stale effort estimates throughout (replaced by
  status annotations). Fixed 3 orphaned continuation lines left from multi-line
  effort bullet deletions (sections 6.7, 6.10, 6.11). Updated the work schedule
  table from effort-based to status-based.
- `CHANGELOG_HISTORY.md` — Fixed version typo: `[1.4.18]` → `[1.5.18]`
  (plan item 4.5).
- `scripts/modules/_master_plan_audit.py` — New module. 13 automated checks that
  verify plan item status claims against the live codebase: explorer menu
  structure, view-title icon count, activation events, output capture, path
  comparison, pin/shortcut terminology (full locale scan), heartbeat rotation,
  report pruning, sync Python scan, README stale paths, CHANGELOG version typo,
  drag-and-drop controller, and terminal emulator setting. Reports mismatches
  where the plan says "done" but the code disagrees.
- `scripts/audit.py` — Wired `run_master_plan_audit()` into the audit CLI. New
  `--plan` flag for plan-only mode; the check also runs as part of a full audit.

### Verification method

Each status was verified by reading the live codebase (menu contributions in
`package.json`, activation events, source files, locale catalogs) rather than
relying on commit messages or prior handover docs. The audit script was run and
all 13 checks passed with zero blocking mismatches.
