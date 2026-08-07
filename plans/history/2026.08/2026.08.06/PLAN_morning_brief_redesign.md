# PLAN: Morning brief redesign — content, interruption model, webview

Status: COMPLETE. Three phases, executed in order. Each phase is independently shippable and independently committable. Do not start a phase until the previous phase's verification steps pass.

## Problem statement

The morning routine's summary report (example: a 3-member routine of Sunrise project stats, Standup digest, PR review queue) is visually flat, repeats the same static numbers every day, and buries real signal under generated churn. Observed defects from a real report (2026-08-05, contacts repo):

- The stats headline ("5,669,493 lines across 7,288 files · JSON leads at 68.4% · 695 MB") is a census that barely changes day to day. A report that reads identically every morning trains the reader to stop opening it.
- The standup digest is a raw 180-line `git log --shortstat` fence. 45 of 62 commits were machine-translation sweeps accounting for the entire ±5.3M line count; a security fix and multi-round feature work were invisible inside the dump.
- The summary auto-opens every day even on all-clear (STYLEGUIDE 4.9 mandates this), which combined with the boring content produces alarm fatigue: the user reports the report is "unused".
- The rendering is a default markdown preview: fences, tables, `<details>` — a log file, not a briefing.

## Architecture background (read before coding)

Execution pipeline, all under `extension/src/`:

- A routine is a shortcut whose action is `{ kind: "routine", members }`. `runRoutine` in [exec/routineRunner.ts](../extension/src/exec/routineRunner.ts) runs members sequentially with report auto-open suppressed (`withReportOpenSuppressed` in [exec/reportOpen.ts](../extension/src/exec/reportOpen.ts)), then calls `writeRoutineSummary` which merges member reports and calls `openReport(reportPath)` unconditionally (line ~508).
- Member `ritual.stats` runs command `saropaWorkspace.recipe.projectStats` → [exec/projectStats.ts](../extension/src/exec/projectStats.ts). `statsHeadline()` builds the census line; `buildStatsMarkdown()` renders the report.
- Member `ritual.standup` is a SHELL recipe (`recipes/scheduledRecipes.ts`, `GIT_REPORT_RITUALS`, recipeId `ritual.standup`): `git log --since="24 hours ago" --pretty=format:"%h %s" --shortstat` captured by `runShellToReport` → `buildCommandReport` in [exec/actionRunner.ts](../extension/src/exec/actionRunner.ts). Its headline comes from `summarizeReportBody` (the `<sha> <subject>` branch, which totals shortstat lines).
- Report conventions: every report writes `**Headline:** …` (informs) or `**Attention:** …` (needs action) ABOVE its first fenced block. `extractHeadline` in routineRunner.ts reads only the pre-fence header (`reportHeader`). The routine summary sorts members on this to render "Needs attention (N)" vs "All clear". DO NOT break this contract.
- Report paths: `reportRelativePath(suffix)` in actionRunner.ts → `reports/<date>_workspace/<date>_workspace_<time>_<suffix>.md`. Reports are the durable artifact; [exec/trendReports.ts](../extension/src/exec/trendReports.ts) already reads dated reports back (see `validateReportPath` — reuse it for any path from a webview).
- Scheduled-fire feedback: [views/scheduleFeedback.ts](../extension/src/views/scheduleFeedback.ts) `surfaceRunResult` shows a toast with an "Open report" action after a scheduled run. The schedule status bar shows a "just ran" flash for 2 minutes after a run (`views/scheduleStatusBar.ts`).
- Webview precedent: [views/dashboardPanel.ts](../extension/src/views/dashboardPanel.ts) + `views/dashboard/*.ts` + `views/dashboardShell.ts` — single-instance panel, strict CSP with per-load nonce, theme via `--vscode-*` CSS variables, untyped message narrowing, all disposables tracked. Copy this pattern exactly.
- Delta precedent: [exec/overnightDelta.ts](../extension/src/exec/overnightDelta.ts) — derived comparison over stored state (revision-based baseline), `**Headline:**`/`**Attention:**` convention, `parseShortstat`, command-kind recipe registration. The standup rewrite in Phase 1 mirrors this module's structure.

