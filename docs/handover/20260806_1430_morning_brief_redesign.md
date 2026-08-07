# Handover — morning_brief_redesign
2026-08-06 14:30 UTC · saropa_workspace / main · session 303a1e9b-1857-4ae7-9bc6-ed1debb22f0a

## Unfinished tasks
None — all three phases are implemented, verified, and committed.

## Completed tasks
1. Phase 1: Classified standup digest + project stats delta — new `standupDigest.ts` with conventional-commit parsing, security/churn/feature classification, and `<details>` folding for raw log; `projectStats.ts` gains `StatsMarker` for day-over-day delta headlines. 28 new tests. Committed as `bb3331d`.
2. Phase 2: Attention-gated summary auto-open — `writeRoutineSummary` accepts `RunSource`, `buildVerdictSection` returns `attentionCount`, scheduled+clean runs log to channel instead of opening. 4 new tests. Committed as `3eb5adc` (some Phase 2 changes were inadvertently included in the Phase 1 commit because files were staged after editing).
3. Phase 3: Saropa Morning Brief webview panel — `BriefPanel` (single-instance, strict CSP, `--vscode-*` theme vars), `lastBrief.ts` in-memory store, `RoutineBrief`/`BriefMember` interfaces, `buildRoutineBrief` projection, `saropaWorkspace.openMorningBrief` command, fallback to markdown on panel failure. 13 new tests. Existing routineRunner tests updated from `__openedDocuments` to `__lastWebviewPanel`. Committed as `922e4f5`.

## Session narrative

### User requests
1. "review and implement D:\src\saropa_workspace\plans\PLAN_morning_brief_redesign.md" — the full plan, three phases.
2. Mid-implementation clarification: user explained the plan's architecture background, guardrails (headline-above-first-fence contract, validateReportPath, both l10n catalogs, root-changelog-only, per-phase verification, hard non-goals).
3. "Continue from where you left off." (after context compaction)
4. "continue" (after second compaction)
5. `/handover` (this document)

### Investigation & analysis
- Read `overnightDelta.ts` to model `standupDigest.ts` on its structure (git helper, collect, build markdown, register command, run wrapper).
- Read `dashboardPanel.ts`, `dashboardShell.ts`, `dashboardAssets.ts` to copy the webview lifecycle pattern (single-instance, strict CSP, nonce, theme vars, message narrowing).
- Read `lastReport.ts` to mirror its API for `lastBrief.ts` (record/peek/take/clear pattern).
- Read `trendReports.ts` for `validateReportPath` (path re-validation on webview messages).
- Confirmed exec->views imports are established precedent (scheduler.ts imports views/scheduleFeedback.ts).
- Confirmed `__resetWebviewPanels()` needed to dispose panels between tests to clear `BriefPanel.current` static field.

### Changes made

**Phase 1 (commit `bb3331d`):**
- `extension/src/exec/standupDigest.ts` — NEW. In-process standup digest generator: `parseConventionalCommit`, `parseGitLog`, `classifyCommits`, `buildStandupMarkdown`, `collectStandupDigest`, `registerStandupDigestCommand`. Exports `CommitEntry`, `StandupDigest`, `FixGroup`, `OtherGroup`.
- `extension/src/test/standupDigest.test.ts` — NEW. 28 tests covering parsing, classification, and markdown rendering.
- `extension/src/exec/projectStats.ts` — Added `StatsMarker`, `parseStatsMarker`, `findPreviousStatsMarker`, `buildStatsMarkerComment`, `buildDeltaHeadline`. `statsHeadline` and `buildStatsMarkdown` accept optional previous marker for delta display.
- `extension/src/test/projectStats.test.ts` — Added marker round-trip, delta headline, findPreviousStatsMarker filesystem tests.
- `extension/src/activation/wiringCommands.ts` — Added `registerStandupDigestCommand` import and call.
- `extension/src/recipes/scheduledRecipes.ts` — Removed shell-kind `ritual.standup`; added command-kind recipe for `saropaWorkspace.recipe.standupDigest`.
- `extension/src/test/scheduledRecipes.test.ts` — Updated to assert command-kind instead of shell-kind.
- `extension/src/i18n/locales/en.json` — Added `standup.*` keys.
- `CHANGELOG.md` — Added standup classification and stats delta entries.
- `plans/guides/STYLEGUIDE.md` — Added §4.8 bullet about `<details>` for bulk output.

