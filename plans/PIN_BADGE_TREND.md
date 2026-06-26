# Pin pass/fail trend sparkline (badge history)

The single open, buildable follow-up carried forward from the now-complete recipe
roadmap ([history/2026.06/2026.06.25/RECIPE_BOOK.md](history/2026.06/2026.06.25/RECIPE_BOOK.md)).
Everything else in that roadmap shipped; haptics is the only deferred item and lives in
[deferred/HAPTIC_EVENT_CUES.md](deferred/HAPTIC_EVENT_CUES.md). This is split out so the
recipe book could be archived without burying an open item.

## What ships today

Pin severity / test badges (#26, #32) are live: after a tracked run, `pinBadges` parses
the output and the tree row shows the **latest** counts — `3✖ 5⚠ 2ⓘ` for a lint sweep,
`12✓ 1✗` for a test run, `✓` when clean — with a full hover line. The data is the most
recent run only, in memory, per session.

## The gap

There is no **trend**: the user cannot see whether the codebase is getting cleaner or
messier over successive sweeps, only the current snapshot. The recipe book's #26/#32
design called for a "pass/fail trend", which the latest-counts badge does not cover.

## Proposed shape

- **History store.** Extend `pinBadges` (or a sibling) to keep the last N badges per
  pin (a bounded ring, e.g. 20), each with its `at` timestamp — the same in-memory,
  per-session, never-transmitted posture as the current registry. Optionally persist a
  small history to `workspaceState` so a trend survives a reload (decide against the
  cost; the latest badge is already session-only, so matching that is the simpler
  default).
- **Surface.** A compact sparkline of the score-or-failure trend. The tree row cannot
  draw a sparkline (a `TreeItem` is text + a single icon), so the trend belongs on a
  webview surface, not the row:
  - Fold it into the existing **Saropa Dashboard** (the process-monitor webview) as a
    small per-pin trend, OR surface it in the **Planner**'s detail strip for a selected
    pin. Reuse that webview's CSP + nonce + `--vscode-*` theming — do not add a third
    webview.
  - The row keeps the latest-counts badge; the hover could gain a tiny text trend
    (e.g. `5→3→2 errors`) as a no-webview fallback.
- **Direction cue.** A ▲/▼ delta vs the previous sweep (reuse the Lints
  `formatScoreDelta` idea) so the row's hover can say "▼2 since last run" cheaply,
  even before any webview work.

## Build order

1. The cheap half first: keep the previous badge per pin and add a `▲/▼ since last run`
   line to the hover — no webview, immediate value.
2. The ring buffer + a sparkline in an existing webview surface, only if the hover
   delta proves insufficient.

## Why it was deferred from the main work

It is an enhancement on top of the just-shipped badges, not one of the original 64
recipes, and the latest-counts badge already delivers the core "see the result on the
pin" value. Buildable any time; not platform-blocked.
