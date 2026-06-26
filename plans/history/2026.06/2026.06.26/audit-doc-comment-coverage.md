# Audit doc-comment coverage and webview asset sparseness

The code-quality audit reported exported-symbol documentation as 0/432 because its
coverage check recognized only JSDoc (`/** */`) blocks, while this codebase
documents exports with `//` WHY-comments as its house style. It also flagged the
webview asset modules as comment-sparse, a false positive caused by the tokenizer
blanking the template-literal interiors where those files' comments actually live.

## Finish Report (2026-06-26)

### Defect

`modules/_quality.py` measured two documentation signals that both misread the
codebase:

1. **Exported-symbol doc coverage** counted a symbol as documented only when the
   line directly above it ended in `*/` (a JSDoc / block-comment tail). The
   project's convention is `//` line comments stating the reason a symbol exists,
   not JSDoc, so every well-commented export read as undocumented — 0 of 432.

2. **Comment-line density** flags a file as "sparse" when its comment ratio is
   under 5%. The tokenizer deliberately blanks string and template-literal
   interiors (so a `//` inside a string is never miscounted). Webview asset
   modules — `views/plannerScript.ts`, `views/dashboardAssets.ts`,
   `views/plannerAssets.ts` — are each one large exported `` `...` `` CSS/JS
   template, so the comments embedded in that script are invisible to the metric
   and the file reads as sparse no matter how well the embedded code is documented.

### Change

`modules/_quality.py`:

- `_exported_symbol_doc_coverage` now accepts a preceding `//` line comment as
  documentation in addition to a block-comment tail (`*/`). Either form directly
  above an export means the public surface is explained. Re-exports remain
  excluded. Coverage moved from 0/432 to 350/439 (79.7%).
- `FileQuality` gained `embedded_text_lines` (lines that are pure string /
  template-literal interior: non-blank in source, blank in the code-only view,
  not a comment) and a `template_dominated` property (true when at least 60% of
  the file is such text). The sparse-comment check skips template-dominated files,
  so webview asset modules are no longer flagged as a false positive.
- Renamed the report label "Exported symbols with JSDoc" to "Exported symbols with
  a doc comment" and updated the module docstring and section comments to match.

`recipes/detectorEcosystem.ts` (the one genuinely thin TypeScript file):

- Added a WHY-comment above each of the seven exported ecosystem detectors
  (`detectDevCommand`, `detectMigrate`, `detectEntryPoint`, `detectPort`,
  `hasEslint`, `hasPrettier`, `hasVersionSource`) stating what each derives, the
  detection precedence, and why it returns undefined. The file dropped off the
  sparse list and its exports now count as documented.

`views/plannerScript.ts` and `views/dashboardAssets.ts`:

- Added intent comments to the non-obvious embedded handlers (the click-vs-drag
  movement threshold, the plug-to-link gesture, the bezier edge rendering, and the
  sparkline geometry). These live inside the template literal, so they do not move
  the density metric, but they document the genuinely subtle client logic.

`tests/test_quality.py`:

- Added `TemplateDominatedTest` covering the new `template_dominated` property: a
  mostly-template file is dominated, a normal module with a few inline strings is
  not, the 60% threshold is inclusive, and a zero-line file does not divide by zero.

### Verification

- `python scripts/tests/test_quality.py` — 15 tests pass (11 pre-existing, 4 new).
- `python scripts/audit.py --quality` — doc-comment coverage 350/439 (79.7%); the
  sparse-density list is empty (`detectorEcosystem.ts` cleared by real comments;
  the three webview asset modules excused as `template_dominated`).
- TypeScript changes are comment-only; no behavior change.

### Scope notes

- 89 exports remain genuinely undocumented (no comment directly above). Documenting
  them is a separate, larger pass.
- The webview asset modules' density is unchanged by design — the audit now excuses
  them rather than counting their template-internal comments, which would require a
  per-embedded-language lexer to do without misreading `://` in URLs as comments.
