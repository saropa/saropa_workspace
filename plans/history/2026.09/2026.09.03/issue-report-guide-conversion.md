# Issue Report Guide Conversion

`bugs/BUG_REPORT_GUIDE.md` covered bug reports only and used a `BUG-NNN-area-description.md`
sequence-numbered naming scheme, unlike the sibling `saropa_lints` process doc. It was replaced
with `bugs/ISSUE_REPORT_GUIDE.md`, adding feature-request support and aligning naming with the
established multi-repo pattern.

## Finish Report (2026-09-03)

### What changed

- Created `bugs/ISSUE_REPORT_GUIDE.md`, replacing `bugs/BUG_REPORT_GUIDE.md`, modeled on
  `saropa_lints/bugs/ISSUE_REPORT_GUIDE.md` but adapted to `saropa_workspace`'s domain
  (shortcuts, execution, scheduling, tree view, import, recipes, launcher, notes, scripts,
  Saropa Suite integration, folder/file watches — no Dart/lint-rule concepts carried over).
- File naming switched from `BUG-NNN-area-description.md` (zero-padded sequence number) to
  `area_description.md` (underscore-separated, no sequence number), matching the `saropa_lints`
  convention.
- Added a feature request template and four feature request categories: new command/feature
  proposal, UX improvement, configuration proposal, tooling/infrastructure request.
- Split attribution guidance into positive (grep proves the command lives here), negative
  (grep proves it does NOT live in a suspected sibling extension), script attribution
  (execution bugs: the extension invoked the script correctly), and host attribution
  (VS Code itself, not the extension).
- Dual lifecycle diagrams: bugs (Open → Investigating → Fix Ready → Closed) and feature
  requests (Open → Accepted/Declined → In Progress → Closed).
- History archival path aligned to the repo's actual convention:
  `plans/history/YYYY.MM/YYYY.MM.DD/` (dotted-day folders), not a separate `bugs/history/`
  tree the old guide specified.
- Updated the two live references to the old filename: `CONTRIBUTING.md` (contributor bug-report
  pointer) and `plans/MASTER_PLAN.md` (marked the corresponding 4.4 backlog item done). Left
  references inside `plans/history/**` untouched — those are point-in-time records of prior
  sessions, not live pointers.
- Deleted `bugs/BUG_REPORT_GUIDE.md`.

### Review findings addressed

A `/code-review medium` pass on the new file found three defects, all fixed in place:

1. History path used `YYYYMMDD` (no dots) for the day folder in two places, diverging from
   every existing folder in `plans/history/` (`2026.09.03`, `2026.08.06`, etc.). Corrected to
   `YYYY.MM.DD`.
2. The intro's `[Feature request](#feature-request)` link pointed at a non-existent anchor
   (no heading slugs to `feature-request`). Reworded to drop the broken anchor reference.
3. Two lines (`Reproducer` step 1 and the Shortcuts/Storage investigation bullet) retained
   ambiguous wording left over from the source guide's pin/shortcut terminology drift. Reworded
   for clarity ("project / global scope"; "auto-pinned shortcut's removal").

### Verification

- Grepped the new file for AI/Claude/Anthropic/Copilot/Cursor/Windsurf references (required
  before any tracked doc is committed, per the repo's "No AI on public surfaces" rule): zero
  matches.
- Confirmed `plans/history/2026.09/` and `plans/history/2026.08/` subfolders all use the
  `YYYY.MM.DD` dotted format before correcting the guide to match.
- No TypeScript, build, or test changes — doc-only change, `tsc`/`npm run build`/test steps are
  not applicable.