**Phase 2 (commit `3eb5adc`):**
- `extension/src/exec/routineRunner.ts` — `writeRoutineSummary` accepts `source: RunSource`; `buildVerdictSection` returns `attentionCount`; gated open logic: scheduled+clean -> channel log, else -> open.
- `extension/src/test/routineRunner.test.ts` — 4 new tests: scheduled+clean (no open), scheduled+failed (open), scheduled+attention (open), manual+clean (open).
- `extension/src/i18n/locales/en.json` — Added `routine.summary.quietClean`.
- `CHANGELOG.md` — Added clean-scheduled-no-open entry.
- `plans/guides/STYLEGUIDE.md` — Updated §4.9 with attention-gated rule.

**Phase 3 (commit `922e4f5`):**
- `extension/src/exec/routineRunner.ts` — Added `RoutineBrief`, `BriefMember` interfaces; `buildRoutineBrief` helper; `recordLastBrief` call; replaced `openReport` with `BriefPanel.show` + try/catch fallback. Import of `BriefPanel` and `recordLastBrief`.
- `extension/src/exec/lastBrief.ts` — NEW. In-memory per-session brief store: `recordLastBrief`, `peekLastBrief`, `latestBrief`, `clearAllBriefs`.
- `extension/src/views/briefPanel.ts` — NEW. Single-instance webview panel following DashboardPanel lifecycle. `show(brief)`, message handler with `validateReportPath`, dispose cleanup.
- `extension/src/views/brief/briefShell.ts` — NEW. HTML shell with strict CSP, per-load nonce, `renderBriefShell()`, `briefUiStrings()`.
- `extension/src/views/brief/briefAssets.ts` — NEW. Inlined CSS (all `--vscode-*` vars, zero raw hex) and client JS (card rendering, message posting).
- `extension/src/commands/morningBrief.ts` — NEW. `registerMorningBriefCommand`: `saropaWorkspace.openMorningBrief` command, with/without pinId argument.
- `extension/src/activation/wiringCommands.ts` — Added `registerMorningBriefCommand` import and call.
- `extension/package.json` — Added `saropaWorkspace.openMorningBrief` command contribution.
- `extension/package.nls.json` — Added `command.openMorningBrief.title`.
- `extension/src/i18n/locales/en.json` — Added `brief.*` keys (title, allClear, needsAttention, openReport, openSummary, none).
- `extension/src/test/_stub/vscode.ts` — `__resetWebviewPanels` now disposes panels before clearing (fixes static `current` field leaking between tests).
- `extension/src/test/routineRunner.test.ts` — Updated 5 tests from `__openedDocuments` to `__lastWebviewPanel`; added `__resetWebviewPanels` to `beforeEach`.
- `extension/src/test/routineBrief.test.ts` — NEW. 7 tests: clear verdict, attention on failure, attention on headline, missing sorts first, reportPath passthrough, durationMs passthrough, generatedAt format.
- `extension/src/test/lastBrief.test.ts` — NEW. 6 tests: peek undefined, record/peek round-trip, overwrite, latestBrief, latestBrief undefined, clearAll.
- `CHANGELOG.md` — Added Morning Brief entry under Added.
- `plans/guides/STYLEGUIDE.md` — Added `brief.title` to §1.1 table; added brief panel bullet to §4.9.

