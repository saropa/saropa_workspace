# Roadmap consolidation to per-item plans

The repository carried a single large `ROADMAP.md` whose per-item backlog had been
superseded by one plan document per item under `plans/roadmap/`, leaving the two sources
to drift. Two roadmap items — Export / share pin sets (2.1) and Local run analytics (3.3) —
were referenced by the roadmap but had no plan file, and `ROADMAP.md` still described 2.1
as an unshipped "Gap".

## Finish Report (2026-06-25)

### Objective

Remove the duplication between `ROADMAP.md` and the per-item plans, and close the two
coverage gaps so every roadmap item is mirrored by a plan written against the verified
code state.

### Changes

- **Two missing plans created**, both against verified code rather than the roadmap text:
  - `plans/roadmap/2.1-export-share-pin-sets.md` — records the feature as **shipped**:
    whole-set file export/import (`commands/pinSetExport.ts`, versioned
    `saropa-workspace-pins` file, idempotent import, groups carried) plus the single-pin
    share link (`import/shareLink.ts`, `vscode://…/import?data=` base64url URI). Both are
    registered in `package.json` commands and menus. The competitive-gap table's "Gap"
    marker is recorded as stale. Remaining work is test coverage (Phase 4.1).
  - `plans/roadmap/3.3-local-run-analytics.md` — records the feature as **shipped**: the
    on-device telemetry store (`exec/telemetry.ts`, bounded recents + lifetime counts in
    `globalState`, opt-out, reset) and the Run Analytics Markdown summary
    (`commands/runAnalytics.ts`, virtual document). The chart/grid presentation is the
    Dashboard Analytics tab tracked under 3.4, not duplicate work. Remaining work is tests.
- **`plans/roadmap/README.md` index updated** with a new Phase 2 section (2.1) and a 3.3
  entry under Phase 3, each marked shipped.
- **`ROADMAP.md` reduced to a pointer.** Its prior contents were cleared by the
  maintainer; the file now states what the extension is and directs maintainers to
  `plans/roadmap/` and `plans/wow/` (via their README indexes), the changelog for shipped
  features, and CONTRIBUTING for setup.

### Verification

- No code changed; the two plans were validated by reading the implementing source and
  confirming command registration in `extension/package.json` and `extension/src/extension.ts`.
- Links in the rewritten `ROADMAP.md` resolve to `plans/roadmap/README.md`,
  `plans/wow/README.md`, `CHANGELOG.md`, and `CONTRIBUTING.md`, all present.

### Notes for future maintainers

- The Principles section and the competitive-landscape Appendix that previously lived in
  `ROADMAP.md` were not migrated and now exist nowhere in the repository. If that
  reference content is wanted, it should be re-created under `plans/` and linked from
  `ROADMAP.md`.
- `plans/roadmap/` is tracked (not git-ignored); its links are live on the remote only
  after the directory is committed.
