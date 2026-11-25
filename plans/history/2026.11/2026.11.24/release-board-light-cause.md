# Release Board: show why a light is NO-GO or UNVERIFIED

A project with 0 open items could show a red NO-GO or amber UNVERIFIED light with no stated cause, because the light also depends on health evidence, collapsed blocked documents and the scan baseline. The board now shows the first cause beside the light on the project row and on the per-project Gantt header.

## Finish Report (2026-11-24)

### Change
- New pure helper `board/lightCause.ts` (`lightCause(project)`) picks the first cause following the same branches as `buildProject` in `boardModel.ts`. NO-GO order: failing build, deps, lint, tests (health detail in the tooltip); waiting documents that stop the release; documents that stop it; red documents; a held scan that had red. For an answered project only pinned blocking items count. UNVERIFIED: scan not accepted (accept it to confirm), then open documents with unreadable severity.
- `board/boardHtmlCause.ts` renders the phrase with escaped values and singular/plural forms. Shown in `boardHtmlRows.ts` (project row) and `boardHtmlGantt.ts` / `ganttModel.ts` (per-project Gantt header, `aria-hidden` with `aria-describedby` on the toggle). The unified Gantt shows none.
- Styles in `boardHtmlAssets.ts` (`.cause`, `.cause.warn`, hidden while `.loading`). Strings: `releaseBoard.polish.cause*` keys in `en.json` and `boardStringsPolish.ts`.
- Tests: `test/board/lightCause.test.ts` (each cause kind, answered project, singular, escaping, amber class, aria wiring).
- Changelog: root `CHANGELOG.md` section `[2.11.1]`.

### Verification
- Code review (medium) findings fixed: answered-project cause mismatch, singular forms, loading and wrap styles, accessible name. Changelog-heading finding declined: the section was requested.
- Test audit by grep: only `boardGanttFocus.test.ts:86` and `lightCause.test.ts` touch changed literals; assertions still hold by inspection.
- No test, `tsc` or build was run; the full suite is run by the owner.
