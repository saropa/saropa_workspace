# Week-over-week deltas in the Suite daily report

Add trend lines to the Suite daily report: alongside today's counts, show how they
moved against the comparable prior period ("errors down 40% vs last Wednesday,
sessions up 3"). The report is currently a snapshot; a reader cannot tell whether
2 errors is an improvement or a regression without opening older files.

## Data source — the report files that already exist

No new APIs and no new storage. The recipe form of the report
(`saropaWorkspace.recipe.suiteDailyReport`) already writes a dated file per run:

```text
reports/<YYYY.MM.DD>_workspace/<YYYY.MM.DD>_workspace_<HHmmss>_suite_daily.md
```

(`reportRelativePath("suite_daily")` → `reports/$datedir_workspace/
$datedir_workspace_$time_suite_daily.md`, expanded in
`extension/src/exec/actionRunner.ts` — verified 2026-07-16.)

Two candidate sources for the prior numbers, in preference order:

1. **A machine-readable sidecar (preferred).** When the recipe writes the Markdown
   report, also write the raw counts as a small JSON sidecar next to it
   (`…_suite_daily.json`: `{ date, workspace: { runs, failed }, tools: [{ tool,
   counts }] }`). The delta pass then reads ONE small JSON per prior day — no
   Markdown parsing, no coupling to the report's prose. The sidecar is versioned
   (`"formatVersion": 1`) like the sibling API.
2. **Parsing the prior Markdown (rejected).** Scraping counts back out of the
   rendered report couples the trend feature to its own prose formatting — the
   same file-scraping fragility the exports API was introduced to avoid.

## Comparison window

- **Same weekday last week** (7 days back), not "yesterday": dev activity is
  weekly-cyclical (Monday standups, Friday releases), so Wednesday vs last
  Wednesday is the honest comparison. Yesterday's numbers already appear in the
  per-tool sections.
- Fallback chain when the 7-days-back sidecar is missing: nearest sidecar within
  the prior 5–9 days; if none, the delta line is omitted (never zero-filled — a
  missing baseline is not "0").

## Rendering

- One delta annotation per counts line, appended to the existing inline counts:
  `sessions 3 (▲ 1) · errors 2 (▼ 3)` — arrows plus absolute change; percentages
  only when the baseline is ≥ 10 (a "300%" swing on a base of 1 is noise).
- The executive summary gains at most ONE trend sentence, and only when a
  meaningful move exists (any count changing by ≥ 30% with baseline ≥ 5, or
  failures moving at all): "Errors are down 40% against last Wednesday."
- No new sections, no charts, no color: the report stays a text document; the
  delta is a suffix, not a surface.

## Scope and constraints

- All-local file reads under the workspace's own `reports/` tree; nothing
  transmitted (no-remote-telemetry principle).
- Sidecar writing lands in the recipe command only (`writeSuiteDailyReportFile`);
  the on-demand preview stays read-only and gains the SAME delta rendering by
  reading sidecars without writing one.
- New l10n keys for the delta phrasing (`dailyReport.delta.*`); arrows are
  symbols, wording is catalog-driven.
- Old sidecars accumulate one tiny JSON per day; reuse the reports tree's existing
  retention behavior (none today) — do NOT add a cleanup subsystem for this.

## Acceptance criteria

- Running the recipe writes both the Markdown report and a `formatVersion: 1`
  JSON sidecar with the same counts the report rendered.
- With a sidecar from 7 days earlier present, counts lines carry `(▲ n)` / `(▼ n)`
  suffixes and the executive summary adds its one trend sentence when the
  thresholds are met.
- With no prior sidecar, the report renders exactly as today (no delta text, no
  placeholder).
- Unit tests cover: sidecar round-trip, weekday-window selection with the
  fallback chain, threshold gating of the trend sentence, and the no-baseline
  render.

## Dependencies

- None on the sibling extensions — deltas compare this workspace's own persisted
  counts, whatever tools contributed them.
- Builds on the shipped recipe (`ritual.suite`) and `buildDailyReport`.