Conventions that apply to every phase (violations are defects):

- Runtime strings via `l10n('key', { token })` + `extension/src/i18n/locales/en.json`; manifest strings via `%key%` + `extension/package.nls.json`. Never hardcode display strings. Add keys as part of the change.
- Update the ROOT `CHANGELOG.md` `## [Unreleased]` section (never `extension/CHANGELOG.md` — it is generated and a hook blocks it).
- Update [plans/guides/STYLEGUIDE.md](guides/STYLEGUIDE.md) in the same change when a rule is amended or a new surface/convention is added.
- No mention of AI/Claude/assistants in any tracked file, commit message, or file name.
- American English. No hard-wrapped prose in markdown (one bullet = one source line).
- Tests: pure-logic tests run under `npm test` (node --test via esbuild bundle, `extension/src/test/*.test.ts`); anything needing the `vscode` module uses the existing stub in `extension/src/test/_stub/vscode.ts` (see `routineRunner.test.ts` for the pattern). Do not weaken existing assertions.
- Verification per phase, from `extension/`: (1) IDE diagnostics clean after each edit, (2) `npx tsc -p ./ --noEmit`, (3) `node esbuild.js`, (4) `npm test` — all green before commit.
- Commits: `type: subject` + expressive body, no emojis, no attribution.

---

## Phase 1 — Brief-style content (deltas and classification, not dumps)

Goal: the summary and its member reports lead with what CHANGED and what is NOTABLE. Raw evidence stays one click away, never inline in the summary's first screen.

### Task 1.1 — Standup digest becomes a classified in-process generator

New file `extension/src/exec/standupDigest.ts`, modeled line-for-line on the structure of `overnightDelta.ts` (git helper with `GIT_TIMEOUT_MS`/`MAX_GIT_BUFFER`, collect → build markdown → register command → run wrapper that writes the dated report and returns its path).

Data collection (`collectStandupDigest(root)`):

- `git log --since="24 hours ago" --pretty=format:%h%x09%s --shortstat` (tab-separated so subjects with spaces parse safely). Parse into `CommitEntry { sha, subject, files, insertions, deletions }`. Reuse the shortstat clause regexes from `parseShortstat` in overnightDelta.ts — import it rather than copying (export it if needed).
- Parse each subject as a conventional commit: `/^(\w+)(?:\(([^)]*)\))?(!)?:\s*(.*)$/` → `{ type, scope, breaking, description }`. A non-matching subject gets `type: undefined` and is classified as "other".

Classification (`classifyCommits(entries)` — pure, exported for tests):

- **Churn**: a commit whose type is `chore` AND (insertions + deletions) > `CHURN_LINE_THRESHOLD` (10,000), OR whose subject matches `/machine-translation|auto-generated|regenerated?/i`. Churn is folded: never listed individually, summarized as one line with commit count and total ± lines.
- **Notable**, in priority order: (1) any commit whose type/scope/description matches `/security|auth|token|credential|vulnerab/i` or has the breaking `!` marker; (2) `feat` commits; (3) `fix`/`harden` commits grouped by scope with a count ("fix(duplicates) × 8"); (4) everything else grouped by type.
- Output shape: `StandupDigest { total, churn: { commits, insertions, deletions }, security: CommitEntry[], features: CommitEntry[], fixGroups: { scope, count, latestSubject }[], otherGroups: { type, count }[], insertions, deletions }` (hand-work line totals EXCLUDE churn).

Rendering (`buildStandupMarkdown(digest)`):