### Decisions & trade-offs
1. **BriefPanel follows DashboardPanel lifecycle exactly** — static `current`, `show()` reveals or creates, disposables array. Chosen for consistency; the dashboard pattern is already proven.
2. **exec->views import for BriefPanel** — the plan noted this was established precedent (scheduler.ts -> scheduleFeedback.ts). A direct import was used.
3. **setTimeout(50ms) for initial postMessage** — same race-avoidance pattern the dashboard uses: the webview script listener needs to attach before data arrives.
4. **`retainContextWhenHidden: false`** for the brief panel — unlike the dashboard (which retains for live process polling), the brief is static data that can be re-posted on reveal. Saves memory.
5. **Fallback to openReport on BriefPanel.show failure** — the plan explicitly required this for webview-hostile environments. Implemented as try/catch with channel logging.
6. **Existing tests updated to __lastWebviewPanel** — since the routine now opens a brief panel instead of calling openReport, the assertions had to change. This is a deliberate behavior change, not a weakened assertion.
7. **__resetWebviewPanels disposes panels** — without this, BriefPanel.current leaked between tests and caused `show()` to call `reveal()` on a stale panel instead of creating a new one.

### Rejected / dismissed / deferred
- **No sparklines/charts** in the brief panel — explicit non-goal per the plan.
- **No self-heal/migration** of already-promoted `ritual.standup` shortcuts — explicit non-goal.
- **No configuration setting** for churn threshold or attention gate — explicit non-goal ("first ship the opinionated behavior").
- **No changes to `ritual.prs`, `ritual.ci`, `ritual.delta`** generators — explicit non-goal.
- **Schedule status-bar action menu** does not gain a new entry — its "Open the last report" continues to open the markdown. The plan noted this as acceptable divergence.

### User feedback & corrections
None during this session — the user provided the plan and said "implement", with no mid-session corrections beyond "continue" after context compactions.

## Key files & paths
- `plans/history/2026.08/2026.08.06/PLAN_morning_brief_redesign.md` — the source plan (3 phases, architecture background, guardrails, verification steps, non-goals) — moved to history on completion
- `extension/src/exec/routineRunner.ts` — routine engine; now exports `RoutineBrief`, `BriefMember`, `buildRoutineBrief`; calls `BriefPanel.show` instead of `openReport`
- `extension/src/exec/lastBrief.ts` — in-memory brief store (record/peek/latest/clearAll)
- `extension/src/views/briefPanel.ts` — single-instance webview panel
- `extension/src/views/brief/briefShell.ts` — HTML shell (CSP, nonce, l10n strings)
- `extension/src/views/brief/briefAssets.ts` — inlined CSS + client JS
- `extension/src/commands/morningBrief.ts` — command registration
- `extension/src/exec/standupDigest.ts` — Phase 1 classified digest generator
- `extension/src/exec/projectStats.ts` — Phase 1 delta stats
- `plans/guides/STYLEGUIDE.md` — updated §1.1 (screen table) and §4.9 (open behavior)

## How to verify
1. `cd extension && npx tsc -p ./ --noEmit` — zero errors
2. `cd extension && node esbuild.js` — bundle builds
3. `cd extension && npm test` — 1184 tests, 0 failures
4. F5 dev host: run a Morning routine manually from the tree; confirm the brief panel opens with verdict band, member cards, and working "Open report" / "Open full summary" buttons. Toggle light/dark theme to verify card rendering. Schedule a clean run and confirm no panel opens (toast + status bar only). Force a failure (point a member at a missing shortcut) and confirm the panel opens with attention verdict.

## Gotchas & traps
- **`extension/CHANGELOG.md` is generated** — a PreToolUse hook blocks edits. Always edit root `CHANGELOG.md`.
- **No AI/Claude mentions** in any tracked file, commit message, or filename — enforced by hook and CLAUDE.md.
- **BriefPanel.current is a static field** — leaks between tests if panels are not disposed in afterEach/beforeEach. The stub's `__resetWebviewPanels()` now disposes all created panels.
- **Phase 2 staging accident** — some Phase 2 edits (routineRunner.ts, en.json, STYLEGUIDE.md) were inadvertently committed with Phase 1 because files were staged after they already contained Phase 2 changes. The Phase 2 commit only has CHANGELOG.md and routineRunner.test.ts. Functionally correct but the git boundary between phases is imprecise.
- **`launcherViewMessages.ts` has an unstaged JSDoc change** in the working tree — pre-existing, not part of this plan. Don't accidentally include it in future commits.
