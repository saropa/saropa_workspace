# Workspace hygiene scan (recipe book section H, #63)

The recipe book previously had no way to find the empty and oversized outliers that
accumulate in a project tree; every recipe deliberately avoided a recursive crawl.
This change adds the one recipe for which an explicit, user-run recursive crawl is
the point: a configurable empty/oversized scanner that writes a dated JSON report
and a sticky toast.

## Finish Report (2026-06-25)

### Objective

Provide an explicit, user-run scan that crawls a chosen scope and reports files and
folders at the extremes — empty (zero-byte files, zero-child folders) and oversized
(past a size ceiling) — into a structured, diffable, dated report, without ever
descending into dependency/build directories.

### What changed

- **`extension/src/exec/hygieneScan.ts` (new).** The recursive crawl engine.
  `scanOutliers(options)` walks each root via `fs.readdir(withFileTypes)`, rolling up
  each directory's recursive byte total and visible child count post-order so it can
  flag empty/oversized files and folders. Safety: a built-in ignore set (`.git`,
  `node_modules`, `.dart_tool`, `build`, `dist`, `target`, `.venv`, etc.) plus the
  project's top-level `.gitignore` (when enabled, parsed lightly — bare names become a
  set membership test, structured patterns become regexes; negations are dropped) plus
  user exclude globs; symlinked entries are never followed (no cycle); the finding list
  is capped at 5000 with a `truncated` flag so the report never claims to be exhaustive
  when it was cut. Modes: `empty` / `oversized` / `both`, with file and folder ceilings
  and an optional under-size floor.
- **`extension/src/exec/hygieneCommands.ts` (new).** Registers
  `saropaWorkspace.recipe.runHygieneScan`: reads the `saropaWorkspace.hygiene.*`
  settings, runs the scan under a progress notification, writes
  `reports/<date>/<stamp>_filereport.json` (the same `$date`/`$stamp` tokens the
  shell-to-report path uses), and announces the result. A scan with findings raises a
  sticky warning (a notification carrying an **Open report** action does not
  auto-dismiss) naming the issue count; a clean scan reports transiently and still
  writes the report.
- **`extension/src/recipes/hygieneRecipes.ts` (new).** Always-applicable recipe
  (`hygiene.scan`) routed to the existing Workspace recipe group, a command pin
  invoking the scan.
- **`extension/src/model/pinStore.ts`.** Wires `detectHygieneRecipes` into the recipe
  detection sweep.
- **`extension/src/extension.ts`.** Registers the hygiene command at activation.
- **Manifest / l10n.** One command + six `saropaWorkspace.hygiene.*` settings in
  `package.json`; title + setting descriptions in `package.nls.json`; runtime
  `hygiene.*` strings in `src/i18n/locales/en.json`.
- **Docs.** Root `CHANGELOG.md` "Added" entry; `plans/RECIPE_BOOK.md` updated to mark
  section H (#63) shipped, noting per-instance scan pins remain a follow-up.

### Scope note

This is the first slice: a single configurable scan over all workspace folders. The
recipe book's richer design — multiple coexisting scan pins, each carrying its own
mode/threshold/scope with an auto-generated name — is a follow-up; the crawl engine and
report shape are already in place to support it.

### Verification

The feature's TypeScript files type-check clean and the `esbuild` bundle builds (exit
0). No automated test harness exists in this repository, so behavioral verification of
the crawl and the report is manual (see the handoff). The pure crawl logic
(`globToRegExp`, `scanOutliers`, the ignore/exclude predicates) is unit-testable once a
runner is established.