- H1 `# Standup digest`, generated stamp, then the headline line. Headline is hand-work first: `"17 commits by hand (4 features, 8 duplicates fixes) · 45 generated-churn commits folded (±5.3M lines)"`. Security findings promote the line to `**Attention:**` naming the commit (`"Security-relevant commit landed: fix(auth): reject poisoned OAuth tokens"`); otherwise `**Headline:**`.
- Body, ALL above any fence: `### Security` bullets (sha + subject, only when present), `### Features` bullets (max 10), `### Fixes by area` bullets ("duplicates — 8 commits, latest: <subject>"), `### Generated churn` one line, then the full raw log inside ONE `<details>` block containing the fence (`fenceBlock` from actionRunner.ts). The headline/attention line MUST stay above the first fence or `extractHeadline` cannot lift it.
- Empty window: reuse the quiet-period phrasing pattern from `describeQuiet` (import it from overnightDelta.ts).

Wiring:

- Register command `saropaWorkspace.recipe.standupDigest` (mirror `registerOvernightDeltaCommand`; call the register function from wherever `registerOvernightDeltaCommand` is called — grep for it in `extension.ts` / activation modules and add alongside). Report suffix: `standup` (unchanged, so trend history stays continuous).
- In `recipes/scheduledRecipes.ts`: REMOVE the `ritual.standup` row from `GIT_REPORT_RITUALS` and push it inside `pushGitRituals` as a command-kind recipe instead (copy the `ritual.delta` push block: `commandId: "saropaWorkspace.recipe.standupDigest"`, `commandArgs: [folder.uri.fsPath]`, same label/icon/description/atTime as the removed row, description updated to mention classification). Note: an already-promoted stored `ritual.standup` shortcut keeps its old shell action — that is acceptable; the recipe self-heal is out of scope. State this in the commit body.
- l10n: any new user-facing runtime strings (toast text if any) go through `l10n()`. Report BODY text (headings, phrasing inside the markdown file) follows the existing precedent in overnightDelta.ts/projectStats.ts — those are currently English literals in the generators; keep consistent with that precedent, do not invent a new one.

Tests (`extension/src/test/standupDigest.test.ts`, pure — no vscode import):

- Conventional-commit parsing: plain subject, scoped, breaking `!`, non-conforming subject.
- Classification: churn by line threshold, churn by subject pattern, security by scope `auth`, security by keyword in description, feat/fix grouping by scope, hand-work totals exclude churn.
- Markdown: headline above first fence; attention set when a security commit exists; `<details>` present with fenced raw log; empty window renders a quiet line and no empty fence.
- Extend nothing in `actionRunner.test.ts` — `summarizeReportBody` keeps working for hand-written shell shortcuts; it is no longer on the standup path but its behavior is unchanged.

### Task 1.2 — Project stats leads with the delta

In `exec/projectStats.ts`:

- Append a machine-readable marker to `buildStatsMarkdown` output, at the very END of the document: `<!-- saropa-stats: {"totalFiles":N,"totalLines":N,"totalBytes":N} -->` (single line, JSON.stringify of a new exported `StatsMarker` interface). This is the durable baseline for the next run.
- New exported pure function `findPreviousStatsMarker(reportsRoot, before)`: scan `reports/*_workspace/` directories (newest-first by folder name — the dotted date sorts lexicographically) for the newest `*_project_stats.md` file strictly older than the current run, read it, and regex-extract the marker. Return `undefined` when none found or unparseable. Bound the scan to the newest 14 day-folders so a year of reports is not read every morning.
- `statsHeadline(stats, previous?)`: when a previous marker exists, lead with the delta: `"+3,412 lines, +12 files since the last report (now 5,672,905 lines)"`; append the dominant-language clause only when its share moved by ≥0.5 points (compare against previous — requires storing top language share in the marker too; add `topLanguage` and `topShare` fields). When no previous marker exists, fall back to the current census line unchanged.
- `runProjectStats` calls `findPreviousStatsMarker` before writing, passes the result through. Delta computation is derived from the durable report artifact on disk — consistent with the "derived comparison over stored state" decision (plans/history/2026.07/2026.07.20/morning-report-exception-first-redesign.md) because the artifact is inspectable and survives machine changes with the repo's reports/ tree; state this in a code comment.

Tests (`extension/src/test/projectStats*.test.ts` — check what exists first; add a new pure test file if the module has no test):

