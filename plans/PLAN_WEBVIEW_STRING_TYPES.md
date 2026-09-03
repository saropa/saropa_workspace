# Plan: Webview string-bag type generator

## Problem

Each webview panel (planner, dashboard, schedule editor, launcher) receives a
`STRINGS` object from its host shell via `JSON.stringify(uiStrings())`. The
webview client script accesses keys like `STRINGS.addLabel`, `STRINGS.emptyState`,
etc. directly — if a key is missing (host forgot to add it, typo in the client
script), JS silently returns `undefined`, which renders as the literal text
"undefined" in the UI.

Today there is no compile-time check that the keys the client reads match the
keys the host sends. The `uiStrings()` functions in `dashboardShell.ts`,
`plannerPanelShell.ts`, and `schedulePanel.ts` each return an ad-hoc
`Record<string, string>` — no shared type.

## Proposed solution

A build-time script that:

1. Scans each `uiStrings()` function and extracts the key names it returns.
2. Generates a TypeScript interface per panel (e.g. `PlannerStrings`,
   `DashboardStrings`) with those keys as required `readonly` string fields.
3. The `uiStrings()` return type is changed from `Record<string, string>` to the
   generated interface — a missing key is now a compile error.
4. Optionally, the script also scans the inline JS template strings for
   `STRINGS.<key>` references and cross-checks them against the interface.

## Scope

- **Files to generate into:** `extension/src/views/webviewStringTypes.ts` (or one
  file per panel).
- **Script location:** `scripts/generate_webview_string_types.py` (Python, per
  project convention for durable scripts).
- **Integration:** Run as a pre-build step or on-demand; the generated file is
  committed (not git-ignored) so the type-check works without running the script.

## Affected panels

| Panel | Host shell | `uiStrings()` location |
|-------|-----------|----------------------|
| Planner | `plannerPanelShell.ts` | lines 70+ |
| Dashboard | `dashboardShell.ts` | lines 77+ |
| Schedule Editor | `schedulePanel.ts` | lines 229+ |
| Launcher | `launcherView.ts` | uses `strings` in `msg.strings` |

## Status

Not started. Filed as a hardening follow-up from the BUG-002–014 sweep.
