# Pin badges, Lints health read, per-language stats, and per-instance hygiene scans

Four shipped-section follow-ups from the recipe book had no implementation: a lint /
test pin showed no result on itself, the Saropa Lints Code Health score could only be
reached by opening a report, the Sunrise stats ritual captured only a git summary, and
the hygiene scanner had a single settings-driven configuration. This change closes all
four, each a refinement on machinery that already ships.

## Finish Report (2026-06-25)

### Objective

(1) Badge a pin with the error/warning/info counts or test pass/fail tally from its
last run (#26, #32). (2) Read the Saropa Lints public API to report the exact 0-100
Code Health score (#26, #36-40). (3) Add the per-language file/line/share aggregation
the Sunrise stats design (#27) described. (4) Let a user save a hygiene scan with its
own scope and thresholds as a reusable pin (#63 follow-up).

### What changed

**Pin severity / test badges (#26, #32).**
- **`extension/src/exec/pinBadges.ts` (new).** An in-memory, per-session registry
  (mirroring `runStatusRegistry`) keyed by pin id, plus `parseRunBadge(output)` which
  recognizes the common analyzers (ESLint summary, Dart/Flutter analyze bullet lines,
  tsc "Found N errors", and a "No issues found" clean marker so a passing re-run clears
  a stale count) and test runners (Dart/Flutter `+P -F:`, Jest/vitest, mocha, cargo,
  pytest). Returns undefined when nothing is recognized, so a non-lint/test run never
  overwrites a real badge. `formatBadgeLead` renders the compact glyph lead.
- **`extension/src/exec/runner.ts`.** After the two tracked-completion sites (the
  background `settle()` and the captured-to-report finish), the output is parsed and
  recorded — these are the paths the dawn lint sweep / test-trend rituals run through.
- **`extension/src/views/pinTreeItem.ts`.** A new `sweepBadge` parameter renders a
  compact lead (`3✖ 5⚠ 2ⓘ`, `12✓ 1✗`, `✓` for clean) ahead of the row's state badge,
  with a full breakdown line in the hover. Suppressed while running/stopping.
- **`extension/src/views/pinsTreeProvider.ts`.** Subscribes to `pinBadges.onDidChange`
  and passes `pinBadges.get(pin.id)` into each pin item.

**Saropa Lints health-score read (#26, #36-40).**
- **`extension/src/exec/lintsHealth.ts` (new).** Resolves the `saropa.saropa-lints`
  extension's exported API (activating it first, since exports populate on activation),
  calls `getViolationsData()` + `getHealthScoreParams()`, and replicates the Lints
  `computeHealthScore` formula — severity-weighted density with exponential decay, plus
  the `MIN_COVERAGE_FOR_SCORE` partial-sweep guard (duplicated with a provenance note,
  as the API exposes the inputs, not the score). Degrades through every failure mode
  with a useful next step: not installed → say so; no data → offer to run analysis; a
  partial sweep → say the score is withheld and why. Reports the score + band + counts
  with a one-click path to the Code Health dashboard.
- **`extension/src/recipes/recipeCommands.ts`.** Registers
  `saropaWorkspace.recipe.lintsHealth`.
- **`extension/src/recipes/suiteRecipes.ts`.** Adds a "Show Code Health score" Saropa
  Suite recipe, gated on the Lints extension being installed.

**Per-language Sunrise stats (#27).**
- **`extension/src/exec/projectStats.ts` (new).** `collectProjectStats(root)` lists
  tracked files via `git ls-files -z` (so .gitignore is honored, no recursive crawl),
  groups them by language, and counts lines by reading each text file once — bounded by
  a file cap (`MAX_FILES`), a per-file read cap (`MAX_LINE_READ_BYTES`), and binary-file
  skipping. `buildStatsMarkdown` renders a per-language table (files, lines, share,
  size) plus the recent commits and contributor shortlog. `registerProjectStatsCommand`
  wires `saropaWorkspace.recipe.projectStats`, which writes a dated report and opens it.
- **`extension/src/recipes/scheduledRecipes.ts`.** The #27 recipe now runs that command
  (carrying the folder path in `commandArgs`) instead of a raw `git log && shortlog`
  shell line, so the aggregation is cross-platform.
- **`extension/src/extension.ts`.** Calls `registerProjectStatsCommand`.

**Per-instance hygiene scans (#63 follow-up).**
- **`extension/src/exec/hygieneCommands.ts`.** Adds `newHygieneScan` (a wizard:
  scope folder via workspace folders or a folder picker, mode, and — for an oversized
  scan — the ceilings) which builds an auto-generated name and saves the scan as a
  command-action pin (`runSavedHygieneScan` carrying the `ScanOptions` in
  `commandArgs[0]`, created via `store.importPin`). `runSavedHygieneScan` validates the
  persisted config defensively and runs it through a shared `executeAndReport` path, so
  a saved scan reports identically to the settings scan. The signature gained the store.
- **`extension/src/extension.ts`.** Passes the store to `registerHygieneCommands`.

**Manifest / l10n.** New commands (`newHygieneScan`, `lintsHealth`), the Pins-view
overflow menu entry, NLS titles, and the `badge.*` / `lints.*` / `stats.*` /
`hygiene.new.*` runtime strings.

### Design decisions

- **Parse output, do not re-run.** Badges come from the run the user already triggered;
  no extra analyzer invocation. Conservative parsers return undefined rather than
  guessing, so a real badge is never clobbered by an unrelated run.
- **Replicate the score formula, with provenance.** The Lints API deliberately exposes
  the inputs (violations + params), not the computed score, so the formula is mirrored
  from the Lints source with a comment pinning the origin; it degrades to "unavailable"
  if the shape drifts.
- **`git ls-files` over a crawl for stats.** Reuses git's ignore handling and avoids a
  second recursive-crawl implementation; bounded so a large repo is safe.
- **Saved scans are command-action pins.** A per-instance scan rides the existing pin
  machinery (run on double-click, schedulable, removable) rather than a parallel store.

### Verification

`npx tsc -p ./ --noEmit` clean (0 errors); `node esbuild.js` builds (exit 0); the three
hand-edited JSON files parse. No automated test harness exists in this repository, so
the output parsers, the Lints API read, the git aggregation, and the wizard are verified
manually — see the handoff. The pure functions (`parseRunBadge`, `computeScore`,
`countLines`, `buildScanName`) are unit-testable once a runner is established.
