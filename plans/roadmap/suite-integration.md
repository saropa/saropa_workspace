# Suite integration — "Better Together"

Roadmap: Later / Exploratory. **Mostly shipped** — this plan covers the verified gap,
not a from-scratch build.

## Verified current state

`extension/src/recipes/suiteRecipes.ts` already detects all three suite tools and seeds
real pins (no stubs):

- **Saropa Lints** — detected from `pubspec.yaml` / `analysis_options.yaml` /
  `reports/.saropa_lints/violations.json`. Seeds command pins (`saropaLints.runAnalysis`,
  `openProjectVibrancyReport`, `openConfigDashboard`, `openPackageVibrancy`,
  `exportOwaspReport`), CLI shell pins (`dart run saropa_lints:cross_file|baseline|
  quality_gate`), a file pin on the violations report, and a direct health-score read
  (`lintsHealth.ts`, via the Lints public API).
- **Saropa Drift Advisor** — detected from `saropa_drift_advisor` in `pubspec.yaml`.
  Seeds `driftViewer.openInBrowser|openSqlNotebook|scanDartSchemaDefinitions|
  schemaDiagram|exportReport|forwardPortAndroid` and a URL pin to
  `http://127.0.0.1:8642/api/issues`.
- **Saropa Log Capture** — detected from the installed extension. Seeds
  `saropaLogCapture.openLogFile|searchLogs|exportFlowMap|compareSessions|showSignals|
  start`.
- A conditional **boot macro** (`suite.boot`) assembles whichever tools are present.
- All suite pins carry `group: "suite"` and degrade gracefully when a tool is absent.

## The gap

The roadmap specifies a top-level **"Saropa Suite" group with a per-tool subgroup**
(Lints / Drift / Log Capture), each subgroup appearing only when its tool is detected.
Today every suite pin sits **flat under one "suite" group** — there are no per-tool
subgroups. That is the main remaining work.

## Remaining work

1. **Per-tool subgroups.** Nest seeded pins under a subgroup per tool
   (`suite/lints`, `suite/drift`, `suite/log`), reusing the existing pin-group
   primitive. A subgroup materializes only when its tool is detected. The boot macro
   stays at the suite top level.
2. **Audit the entry-point list against the roadmap.** Confirm each documented command
   id still matches the tool's current manifest (the roadmap notes Log Capture's
   `.stop`, Drift's `launch.json` pre-launch wiring, the Lints `getViolationsData()` /
   `getHealthScoreParams()` API). Add any missing-but-documented pins; record any that no
   longer exist with the reason.
3. **Graceful-absence verification.** Lock down with tests (Phase 4.1) that no suite pin
   seeds — and no error fires — when a tool is neither in the project nor installed, and
   that a subgroup appears exactly when its tool is detected.

## Approach

- Subgrouping reuses `PinGroup`; do not invent a suite-specific group type
  (blast-radius). The detection logic is already in `suiteRecipes.ts` /
  `detectors.ts` — extend its grouping, do not rewrite detection.
- Entry-point ids are confirmed against each tool's manifest at write time (the
  "no blocker without analysis" rule applies — read the manifest, do not assume).

## Acceptance criteria

- Suite pins nest under a per-tool subgroup; a subgroup appears only when its tool is
  detected.
- Absence of a suite member degrades gracefully (no errors, no seeded pins).
- Documented entry points match the tools' current manifests; divergences recorded.

## Dependencies

- Pin groups — shipped. Tests depend on Phase 4.1.
- This is the productized form of the suite recipes already in the catalog
  (`plans/history/2026.06/2026.06.25/RECIPE_BOOK.md`, recipes 36–59).