- Marker round-trip: build markdown → extract marker with the same regex `findPreviousStatsMarker` uses (export the regex or a `parseStatsMarker(content)` helper so the test targets the real parser).
- Headline with previous: positive delta, negative delta, zero delta (renders "unchanged since the last report" — decide phrasing and pin it), share-moved clause included/excluded at the 0.5-point boundary.
- Headline without previous: byte-identical to the current census output (pin with an exact-string assertion so the fallback never drifts).
- `findPreviousStatsMarker` on a temp directory: picks newest older file, skips the current run's own file, returns undefined on empty/no-marker.

### Task 1.3 — Summary never inlines a fence on its first screen

In `writeRoutineSummary` (exec/routineRunner.ts): no change to the merge logic is required IF Tasks 1.1/1.2 land — the standup member report now carries its own `<details>`-wrapped fence and classified bullets above it, and `embedMemberReport` merges it as-is. Verify by running the morning routine in the dev host and confirming the summary's expanded view shows classified bullets, with the raw log two clicks deep (member section → inner details). If any OTHER member (PR queue) still inlines a bare fence directly under its `<summary>`, leave it: a short fence (a 3-line PR list) is content, not noise. Do NOT add generic fence-collapsing post-processing — that is speculative complexity.

### Phase 1 changelog + docs

- Root `CHANGELOG.md` [Unreleased] → Changed: standup digest classifies commits (security first, features, fix groups) and folds generated churn; project stats leads with the day-over-day delta.
- STYLEGUIDE: extend §4.8/§4.9 (report conventions) with one bullet: a report generator that captures bulk output places it inside `<details>` below its classified findings; the headline stays above the first fence.

---

## Phase 2 — Attention-gated auto-open

Goal: a clean scheduled morning no longer opens a window. The toast and the status-bar "just ran" flash are the all-clear surface; the document auto-opens only when it needs the reader.

### Task 2.1 — Gate the summary open on attention + source

In exec/routineRunner.ts:

- Thread `source: RunSource` from `runRoutine` into `writeRoutineSummary` (it is in scope at the call site, line ~276).
- Inside `writeRoutineSummary`, the open decision becomes: open when `source !== "scheduled"` (a manual run must produce a visible window — no-silent-async rule), OR `anyFailed`, OR `attentionCount > 0` (`attentionCount` is already computed ~line 416; hoist it if needed so the open decision can read it). A scheduled all-clear run writes the file, records `recordLastReport`, logs to the channel, and does NOT call `openReport`.
- The scheduled-fire toast already covers findability: `recordFireResult` in exec/scheduler.ts calls `surfaceRunResult(name, outcome, reportAbs)` which offers "Open report". Confirm by reading that path — no code change expected there. The status-bar just-ran flash (views/scheduleStatusBar.ts) also links the report through its action menu.
- Log line: when the open is suppressed, append a channel line via a new l10n key (e.g. `routine.summary.quietClean`: "{name}: all clear — summary written to {path}, not opened") so the outcome is traceable.

### Task 2.2 — Amend STYLEGUIDE §4.9

Replace the bullet "**The summary opens on every run, including a clean one.**" with: the summary auto-opens for every MANUAL run and for any run needing attention; a clean SCHEDULED run surfaces through the completion toast and the status-bar just-ran flash instead, both of which link the report. Record the rationale: the original rule fixed report findability (user report 2026-07-10); findability is now provided by two surfaces that do not cost a window, and a daily unconditional open produced alarm fatigue (user report 2026-08-05).

### Task 2.3 — Tests

`extension/src/test/routineRunner.test.ts` uses the vscode stub and already drives `writeRoutineSummary` through `runRoutine` (see existing tests around lines 129–750). Add:

- Scheduled + all clear → no editor raised (assert via the stub's opened-documents tracking, `__openedDocuments`), file still written, `recordLastReport` still called.
- Scheduled + one failed member → editor raised.
- Scheduled + attention headline (member report with `**Attention:**`) → editor raised.
- Manual + all clear → editor raised (regression pin for the no-silent-async rule).
- Audit existing tests that assert the summary opens: update any that ran with `source: "scheduled"` and a clean outcome to the new expectation — deliberately, with a comment naming this plan.

### Phase 2 changelog

- Root `CHANGELOG.md` [Unreleased] → Changed: a clean scheduled morning routine no longer opens the summary window; the completion toast and status-bar flash link it. Manual runs and any run needing attention still open it.

---

## Phase 3 — Saropa Morning Brief webview

Goal: the routine's result renders as a designed briefing screen — verdict, member cards, click-through — instead of a raw markdown preview. The markdown file remains the durable artifact and the fallback.

### Task 3.1 — Structured brief data

In exec/routineRunner.ts:

- New exported interface `RoutineBrief { routineName, generatedAt, verdict: "clear" | "attention", attentionCount, members: BriefMember[] , summaryPath }` where `BriefMember { label, status, headline?, attention, durationMs?, reportPath? }` — assembled inside `writeRoutineSummary` from data it already has (`outcomes`, `headlines`, `problems`). No new computation; this is a projection.
- New module `extension/src/exec/lastBrief.ts` mirroring `lastReport.ts` exactly (in-memory, per-session, keyed by routine shortcut id): `recordLastBrief(pinId, brief)`, `peekLastBrief(pinId)`, `latestBrief()` (the most recently recorded one, for the command with no argument). Comment the module header the way lastReport.ts does.
- `writeRoutineSummary` records the brief after writing the file.

### Task 3.2 — The panel

New `extension/src/views/briefPanel.ts` following `DashboardPanel` verbatim in lifecycle (static `current`, `show()` reveals or creates, `viewType: "saropaWorkspace.morningBrief"`, disposables array, message narrowing). Rendering in a sibling `views/brief/briefShell.ts` (copy the shell/nonce/CSP approach from `views/dashboardShell.ts` — read it first and reuse its helpers if they are exported; do not duplicate a nonce generator if one is importable).

Screen contract (STYLEGUIDE §1.1 applies):

- Title: l10n key `brief.title` = "Saropa Morning Brief" — panel title argument, HTML `<title>`, and in-page `<h1>` all from this one key. Add the row to the screens table in STYLEGUIDE §1.1.
- Header: routine name, generated time, one verdict band — "All clear" (theme green, `--vscode-charts-green` or `--vscode-testing-iconPassed`) or "Needs attention (N)" (`--vscode-charts-red`/`--vscode-testing-iconFailed`). Use `--vscode-*` variables exclusively; zero raw hex.
- One card per member: codicon-style status glyph (reuse the unicode/svg approach the dashboard uses — inspect `dashboardShell.ts` before inventing), member label, headline text (or the status detail for failed/missing), duration when present, and an "Open report" button when `reportPath` exists. Attention/failed cards sort first and carry the attention accent; clear cards render muted.
- Footer: "Open full summary" button → opens `summaryPath`.
- Every path received back from the webview message handler is re-validated with `validateReportPath` from exec/trendReports.ts before opening (the dashboard's `openTrendReport` shows the pattern — reuse, do not re-implement).
- All new user-visible strings (button labels, empty state, verdict text) through `l10n()` with keys under `brief.*` in `en.json`.

### Task 3.3 — Wiring and open path

- Command `saropaWorkspace.openMorningBrief` (manifest: `%command.openMorningBrief.title%` = "Saropa Workspace: Open Morning Brief" in package.json + package.nls.json; grep an existing command contribution for the exact manifest shape). With an argument (pinId) it shows that routine's brief; without, `latestBrief()`; with none recorded, toast `brief.none` ("No routine has run this session.") — visible outcome, never silent.
- In `writeRoutineSummary`, where Phase 2 decided to open: open the BRIEF PANEL instead of the markdown (`BriefPanel.show(...)`) — the markdown open remains the body of the footer button and the fallback if panel creation throws (wrap in try/catch; on error fall back to `openReport(reportPath)` so a webview-hostile environment degrades to Phase 1/2 behavior, and log the error to the channel).
- routineRunner (exec/) must not import views/ directly if that creates a layering violation — check how exec modules currently reach UI (scheduler.ts imports views/scheduleFeedback.ts, so exec→views imports are established precedent; a direct import is acceptable).
- The schedule status-bar action menu (`views/scheduleStatusBarActions.ts`) gains no new entry — its "Open the last report" continues to open the markdown; acceptable divergence, note it in the commit body.

### Task 3.4 — Tests

- Pure projection test (`extension/src/test/routineBrief.test.ts`): building `RoutineBrief` from outcomes+headlines — attention counting, sort order (attention first), reportPath passthrough, clear verdict on empty problems.
- `lastBrief.test.ts`: record/peek/latest semantics, overwrite by same pinId (mirror `lastReport`'s test if one exists; if none exists, still write this one).
- The panel itself needs the extension host and cannot run under `npm test` — do not attempt; per test rules, keep host-dependent assertions out. Manual smoke test in the dev host instead (see Verification).

### Phase 3 changelog + docs

- Root `CHANGELOG.md` [Unreleased] → Added: Saropa Morning Brief — a briefing screen that opens after a routine run with a verdict band, per-member cards, and one-click report access; the markdown summary remains on disk and one click away.
- STYLEGUIDE: add the screen to §1.1 table; add a §4.x bullet describing the brief as the routine's opening surface with the markdown as durable artifact.

---

## Phase-by-phase verification (repeat per phase, from `extension/`)

1. IDE diagnostics clean on every edited file.
2. `npx tsc -p ./ --noEmit` — zero errors.
3. `node esbuild.js` — bundle builds.
4. `npm test` — all tests green (was 1105 passing at plan time; count must not go down).
5. Dev-host smoke test (F5): run the Morning routine manually from the tree; confirm the phase's user-visible behavior (Phase 1: classified standup + delta stats headline in the summary; Phase 2: schedule a clean run 1–2 minutes out, confirm toast + no window, then force a failure — point a member at a missing shortcut — and confirm the window opens; Phase 3: brief panel opens, cards render in light and dark themes, buttons open the right files).
6. Commit with an expressive message; one commit per phase is acceptable, finer-grained is better.

## Explicit non-goals (do not do these)

- No self-heal/migration of already-promoted `ritual.standup` shortcuts from shell to command kind.
- No configuration setting for the churn threshold or the attention gate — first ship the opinionated behavior.
- No sparklines/charts in the brief panel (candidate follow-up, not this plan).
- No changes to `ritual.prs`, `ritual.ci`, `ritual.delta` generators.
- No `markdown.previewStyles` contribution (it would restyle every markdown preview in the workspace — rejected for blast radius).
- No new npm dependencies anywhere in this plan.

## Finish Report (2026-08-06)

All three phases shipped across commits `bb3331d`, `3eb5adc`, and `922e4f5`.

### Phase 1 — Classified standup digest + project stats delta (`bb3331d`)

`standupDigest.ts` parses `git log --shortstat` output via conventional-commit heuristics and classifies commits into security, feature, fix-by-area, and churn buckets. Churn (machine-translation sweeps, large generated commits) collapses into a single summary line; the raw log remains accessible via a `<details>` fold. `projectStats.ts` gains `StatsMarker` — an HTML comment embedded in each report that records the snapshot's metrics — enabling `buildDeltaHeadline` to compute day-over-day deltas ("+N lines, +M files") instead of repeating a static census. 28 unit tests cover parsing, classification, and markdown rendering. The shell-kind `ritual.standup` recipe was replaced with a command-kind recipe pointing at `saropaWorkspace.recipe.standupDigest`.

### Phase 2 — Attention-gated summary auto-open (`3eb5adc`)

`writeRoutineSummary` accepts a `RunSource` discriminant (`manual` vs `scheduled`). `buildVerdictSection` returns `attentionCount` (count of members with failures or attention-worthy headlines). A scheduled run whose `attentionCount` is zero logs to the output channel instead of opening the summary — eliminating daily alarm fatigue on clean mornings. Manual runs and any run needing attention still open. 4 tests validate the gating matrix.

### Phase 3 — Saropa Morning Brief webview panel (`922e4f5`)

`BriefPanel` follows the existing `DashboardPanel` lifecycle (static `current`, `show()` reveals-or-creates, disposables array, `retainContextWhenHidden: false`). The panel renders `RoutineBrief` data: a verdict band ("All clear" / "Needs attention"), per-member cards with status glyphs and headlines, and footer buttons for "Open report" / "Open full summary". CSS uses exclusively `--vscode-*` theme variables — zero raw hex. A strict CSP with per-load nonce matches the dashboard's security posture. `lastBrief.ts` provides an in-memory per-session brief store (`recordLastBrief`/`peekLastBrief`/`latestBrief`/`clearAllBriefs`). The `saropaWorkspace.openMorningBrief` command opens the most recent brief from the store. 13 new tests cover brief projection, the store API, and report-path validation.

### Cross-cutting

- All user-facing strings externalized: manifest strings in `package.nls.json`, runtime strings in `en.json` via `l10n()`.
- STYLEGUIDE.md updated: §1.1 screen table gains `brief.title`, §4.8 documents `<details>` for bulk output, §4.9 documents the attention-gated open rule and brief panel entry.
- Existing `routineRunner.test.ts` assertions migrated from `__openedDocuments` to `__lastWebviewPanel` to match the new behavior; `__resetWebviewPanels` added to `beforeEach` to dispose the static `BriefPanel.current` between tests.

### Verification

- `npx tsc -p ./ --noEmit`: zero errors.
- `node esbuild.js`: bundle builds.
- `npm test`: 1184 tests, 0 failures.
- Dev-host smoke test not performed in this session (resumed from handover; prior session verified all three phases in the dev host).

### Post-plan hardening and additions (same day, second session)

**Ready handshake**: Replaced the `setTimeout(50)` timing hack in `BriefPanel` with a proper webview-initiated handshake: the client script posts `{ type: "ready" }` once its message listener is attached, and the host responds with `briefData`. Since `retainContextWhenHidden` is false, a tab-switch destroys and recreates the webview script, which posts `ready` on mount — no `onDidChangeViewState` needed.

**StatsMarker version field**: `StatsMarker` now carries an optional `v` field (defaults to 1 for legacy markers). `parseStatsMarker` rejects markers with `v` above `STATS_MARKER_VERSION`, so a future format change won't silently produce wrong deltas. `buildStatsMarkerComment` writes `v: 1`.

**"Save as HTML" export**: New `briefExport.ts` renders the brief as a self-contained HTML file with inline CSS, `prefers-color-scheme` dark/light media queries, and all strings resolved through l10n at generation time. The brief panel gains a "Save as HTML" secondary button; clicking it opens a save dialog and writes the file. A toast confirms the save with the file path.

**Test stub updates**: `FakeWebviewPanel` gained `onDidChangeViewState` and `visible` fields; `window.showSaveDialog` stub added.

**"Copy as Markdown" export**: `renderBriefMarkdown` in `briefExport.ts` renders the brief as a Markdown snippet — title line, verdict, one line per member with status emoji (✅/❌/⏭️), bold label, headline, and duration. The brief panel gains a "Copy as Markdown" secondary button; clicking it copies the snippet to the clipboard via `vscode.env.clipboard.writeText` and confirms with a toast.

**Save dialog default path**: `saveBriefAsHtml` now anchors the save dialog's `defaultUri` to the workspace root folder instead of a bare filename, so the OS file picker opens in a useful location.

**Test stub updates**: `FakeWebviewPanel` gained `onDidChangeViewState` and `visible` fields; `window.showSaveDialog` stub added.

**Tests**: 8 tests for `renderBriefExportHtml`, 6 tests for `renderBriefMarkdown`, 3 tests for StatsMarker versioning. Total: 1206 tests, 0 failures.
