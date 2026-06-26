# Roadmap plans

One plan per remaining roadmap item (see [ROADMAP.md](../../ROADMAP.md)). Each was
written against the **verified** code state, not the roadmap text alone — where the two
diverge, the plan records what is actually implemented today.

## Phase 1

- [1.1 Extend favorites import](1.1-extend-favorites-import.md) — **partial.** kdcro101 +
  oleg-shilo + howardzuo shipped. Remaining: folder/group import, ongoing detection
  prompt, Project Manager/Bookmarks assessment, tests.
- [1.2 Multi-root refinements](1.2-multi-root-refinements.md) — **mostly shipped.**
  Per-folder files, reactive add/remove, folder-aware cwd all exist. Remaining: lift the
  cross-folder grouping restriction (display-merge), owner attribution, tests.

## Phase 2

- [2.1 Export / share pin sets](2.1-export-share-pin-sets.md) — **shipped.** Whole-set
  file export/import plus a single-pin share link both exist and are wired; the
  competitive-gap table's "Gap" marker is stale. Remaining: tests + the roadmap edit.

## Phase 3

- [3.2 Branch-aware pin sets](3.2-branch-aware-pin-sets.md) — **blocked** on Multiple
  favorite sets. Git detection plumbing exists; switching does not.
- [3.3 Local run analytics](3.3-local-run-analytics.md) — **shipped.** Telemetry store +
  the Run Analytics Markdown summary exist. The chart/grid form is the 3.4 Analytics tab.
  Remaining: tests.
- [3.4 Dashboard webview tabs](3.4-dashboard-webview-tabs.md) — **extend existing.** A
  real process-monitor webview (CSP+nonce, theme-aware) already ships as a single view.
  Remaining: tab shell, move Analytics into the webview, build a Trends tab.

## Phase 4

- [4.1 Unit tests](4.1-unit-tests.md) — **harness unshipped.** No test infra at all;
  build it first, then cover store / command builder / schedule math / double-click.
- [4.2 Integration smoke test](4.2-integration-smoke-test.md) — depends on the 4.1
  harness; activate + register + pin-and-run end to end.

## Later / Exploratory

- [Suite integration](suite-integration.md) — **mostly shipped.** Detection + pins + boot
  macro exist; the gap is per-tool subgroups + graceful-absence tests.
- [Additional import formats](additional-import-formats.md) — sabitovvt / Project Manager
  / Bookmarks assessment; overflow from 1.1.
- Richer scheduling — **shipped.** Day-of-week, cron expressions, the friendly cron
  builder, and run-on-workspace-open all exist. Plan archived to
  [history/2026.06/2026.06.25/richer-scheduling.md](../history/2026.06/2026.06.25/richer-scheduling.md).
- [Remote run](remote-run.md) — pin + open shipped; running on the remote host remains.
- [Multiple favorite sets](multiple-favorite-sets.md) — net-new; **gates 3.2.**
- [Comments and separators](comments-and-separators.md) — net-new; cross-cutting
  tree/run/badge surface.

## Suggested order

1. **[4.1 harness](4.1-unit-tests.md)** — unblocks the tests every other item needs.
2. **[1.2 multi-root](1.2-multi-root-refinements.md)**, **[suite
   subgroups](suite-integration.md)**, **[3.4 dashboard tabs](3.4-dashboard-webview-tabs.md)**
   — all extend shipped code, low risk.
3. **[1.1 import remaining](1.1-extend-favorites-import.md)** +
   **[additional formats](additional-import-formats.md)** — share the parser refactor.
4. **[Multiple favorite sets](multiple-favorite-sets.md)** → **[3.2
   branch-aware](3.2-branch-aware-pin-sets.md)** — the second depends on the first.
5. **[remote run](remote-run.md)**, **[comments/separators](comments-and-separators.md)**
   — independent, pick by appetite. (Richer scheduling shipped.)
