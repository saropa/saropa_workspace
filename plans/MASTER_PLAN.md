# Master plan — Saropa Workspace usability overhaul

_Generated 2026-09-02 from a full extension audit covering 250+ source files, 18 active plans, 10 competitor analyses, and all documentation._

## Executive summary

Saropa Workspace is a feature-rich, well-engineered VS Code extension with strong internal discipline (comment density, dispose hygiene, no-silent-async compliance, CSP/nonce security in webviews). However, the extension has grown to 103 registered commands, 37 settings, 6 sidebar views, and a panel webview — creating discoverability and onboarding friction that undermines the power underneath. This plan prioritizes the work that most directly improves the user's first-10-minutes experience and ongoing daily workflow.

Bug reports are tracked separately in `bugs/` and are not duplicated here.

## How to read this plan

- **P1 (High)**: UX gaps that affect daily workflows. Target the next release cycle.
- **P2 (Medium)**: Robustness, consistency, and optimization items. Schedule across 2-3 releases.
- **P3 (Low)**: Code quality, naming, and minor improvements. Address opportunistically.
- Each phase beyond Phase 3 covers a distinct category (docs, wow features, backlog).

---

## Phase 1 — High-impact UX improvements (P1) ✅

### 1.1 Flatten the Explorer context menu ✅

- **What:** Adding a shortcut from Explorer requires 3 clicks (right-click → Workspace Shortcut → Add). Competitors (Favorites/kdcro101) do it in 1 click.
- **Fix:** Promote "Add to Project Shortcuts" to a top-level Explorer context-menu entry. Keep the submenu for less-common actions (Add to Global, Pin Until, etc.).
- **Status:** Done. `addProjectPin` and `removeProjectPin` are top-level entries in `explorer/context` at `group: "saropa@1"`.

### 1.2 Reduce view-title icon clutter ✅

- **What:** The pins view title bar shows up to 6 icons. VS Code guidance recommends 2-3.
- **Fix:** Keep filter and refresh inline. Move the rest (run-any, open-schedule, show-all-branches) to the overflow "..." menu.
- **Status:** Done. 3 inline icons (filter, pick-mode, refresh); run-any, open-schedule, show-all-branches moved to overflow groups.

---

## Phase 2 — Robustness and optimization (P2)

### 2.1 Lazy activation

- **What:** Extension activates on `onStartupFinished` (every VS Code launch). Users with no shortcuts configured still pay activation cost.
- **Fix:** Switch to `onView:saropaWorkspace.pins` + command-based activation events. Requires verifying no side-effects depend on eager activation (boot sequence, scheduler, branch tracker).
- **Status:** Not started. `onStartupFinished` still present in `activationEvents`.

### 2.2 Cap background output accumulation ✅

- **What:** `backgroundRunner.ts` `attachOutputCapture` accumulates full stdout+stderr in memory with no size cap. A long-running process producing megabytes of output causes unbounded memory growth.
- **Fix:** Cap accumulated output (keep last 1MB, or first + last 512KB). Truncation marker in the middle.
- **Status:** Done. `createBoundedCapture()` in `outputCapture.ts` enforces 1 MB cap (512 KB head + 512 KB tail). Unit tests in `outputCapture.test.ts`.

### 2.3 Case-sensitive path comparison on Windows ✅

- **What:** `shortcutStoreBase.ts` `toFolderRelative` uses `startsWith` on `fsPath`. Can fail on case-insensitive Windows filesystems if folder and file URIs have different casing.
- **Fix:** Normalize both to lowercase before comparison on `win32`.
- **Status:** Done. `relativeToBaseLoose()` in `pathCompare.ts` uses `normalizeForCompare()` with `.toLowerCase()` on case-insensitive filesystems (detected via runtime FS probe).

---

## Phase 3 — Code quality and polish (P3)

### 3.1 Unify "pin" vs "shortcut" terminology — partially done

- **What:** Internal code uses "pin" (command IDs, model types) while user-facing strings say "Shortcut." Launcher webview still shows "Pin" as a button label.
- **Fix:** Audit all user-facing surfaces for "pin" leakage. Update launcher button labels and any remaining NLS strings. Command IDs are a breaking change — defer to a major version.
- **Status:** Partially done. Bulk of NLS strings migrated to "Shortcut." Remaining leaks: `launcher.pin: "Pin"` button label on recipe cards (`en.json:18`), `"auto-pins"` in ecosystem toast (`en.json:135`). Command IDs unchanged (breaking change, deferred).

