# WOW backlog — implementation plans

One plan per remaining "WOW" pitch from `../PLAN_MORE_WOW.md`. Each plan states the
target behavior, the concrete code changes (grounded in the current extension
layout), the honest deviations from the pitch where an API limit forces one, the
risk/blast radius, and the verification path. No time estimates — complexity and risk
only, per the repo rules.

## Shared infrastructure note

Four of these touch the **Pins tree** in overlapping ways:

- **#24 Live Metric Badges** — appends a computed badge to a pin row.
- **#17 Workspace Focus Tags** — filters the tree to one tag/mode.
- **#28 Instant Search & Chip Filters** — filters the tree by text + facet chips.
- **#15 Git Conflict Command Center** — injects a synthetic top-level group.

#17 and #28 should land on **one shared filter mechanism** in
`views/pinsTreeProvider.ts` (a `PinFilter` predicate applied in `getChildren`, plus a
context key and a clear action), built once and extended, rather than two parallel
filters. Build order: the filter mechanism (#28's text filter is the simplest first
consumer) → #17 tags as another facet → #15 as a synthetic group alongside the recipe
groups → #24 as a row-level badge that is independent of the filter.

The existing `commands/focusMode.ts` ("Focus on Pinned Files") drives the **Explorer's**
`files.exclude`, not the Saropa tree — it is unrelated to #17/#28 and must not be
conflated with them.

## Plans

- [#1 Port Blocked Savior](PLAN_01_port_unwedge.md) — auto-kill the PID holding a port on EADDRINUSE.
- [#3 Branch-Linked Pin Sets](PLAN_03_branch_linked_pins.md) — pins that show only on their git branch.
- [#9 Time-Bomb / Ephemeral Pins](PLAN_09_time_bomb_pins.md) — pins that auto-remove on a date or branch change.
- [#15 Git Conflict Command Center](PLAN_15_conflict_center.md) — a synthetic group of conflicted files during a merge.
- [#17 Workspace Focus Tags](PLAN_17_focus_tags.md) — tag pins and filter the tree to one mode.
- [#18 Idle-Triggered Routines](PLAN_18_idle_runner.md) — run a pin after N minutes of no input.
- [#23 Run Rollback](PLAN_23_run_rollback.md) — revert only the files a macro/shell run changed.
- [#24 Live Metric Badges](PLAN_24_live_metrics.md) — a live size/lines/modified badge on a file pin.
- [#25 "Watch This" Linkage](PLAN_25_watch_link.md) — run a script pin when a watched file is saved.
- [#26 Masked / Vault Pins](PLAN_26_masked_pins.md) — obscure a pin's label and gate opening behind a reveal.
- [#28 Instant Search & Chip Filters](PLAN_28_search_filter.md) — filter the tree by text and facet chips.
