# Modularize oversized functions; make the audit comment-aware

Eight functions flagged by the code-quality audit exceeded the 50-line preference,
several only because of encouraged WHY-comments the audit counted as length. This
change makes the function-length metric count code lines only, then splits the
genuinely oversized functions into focused modules without altering behavior.

## Finish Report (2026-06-26)

### Scope

VS Code extension TypeScript (`extension/src/`) plus the release-audit tooling
(`scripts/modules/_quality.py`, `scripts/tests/test_quality.py`). No Dart, no
user-facing behavior change.

### Audit metric correction

The function-length heuristic in `modules/_quality.py` measured the raw
brace-to-brace span, so comment-only lines inside a body inflated the reported
length. The project rules encourage WHY-comments, so a well-documented function
flagged as "oversized" was a false signal. `_find_long_functions` now takes the set
of comment-only line numbers and subtracts those in the body range; a line carrying
code plus a trailing comment still counts as code (it is not comment-only). The
caller `collect_file_quality` computes the comment-only set from the tokenizer's
comment-line set intersected with blank lines in the code-only view. The report
label reads "code lines only". Excluding comments moved the numbers but not the
conclusion — all eight targets still exceeded 50 code lines.

### Modularization (behavior-preserving extractions)

Code-line counts before and after:

| function | before | after |
|---|---|---|
| detectOnDemandRecipes | 303 | orchestrator < 50 + pushUrlRecipes 133 + pushWorkspaceRecipes 147 |
| registerPinConfigCommands | 257 | 127 |
| registerPinManagementCommands | 230 | 154 (favorites handlers 76 extracted) |
| activate | 206 | 89 |
| detectScheduledRecipes | 151 | 92 |
| registerPinCommands | 122 | 80 |
| runRoutine | 117 | < 50 + runRoutineMember < 50 |
| pushRunTargets | 109 | unchanged (left intentionally) |

New modules:

- `commands/registerHelpers.ts` — `pinCommandRegistrar(context)` returning `reg`
  and `regPin`. `regPin` resolves the menu/keybinding argument to a pin via `asPin`
  and runs the body only when present, collapsing the repeated five-line guard. It
  replaces three duplicated `reg` closures across the pin command registrars.
- `commands/favoritesImportCommands.ts` — the two favorites-import command handlers
  (workspace import, sibling scan) moved out of the management registrar.
- `recipes/detectorUrlRecipes.ts` — `pushUrlRecipes`: the git-remote web views,
  registry/marketplace listings (npm, pub.dev, PyPI, VS Marketplace), and docs site.
- `recipes/detectorWorkspaceRecipes.ts` — `pushWorkspaceRecipes`: entry point, doc
  file openers, `.env` setup, open-all-config, boot macro, localhost, copy
  name@version, nearest-script runner.
- `activation/viewState.ts` — `wireTreeViewState`: the filter message + chip context
  keys, the untapped activity-bar badge, the one-time gesture tip, the branch-scope
  affordances and their two toggle commands, and group collapse persistence. Returns
  `refreshUntappedBadge` so activation can repaint the badge once the pin set loads.
  Owns the `SHOW_ALL_BRANCHES_KEY` and `GESTURE_TIP_SHOWN_KEY` constants, the former
  re-exported for activation's seed read.

`detectors.ts` is now an orchestrator: read package.json and the git remote, then
call the three pushers in catalog order (URL openers, run targets, workspace
actions) and categorize by id. Recipe ordering and ids are unchanged. The
scheduled-ritual detector's five uniform git report rituals are a data table iterated
into the output; the project-stats command ritual and the per-ecosystem
lint/test/deps/PR rituals stay conditional.

`runRoutine` delegates each member to `runRoutineMember`, which resolves, classifies
(missing / nested-routine / interactive-under-unattended), runs, and derives the
summary outcome — returning the outcome, a failure flag, and (only when the member
ran) the pin id so the caller folds in the member's badge counts. The skip cases
carry no badge id, matching the original placement of the badge merge after a run.

### Functions left over 50 code lines, by design

`pushUrlRecipes` (133), `pushWorkspaceRecipes` (147), `pushRunTargets` (109), and the
two command registrars (`registerPinManagementCommands` 154,
`registerPinConfigCommands` 127) are flat declarative catalogs and command-registration
lists. Their length is inherent data, not control-flow depth; splitting further would
fragment a cohesive catalog for no readability gain. `pushRunTargets` was left
untouched.

### Verification

- `npx tsc -p ./ --noEmit` — clean.
- `node esbuild.js` — bundle builds.
- `scripts/tests/test_quality.py` — 11/11, including two new regressions: a function
  long only because of comments is not flagged, and a genuinely long function with a
  comment is still flagged.
- The three affected detector test files (`detectors`, `scheduledRecipes`,
  `detectorRunTargets`) — 29/29, pinning the recipe output, the six git rituals, and
  the open/run/workspace group routing.