### 3.2 Dead imports cleanup

- **What:** `shortcutStore.ts`, `shortcutStoreBase.ts`, `shortcutStoreRecipes.ts`, `shortcutStoreRefresh.ts`, `shortcutStoreSets.ts` have large unused import blocks (leftover from file splits).
- **Fix:** Run `npx tsc -p ./ --noEmit` to confirm TS6133 warnings, then remove unused imports.
- **Status:** Not started. No lint pass run; overlapping import sets across the chain suggest some may be unused but requires compiler check.

### 3.3 Heartbeat CSV rotation

- **What:** `process-trend.csv` grows indefinitely with no rotation. After months of use, `parseTrendSeries` full-file parse becomes slow.
- **Fix:** Rotate or truncate to last N days/samples (e.g. 90 days). Archive older data or discard.
- **Status:** Not started. `heartbeat.ts` `appendCsv` appends indefinitely; `parseTrendSeries` reads entire file into memory.

### 3.4 Report file accumulation

- **What:** `runShellToReport` writes dated Markdown reports with no cleanup. The `reports/` directory accumulates stale files indefinitely.
- **Fix:** Add a pruning pass on startup (keep last N reports per shortcut, or last 30 days).
- **Status:** Not started. No pruning or retention logic exists.

### 3.5 Async Python install scan

- **What:** `interpreterDetect.ts` `scanPythonInstalls` uses synchronous `fs.readdirSync`/`fs.statSync` on `C:\` on the extension host's main thread. Can cause a perceptible hitch.
- **Fix:** Convert to `fs/promises` for consistency with the rest of the codebase's IO conventions.
- **Status:** Not started. `scanPythonInstalls` uses `readdirSync`/`statSync` throughout.

---

## Phase 4 — Documentation overhaul

### 4.1 README.md (High priority) — partially done

- Strip aspirational language describing unshipped features (Visual Planner graph chains, Smart Onboarding, Ecosystem Diagnostics) — only describe shipped features.
- Update config path from `.vscode/saropa-workspace.json` to `.saropa/` default.
- Expand settings and command tables or link to the extension's settings UI.
- Verify all Saropa Suite member extensions exist on the Marketplace.
- **Status:** Config path and unshipped feature language already cleaned up. Settings/command tables and Suite verification remain.

### 4.2 SECURITY.md (High priority)

- Update version table from `0.1.x` to current `1.6.x`.
- Expand scope to cover scheduling, external execution, bundled scripts, and URL opening.
- Update config path.

### 4.3 CONTRIBUTING.md (High priority)

- Refresh project layout table (`pin*` → `shortcut*`, add missing directories: `recipes/`, `launcher/`, `dashboard/`, `notes/`, `scripts/`, `schedule/`).
- Add `npm test` / unit test runner instructions.
- Update config path.

### 4.4 BUG_REPORT_GUIDE.md (Medium priority)

- Rename all `pin` references to `shortcut`.
- Add area slugs for: schedule, routine, recipe, launcher, notes, scripts, suite, watch.
- Update config path and version references.

### 4.5 CHANGELOG.md (Medium priority) — partially done

- Fix version typo: `1.4.18` → `1.5.18`.
- Clarify whether 1.6.12 is released or unreleased.
- Archive 1.5.16-1.5.19 to CHANGELOG_HISTORY.md to stay under the 500-line target.
- **Status:** Partially done. Version typo fixed. Archival of 1.5.16–1.5.20 to CHANGELOG_HISTORY.md done. 1.6.12 clarification remains.

### 4.6 ROADMAP.md (Low priority)

- Update config path.
- Refresh backlog summary to reflect current active plans (remove references to completed work like branch-aware sets and the dashboard webview).

### 4.7 Plans directory cleanup

_Every plan file was read in full and its claims verified against the live
codebase (2026-09-03), not just skimmed. Disposition below; remaining
actionable items from each folded/archived file are now tracked in
[Phase 6](#phase-6--carried-forward-from-individual-plan-files)._

| File | Disposition | Verified reason |
|------|-------------|------------------|
| `1.2-multi-root-refinements.md` | Folded into [6.1](#61-cross-folder-pin-grouping-multi-root); archived to `history/2026.09/2026.09.03/` | Attribution item shipped; cross-folder grouping + test audit remain |
| `2.1-export-share-pin-sets.md` | Archived as-is to `history/2026.09/2026.09.03/` (already tracked by 4.2) | `exportPins`/`importPins` verified registered in `package.json`; only test coverage remains, already covered by section 4.2 |
| `4.2-integration-smoke-test.md` | Content already reflected in section 4.2 above; archived to `history/2026.09/2026.09.03/` | No integration harness exists; blocked on the (also unbuilt) 4.1 unit-test harness |
| `FILE_MAPPING_DECORATION.md` | Moved to `plans/guides/` | ~300-entry maintained icon/color specification, not a plan — belongs alongside `STYLEGUIDE.md`/`principles.md` |
| `PIN_BADGE_TREND.md` | Folded into [6.2](#62-pin-badge-trend-sparkline-step-2); archived to `history/2026.09/2026.09.03/` | Step 1 verified shipped (`previousByShortcut` + `formatBadgeDelta` in `shortcutBadges.ts`); Step 2 ring buffer/sparkline remains |
| `PLAN_15_conflict_center.md` | Folded into [6.3](#63-git-conflict-command-center); archived to `history/2026.09/2026.09.03/` | Not started, speculative, moderate-to-high risk |
| `PLAN_23_run_rollback.md` | Folded into [6.4](#64-run-rollback-revert-last-run); archived to `history/2026.09/2026.09.03/` | Not started, high risk (destructive git ops) |
| `PLAN_NOTES_PHASE_2_3.md` | Folded into [6.5](#65-notes-feature--phase-2-organization-and-phase-3-cross-project); archived to `history/2026.09/2026.09.03/` | Notes Phase 1 shipped; Phase 2/3 not started |
| `PLAN_integrate python scripts.md` | **Status corrected in place**, kept active in `plans/` | STALE: said Scripts view (steps 1-3) "not built," but `scriptsTreeProvider.ts` exists and is registered, `library.json` has 7 entries. Remaining items (migration + `publish.py` validation) folded into [6.11](#611-scripts-library--remaining-migration--validation) |
| `PLAN_scripts_to_surface.md` | **Deleted** | Pure duplicate of the 26-script inventory tracked in `PLAN_integrate python scripts.md`; the 19-remaining list is preserved in [6.11](#611-scripts-library--remaining-migration--validation) |
| `PLAN_suite_report_deltas.md` | Folded into [6.6](#66-suite-daily-report--week-over-week-deltas); archived to `history/2026.09/2026.09.03/` | Not started; `dailyReport.ts` dependency verified shipped |
| `PLAN_THIRD_SCOPE_USER_PROJECT.md` | Folded into [6.7](#67-third-pin-scope--userproject-private-per-project-pins); archived to `history/2026.09/2026.09.03/` | Not started; has 3 open design questions requiring user input before implementation; `ShortcutScope = "project" \| "global"` 2-value claim verified true |
| `PLAN_UNCOMMITTED_FILES_WATCH.md` | Folded into [6.8](#68-watch-for-uncommitted-filesfolders); archived to `history/2026.09/2026.09.03/` | Not started, well-designed; `folderWatch.ts` model dependency verified to exist |
| `remote-run.md` | Folded into [6.9](#69-remote-script-execution-remote-sshwslcontainers); archived to `history/2026.09/2026.09.03/` | Pin+open on remote filesystems shipped; running the script on the remote host remains |
| `TODO_better integration with saropa suite.md` | Folded into [6.10](#610-saropa-suite-conductor--pillars-a-and-c); archived to `history/2026.09/2026.09.03/` | Pillar B (daily report) verified shipped via `dailyReport.ts`; Pillars A and C remain |
| `WOW_X5.md`, `WOW_X5_modules.md`, `WOW_X5_security.md` | Merged into one `WOW_X5_HUD_LAUNCHER.md`, moved to `plans/deferred/` | Standalone Tauri desktop HUD launcher — a separate application, not a Workspace feature; no implementation started; review notes document bugs in every module — mandatory reading before anyone picks this up |
| `deferred/HAPTIC_EVENT_CUES.md` | Left in place | Correctly deferred; platform-blocked (no VS Code haptics API), clear re-entry conditions already documented |

---

## Phase 5 — Wow items and competitive advantages

### 5.1 Drag-and-drop from Explorer to sidebar ✅

- **What:** Competitors (Favorites/kdcro101) support dragging files from Explorer directly to the Shortcuts sidebar. Saropa requires a right-click menu or command.
- **How:** Register a `TreeDragAndDropController` on the Shortcuts view that accepts `text/uri-list` from the Explorer.
- **Status:** Done. `TreeDragAndDropController` registered in the shortcuts view.

### 5.2 Onboarding wizard for first install

- **What:** New users see 6 sidebar views, a panel, and 37 settings with no guidance. The welcome view text is too long for its rendering area.
- **How:** A single-page walkthrough webview on first activation: "Pin your first file" → "Run a script" → "Explore recipes." Set `hasCompletedOnboarding` in globalState to suppress after first run.

### 5.3 Quick-add command with recent files

- **What:** A QuickPick showing recently opened files (from VS Code's MRU) with a one-key "pin it" action. Faster than right-click → menu for rapid shortcut setup.

### 5.4 Status bar quick-run

- **What:** A persistent status bar item showing the top-pinned shortcut name. Click to run, right-click for the run palette. Provides always-visible, zero-navigation access to the most-used shortcut.

### 5.5 Shortcut usage analytics in the sidebar

- **What:** Show run count and last-run-time in the shortcut tooltip or description. Help users identify which shortcuts they actually use vs. which are dead weight.
- **Note:** Telemetry data already exists (`telemetry.ts`). This is a presentation-layer change.

### 5.6 Linux terminal emulator preference

- **What:** `externalLauncher.ts` hardcodes a probe order (`x-terminal-emulator`, `gnome-terminal`, `konsole`, `xterm`) with no way for the user to set a preferred emulator.
- **How:** Add a `saropaWorkspace.externalTerminal` setting. Fall back to the probe order when unset.

---

## Phase 6 — Carried forward from individual plan files

_Folded in from the plans/ directory review (2026-09-03). Each item below was a
standalone plan file, verified against the codebase and archived to
`plans/history/2026.09/2026.09.03/` once its content was absorbed here. See
section 4.7 for the full per-file disposition._

### 6.1 Cross-folder pin grouping (multi-root)

- **Source:** `1.2-multi-root-refinements.md`. Per-folder ownership, reactive
  add/remove, and cross-folder cwd/path resolution are already shipped;
  attribution (owning-folder row tag/tooltip) is also shipped.
- **What remains:** with 2+ folders open, group project pins under their
  owning folder in the tree (`pinsTreeProvider.ts`, view-layer only — no
  schema change). Same-named groups across folders render merged in the tree
  (display-only); do not add a cross-folder group storage primitive — it
  would violate the folder-relative path invariant.
- **Test debt:** lock down with tests once the 4.1 harness exists — a pin in
  folder B resolves `cwd`/`$workspaceRoot` to B; removing/re-adding a folder
  preserves its pins and timers.

### 6.2 Pin badge trend sparkline (Step 2)

- **Source:** `PIN_BADGE_TREND.md`. Step 1 (previous-run delta:
  `ShortcutBadgeRegistry.previousByShortcut` + `formatBadgeDelta()`, ▲/▼
  inline in the row description and tooltip) is shipped — verified in
  `shortcutBadges.ts`.
- **What remains:** Step 2 — a bounded ring buffer (e.g. last 20 runs) per
  pin and a sparkline surfaced in an existing webview (Dashboard or
  Planner's detail strip — do not add a third webview). Only worth building
  if the Step 1 hover delta proves insufficient in practice.

### 6.3 Git conflict command center

- **Source:** `PLAN_15_conflict_center.md`. Not started, speculative,
  moderate-to-high risk (destructive "accept & continue" macro + shared tree
  provider).
- **What it is:** a synthetic "Active Conflicts" group at the top of the
  Pins view during a merge/rebase/cherry-pick, populated from
  `git status --porcelain` conflict codes, with a confirm-gated "Accept
  current for all & continue" macro. Mirrors the existing recipe-group
  injection pattern in `pinStore.ts`.
- **Risk:** the destructive macro must be confirm-gated, operate only on
  conflicted files, and detect which git operation is in progress (refuse
  to guess when ambiguous).

### 6.4 Run rollback ("Revert Last Run")

- **Source:** `PLAN_23_run_rollback.md`. Not started, **high risk**
  (destructive git operations), moderate complexity.
- **What it is:** snapshot `git status --porcelain` before a macro/shell pin
  runs, diff after, and offer a context-menu "Revert Last Run" that does a
  surgical `git checkout`/`git clean` on only the files the run touched.
- **Risk:** the single most dangerous item carried forward. Must modal-confirm
  naming the exact file list, refuse if the repo state changed since the run
  (branch switch), and never touch a file outside the recorded footprint.
  Files outside the git working tree are out of scope.

### 6.5 Notes feature — Phase 2 (organization) and Phase 3 (cross-project)

- **Source:** `PLAN_NOTES_PHASE_2_3.md`. Notes Phase 1 (core MVP) shipped.
- **Phase 2 — Organization:** `.notes-index.json` for manual ordering/pinned
  status; pin-to-top toggle; drag-and-drop reorder; freeform tags with
  filter chips; sort modes (name/modified/manual).
- **Phase 3 — Cross-project and polish:** move note to Project/Global with
  collision handling; cross-project surfacing (`showCrossProject` setting,
  "Other Projects" tree root); text search/filter (same pattern as the
  Shortcuts filter); hover preview of a note's first lines; Launcher panel
  integration.
- **Open questions carried from Phase 1:** subfolder nesting (defer to
  Phase 3), note templates (defer), a soft warn-at-100-notes limit (no hard
  cap).
- **Known limitation:** multi-root workspaces only use the first folder's
  `.saropa/notes/` for project notes.

### 6.6 Suite daily report — week-over-week deltas

- **Source:** `PLAN_suite_report_deltas.md`. Not started. Depends on the
  shipped `ritual.suite` recipe and `buildDailyReport` — no sibling
  extension dependency.
- **What it is:** alongside today's counts, show the delta against the same
  weekday last week (`sessions 3 (▲ 1) · errors 2 (▼ 3)`), reading a new
  `formatVersion: 1` JSON sidecar written next to each dated report (not by
  parsing the rendered Markdown). Fallback chain: nearest sidecar within
  7-9 days back, else omit the delta line (never zero-fill a missing
  baseline).
- **Constraints:** all-local, no charts/color — the delta is a text suffix.
  No new cleanup subsystem for sidecar accumulation (reuse existing
  no-retention behavior).

### 6.7 Third pin scope — "userProject" (private per-project pins)

- **Source:** `PLAN_THIRD_SCOPE_USER_PROJECT.md`. Not started.
- **What it is:** a third storage tier — pins specific to a project but
  private to the user (not committed), stored in a new git-ignored
  `.vscode/saropa-workspace.local.json`. Verified: `PinScope` is currently
  the 2-value union the plan assumes (`shortcut.ts:5`).
- **The real work:** `PinScope` is consumed as a two-way ternary in ~37
  non-test call sites (~16 in the model/persistence layer). The core of this
  plan is replacing that binary ternary with scope-keyed dispatch
  (`pinsFor(scope)` / `groupsFor(scope)` / `persist(scope, ...)`) so the
  third tier is added in one place — do this before any view/command work.
- **OPEN DESIGN QUESTIONS — need user decision before implementation:**
  1. Scope enum value name (`"userProject"` recommended).
  2. Tree section placement — after Project (recommended) or after Global.
  3. Offer a one-time "add to .gitignore" toast on first user-project pin,
     or leave `.gitignore` management to the user entirely?

### 6.8 Watch for uncommitted files/folders

- **Source:** `PLAN_UNCOMMITTED_FILES_WATCH.md`. Not started, well-designed.
  A distinct engine from the shipped mtime-based folder watch — git
  committed-ness cannot be answered by an mtime diff.
- **What it is:** toast on startup and live when a watched folder/repo gains
  untracked/modified/staged files, and optionally an "all clear" toast when
  it goes clean. Honors `.gitignore` (ignored files never reported).
- **Design:** prefer the built-in `vscode.git` extension API
  (`repositories[].state.workingTreeChanges/indexChanges/untrackedChanges`,
  event-driven via `onDidChange`) with a `git status --porcelain=v1 -z`
  spawn fallback when the git extension is absent/disabled.
- **Pre-build checklist:** vendor and read the git extension's `git.d.ts`
  before writing code — confirm exact API v1 field names and that
  `untrackedChanges` excludes ignored files (do not code against
  remembered names).

### 6.9 Remote script execution (Remote-SSH/WSL/containers)

- **Source:** `remote-run.md`. Pin + open on remote/virtual filesystems is
  shipped; **running** the script on the remote host is not — `runner.ts`
  always executes locally via `cp.spawn`, ignoring the remote scheme.
- **What remains:** (1) detect the pin's host from its resolved URI scheme;
  (2) route remote-scoped pins through the integrated terminal only —
  background-channel and external-window run modes are inherently local and
  must be disabled with a named message for remote pins; (3) resolve
  cwd/`$workspaceRoot` from the pin's stored URI, not `fsPath`; (4) refuse
  (never silently run locally) when the current window isn't attached to
  the pin's target remote, naming the host.

### 6.10 Saropa Suite conductor — Pillars A and C

- **Source:** `TODO_better integration with saropa suite.md`. Pillar B
  (consolidated daily report) is shipped (`dailyReport.ts`, `ritual.suite`
  recipe). Pillars A and C remain.
- **Pillar A — Suite Control Center + Suite Modes:** a sidebar section (or
  hub QuickPick) listing each Suite tool's installed/enabled state with
  inline toggles (via each tool's public settings/commands — no sibling code
  edits). "Suite Modes" bundle settings/commands into one named switch
  (Debugging / Review / Quiet-Focus / Full power), current mode shown in the
  status bar. No sibling dependency — ships alone.
- **Pillar C — Orchestration moments:** after a script pin runs, if Log
  Capture captured the session, add an "Open log" action to the completion
  toast; let `bootSequence.ts` apply a project's preferred Suite Mode on
  workspace open (opt-in, off by default); the daily report command is
  already pinnable — emitting it on a cron via the scheduler is deferred,
  do not claim shipped until wired.
- **Constraints:** local-only/read-only data, no new webview, no new
  dependency (blast-radius gate); every toggle/mode switch names the tool
  and resulting state.

### 6.11 Scripts library — remaining migration + validation

- **Source:** `PLAN_integrate python scripts.md`. **Status corrected:** the
  Scripts view (steps 1-3: the `saropaWorkspace.scripts` view, the `Script`
  model, tag grouping/filtering, per-script config via the existing
  Configure Run panel, and the `requires`-tool preflight) is **already
  built** — verified via `extension/src/views/scriptsTreeProvider.ts`
  (registered in `package.json`) and `extension/scripts/library/library.json`
  (7 entries). The plan file previously said this was "not built"; that
  claim was stale.
- **What remains:**
  1. Migrate the remaining 19 of 26 catalogued scripts (see the full
     inventory that was in the now-deleted `PLAN_scripts_to_surface.md` —
     folded below) from `D:\src\contacts\scripts\` into
     `extension/scripts/library/`, following the established pattern
     (self-contained folder, `_shared` branding import, i18n keys, tags).
  2. `publish.py` validation step: parse `library.json`, assert every
     `entry` path exists and every `labelKey`/`descriptionKey` resolves in
     `en.json`; fail the package build if not.
  3. Verify interpreter-absence handling end-to-end for a script with no
     Python on PATH (the launcher-level check exists; confirm the Scripts
     view surfaces the same failure visibly rather than a silent non-zero
     exit).
- **Remaining script inventory (19 of 26, not yet migrated):**
  `build_runner_clean.py`, `build_runner_deep_clean.py`,
  `build_runner_watch.py`, `gradle_clean.py`, `detect_duplicate_classes.py`,
  `detect_duplicate_strings.py`, `detect_unused_methods.py`,
  `sort_dart_imports.py`, `flutter_test_all.py`,
  `fix_misused_test_matchers.py`, `code_line_count.py`,
  `codebase_analyzer.py`, `github_report.py`, `_changelog_pipeline.py`,
  `_features_pipeline.py`, `cluade_monitor.py`, `qwen_ollama_setup.py`,
  `disable_antivirus.py`, `emulator_debug_fix.py` — all under
  `D:\src\contacts\scripts\`. (Already migrated: `dart_process_clean.py`,
  `flutter_sdk_repair.py`, `run_test.py`, `daily_report.py`,
  `dependency_report.py`, `debug_connect.py`, `organize_reports.py`.)

---

## Work schedule

| Phase | Items | Status |
|-------|-------|--------|
| Phase 1 | 2 UX improvements | **Complete** (both shipped) |
| Phase 2 | 3 robustness items | 2 of 3 done; 2.1 (lazy activation) remains |
| Phase 3 | 5 code quality items | 3.1 partially done; 3.2–3.5 not started |
| Phase 4 | 7 doc updates | 4.1 partially done; 4.5 partially done; rest not started |
| Phase 5 | 6 wow items | 5.1 (drag-and-drop) done; rest not started |
| Phase 6 | 11 carried-forward feature plans | Not started; 6.7 blocked on user design decisions, 6.3/6.4 need explicit go-ahead given destructive-git risk |

---

## Appendix A: Audit scope

- **Source code:** 250+ TypeScript files across `model/`, `commands/`, `exec/`, `views/`, `import/`, `recipes/`, `i18n/`, `activation/`
- **Webviews:** Brief, Configure Run, Customize, Dashboard (3 tabs), Launcher (6 panes), Planner (3 views), Schedule Editor, Schedule Panel, Settings, Set Params
- **Documentation:** README, CHANGELOG, CHANGELOG_HISTORY, ROADMAP, CONTRIBUTING, SECURITY, PROFESSIONAL_SERVICES, CODE_OF_CONDUCT, BUG_REPORT_GUIDE, FINISH_GUIDE, 18 active plans, 10 competitor analyses, 2 guides, ~125 history files
- **Extension manifest:** package.json (103 commands, 37 settings, 6 views, 1 panel view), package.nls.json, en.json (1527 lines)

## Appendix B: Strengths (retain)

These patterns are working well and should be preserved as the codebase evolves:

- **Dispose discipline:** Every constructed engine, watcher, event listener, tree provider, and output channel is pushed to `context.subscriptions`. No leaked listeners found across 250+ files.
- **No-silent-async compliance:** Nearly every mutating command surfaces a named toast. The few intentional silent-swallow cases are explicitly commented.
- **CSP/nonce security:** Every webview panel uses `default-src 'none'` with a per-load nonce. Host-interpolated strings are escaped via `esc()`. Path-based actions are re-validated host-side.
- **Comment density:** WHY-focused comments on every module, every non-obvious decision, every bug fix. Matches the project's documentation mandate.
- **Defensive JSON parsing:** Every JSON parse site is try/catch-wrapped with graceful degradation (BUG-001 closed the last unguarded site).
- **Concurrency guards:** Refresh coalescing (`refreshRunning`/`refreshPending`), per-shortcut cooldown maps, re-entrancy flags, cross-process file locks — consistently applied across all async paths.
- **Single-source-of-truth discipline:** Settings descriptions sourced from `package.json`'s own schema, schedule model shared between QuickPick and webview editors, run-plan assembly shared between simulate and actual run.

## Appendix C: Competitor gap summary

| Feature | Favorites (kdcro101) | Project Manager | Saropa |
|---------|---------------------|-----------------|--------|
| Right-click → Add | 1 click | N/A | 3 clicks (submenu) — fix in 1.1 |
| Keyboard shortcut to add | Yes | Yes | No |
| Drag from Explorer to sidebar | Yes | N/A | No — fix in 5.1 |
| Sort alphabetically (toggle) | Yes | Yes | Via filter only |
| Search/filter shortcuts | No | Yes | Yes (strong) |
| Workspace switching | No | Yes (core) | Via shortcut sets (powerful but complex) |
| Color-coded icons | No | Yes | Yes (20 colors, strong) |
| Scheduling | No | No | Yes (unique advantage) |
| Run execution | No | No | Yes (unique advantage) |
| Recipes/auto-detection | No | No | Yes (unique advantage) |
| Watches/folder monitoring | No | No | Yes (unique advantage) |
| Notes/scratchpads | No | No | Yes (unique advantage) |

_This plan will be reviewed by a senior extension author. All effort estimates are conservative. Phases can be parallelized — Phase 4 (docs) should accompany each code phase to keep documentation in sync with changes._
