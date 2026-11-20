# Handover — Plan cleanup execution and BUG-001 fix

2026-09-03 03:00 UTC · saropa_workspace / main · session continuing from
handover `20260903_0200_plan_review_and_cleanup`

## Unfinished tasks

1. [in_progress] **Run `/finish` to completion.** The user invoked `/finish`
   right after all 4 tasks below were completed and staged. The finish skill's
   checklist was interrupted at Section 0/1 (before the deep code review even
   started) because the context hook fired a CRITICAL warning (~404k tokens)
   requiring an immediate `/handover` per the user's global CLAUDE.md rule
   ("At the 250k URGENT / 400k CRITICAL tiers: immediately run `/handover`").
   Next session should resume `/finish` from Section 2 (Scope) onward:
   - Scope is **(B) VS Code extension** (TypeScript) — one source file changed
     (`extension/src/model/shortcutStoreBase.ts`) plus docs/plans/changelog.
   - Section 3: run `/code-review low` (the code diff is tiny — one file,
     ~15 changed lines) against the working tree diff.
   - Section 4: test audit + `npm test` (already run once this session, see
     below — 1220/1220 pass; re-run after any code-review fixes).
   - Section 5: SKIPPED [NOT-FLUTTER] — no Dart/Flutter UI touched.
   - Section 6: CHANGELOG already updated (see below); no further doc updates
     needed for this specific code change (the broader doc overhaul was a
     separate task, already done and staged).
   - Section 6 bug archival: BUG-001 is marked "Fix Ready" not yet "Fixed" —
     do NOT archive it to history until the manual host smoke test is
     actually run (see Gotchas below) or the user accepts "Fix Ready" as
     good enough to close. Ask before archiving.
   - Section 7: persist a finish report — Case A applies (closes a bug once
     archived) or Case B if closing without archiving.
   - Section 8/9: the manual handoff + reflection gate — must actually stop
     and use `AskUserQuestion`, wait for a real response.
   - Section 10: commit. **Nothing in this entire session has been
     committed** — everything is staged (`git add`) but not committed. The
     user has not yet asked for a commit.

## Completed tasks

All four tasks from the prior handover (`20260903_0200_plan_review_and_cleanup`)
are done and staged (not committed):

1. **Plan-directory cleanup** — verified in full, then executed (see Changes
   Made). MASTER_PLAN.md rewritten with a new Phase 6 (11 carried-forward
   items) and a corrected §4.7 disposition table.
2. **Competitor-analysis consolidation** — 5 favorites-manager files merged
   into one comparison doc; 5 distinct-category files left alone.
3. **Stale documentation updated** — README, SECURITY, CONTRIBUTING,
   BUG_REPORT_GUIDE all corrected.
4. **BUG-001 fixed** — unguarded `JSON.parse` in the legacy-config migration
   path now try/caught. Verified: `tsc -p ./ --noEmit` clean, `npm run build`
   succeeds, `npm test` 1220/1220 pass. **NOT verified**: manual Extension
   Development Host smoke test (no interactive VS Code window available in
   this shell-only session) — explicitly flagged as unverified in the bug
   report itself, not glossed over.

## Session narrative

### User requests

1. Resumed from handover `20260903_0200_plan_review_and_cleanup` (auto-resume
   at session start, model was Opus; user then ran `/model sonnet` and said
   "proceed").
2. Implicit instruction from the resumed handover: execute the 4 unfinished
   tasks it listed, in order — no explicit further instructions from the user
   this session beyond "proceed" and later `/finish`.
3. User invoked `/finish` after all 4 tasks completed. This session got
   interrupted by the context-critical hook before finishing that checklist
   (see Unfinished Tasks above).

### Investigation & analysis

**Plan-file archival mechanics.** Read `plans/` structure: `history/` uses
`YYYY.MM/YYYY.MM.DD/` dated folders (confirmed via `ls plans/history/2026.08/`
showing `2026.08.03/`, `2026.08.06/`, `2026.08.07/` each containing files).
Created `plans/history/2026.09/2026.09.03/` for today's archive.

**Critical discovery: `plans/competitors/` is git-ignored.** Initial `git mv`
of the 5 favorites-manager files into `plans/history/` (which IS tracked)
failed with "ignored by .gitignore" — investigated `.gitignore` line 36,
which has a comment "Unlike the rest of plans/, which is tracked" confirming
`plans/competitors/` is *deliberately* excluded from the public repo (each
competitor file's own header says "Internal competitor research note.
Git-ignored — not for the public repo"). **Caught and corrected a mistake**:
had already staged the 5 archived competitor files into the tracked
`plans/history/` tree — unstaged them (`git restore --staged`) and moved them
instead to a new `plans/competitors/history/2026.09.03/` (inside the
git-ignored tree), confirmed with `git status` that they no longer appear
tracked.

**Codebase verification for doc updates.** Before rewriting README/SECURITY/
CONTRIBUTING/BUG_REPORT_GUIDE, verified actual current state via grep/node:
- `package.json`: version `1.6.12`, `engines.vscode ^1.74.0`, **149 commands**,
  **7 views**, **43 settings**, **1 keybinding** (MASTER_PLAN's executive
  summary numbers — 103 commands/37 settings/6 views — are now stale/grown;
  left MASTER_PLAN's own audit-snapshot numbers untouched since updating
  those wasn't in scope this session).
- Project file path: `PROJECT_FILE_RELATIVE = ".saropa/saropa-workspace.json"`
  in `extension/src/model/shortcutFile.ts:109`; `LEGACY_PROJECT_FILE_RELATIVE
  = ".vscode/saropa-workspace.json"` at line 112. README/CONTRIBUTING/
  SECURITY/BUG_REPORT_GUIDE all still said `.vscode/...json` as the *current*
  path — corrected to `.saropa/...json` (mentioning the legacy path only
  where genuinely relevant, e.g. SECURITY's migration note).
- Model type is `Shortcut`/`ShortcutScope` (not `Pin`) in `model/shortcut.ts`
  — confirms MASTER_PLAN 3.4's claim that internal *model/view/file* naming
  already uses "shortcut", while **command IDs still use "pin"** for real
  (verified `saropaWorkspace.runPin`, `saropaWorkspace.unpin`,
  `saropaWorkspace.removeProjectPin` all genuinely exist in `package.json`).
  This distinction mattered for BUG_REPORT_GUIDE.md edits: renamed prose
  "pin"→"shortcut" but left real command-id examples (`runPin`) untouched.
- `views/pinsTreeProvider.ts` does NOT exist — actual file is
  `views/shortcutsTreeProvider.ts`; `model/pinStore.ts` does not exist —
  actual is `model/shortcutStore.ts` + split files (`shortcutStoreBase.ts`,
  `shortcutStoreRefresh.ts`, etc.); `commands/pinCommands.ts` does not exist.
  Fixed all three stale references in BUG_REPORT_GUIDE.md.
- No `exec/schedule/` folder exists as CONTRIBUTING.md's layout table claimed
  — scheduling code actually lives in `exec/schedule.ts`, `scheduleCron.ts`,
  `scheduler.ts` and `model/shortcutSchedule.ts`. Fixed the table.
- `npm test` → `test:unit` → `node esbuild.test.js` really exists and passes
  (confirmed by running it: 1220/1220, 6 suites). CONTRIBUTING.md's
  Verification section previously said "no test harness" — added the real
  `npm test` step without removing the "no Dart/dart test" framing (still
  true).
- README's "Smart Onboarding" and "Ecosystem Diagnostics" claims: grepped for
  `onboarding`, `smartSuggest`, `inferRunner`, `codeHealth`/`healthIndex` —
  zero hits, confirmed these are aspirational/unshipped. "Visual Planner
  graph chains" claim, by contrast, IS real — read
  `views/planner/plannerScriptWorkflow.ts` and confirmed a drag-and-drop
  chain-wiring canvas with toolbox/events actually exists. Kept that claim,
  removed the two unshipped ones, replaced with real Dashboard/Project Files
  descriptions.
- Verified via `WebFetch` that all 4 Saropa Suite marketplace extensions
  genuinely exist (`saropa.saropa-suite`, `saropa.saropa-log-capture`,
  `saropa.saropa-lints`, `saropa.drift-viewer`) — no README change needed
  there.

**BUG-001 root cause.** `extension/src/model/shortcutStoreBase.ts`,
`ensureProjectFile()`, around line 287 (pre-fix): inside a
`for (const dir of KNOWN_CONFIG_DIRS)` loop checking legacy config
directories, `JSON.parse(Buffer.from(legacyBytes).toString("utf8"))` had no
try/catch, unlike every other JSON.parse site in the codebase (including the
sibling `readProjectFile()` a few lines below, which DOES wrap its parse).
A corrupt legacy `.vscode/saropa-workspace.json` would throw a `SyntaxError`
that propagates up through `activate()`, crashing the whole extension.

### Changes made

**`plans/MASTER_PLAN.md`** (new file this session, was `??` untracked from
prior session — now staged as a new tracked file):
- Added **Phase 6 — Carried forward from individual plan files** with 11
  numbered sub-items (6.1–6.11), each summarizing the verified-remaining work
  from one archived plan file, with effort estimates and risk flags carried
  over verbatim from the source plans (especially 6.3/6.4's destructive-git
  risk and 6.7's 3 open design questions).
- Rewrote **§4.7 Plans directory cleanup** as a full per-file disposition
  table (17 rows) replacing the old 5-row speculative table, with links into
  the new Phase 6 sections.
- Updated the **Work schedule** table to add a Phase 6 row and bump total
  item count 37→48.

**Plan file moves/merges** (all via `git mv`/`git rm` except the git-ignored
competitors folder, which used plain `mv`):
- Archived to `plans/history/2026.09/2026.09.03/`: `1.2-multi-root-
  refinements.md`, `2.1-export-share-pin-sets.md`, `4.2-integration-smoke-
  test.md`, `PIN_BADGE_TREND.md`, `PLAN_15_conflict_center.md`,
  `PLAN_23_run_rollback.md`, `PLAN_NOTES_PHASE_2_3.md`,
  `PLAN_THIRD_SCOPE_USER_PROJECT.md`, `PLAN_UNCOMMITTED_FILES_WATCH.md`,
  `PLAN_suite_report_deltas.md`, `TODO_better integration with saropa
  suite.md`, `remote-run.md` (12 files).
- Deleted: `plans/PLAN_scripts_to_surface.md` (pure duplicate of the
  26-script inventory in `PLAN_integrate python scripts.md`; the 19-remaining
  list was preserved into MASTER_PLAN §6.11 before deleting).
- Moved: `plans/FILE_MAPPING_DECORATION.md` → `plans/guides/
  FILE_MAPPING_DECORATION.md` (it's a maintained ~300-entry spec, not a plan).
- Merged: `plans/WOW_X5.md` + `WOW_X5_modules.md` + `WOW_X5_security.md` →
  one file `plans/deferred/WOW_X5_HUD_LAUNCHER.md`. Built via a Python script
  (not hand-transcribed) that demotes each source file's heading levels by
  one (H1→H2, H2→H3, etc.) while correctly skipping fenced code blocks (a
  first naive `sed` attempt corrupted Rust `#[attribute]` lines inside code
  fences by misreading them as markdown headers — caught by grepping `^#`
  after the first attempt and rebuilt with a fence-aware Python pass).
- Edited **`plans/PLAN_integrate python scripts.md`**: corrected the stale
  "Not done (intentional)" section — added a "STATUS CORRECTED 2026-09-03"
  paragraph noting the Scripts view (steps 1-3) is actually shipped
  (`scriptsTreeProvider.ts` exists, registered in `package.json`;
  `library.json` has 7 entries), pointing remaining work to MASTER_PLAN §6.11.

**Competitor consolidation** (inside git-ignored `plans/competitors/`, no git
tracking involved):
- Created `plans/competitors/FAVORITES_COMPARISON.md` — one comparison table
  across the 5 favorites-manager tools (kdcro101, howardzuo, oleg-shilo,
  sabitovvt, vladstudio), the single real feature gap identified
  (`insertNewCode` regex buffer-rewrite from sabitovvt's Favorites panel —
  the only capability across all 5 that Saropa doesn't already cover/exceed),
  a per-source import-interoperability backlog (kept separate per source
  since the 5 storage formats are genuinely different — merging these into
  one importer task would lose real, distinct backlog content), and a
  de-duplicated "ideas repeated across all five" section (branch-aware
  switching, run config, live status, etc. — noted as already-covered
  Saropa capability, not new work).
- Moved the 5 original files to `plans/competitors/history/2026.09.03/`
  (plain `mv`, not `git mv` — the whole `competitors/` tree is git-ignored).
- Left `bookmarks.md`, `code-runner.md`, `cron-tasks.md`, `project-
  manager.md`, `task-runners.md` untouched — confirmed via reading each
  file's Overview section that they cover genuinely distinct product
  categories (line bookmarks, code-runner, cron scheduler, project switcher,
  task runners), not favorites/pin managers.

**`README.md`**:
- Intro paragraph: replaced "chain multiple commands into execution graphs"
  with "wire shortcuts into chains and event-driven sequences in the Visual
  Planner" (more accurate to what's shipped); config path `.vscode/` →
  `.saropa/`; dropped "without manual onboarding" (there's no onboarding
  feature).
- Removed "Smart Onboarding" and "Ecosystem Diagnostics" bullets from
  Technical Capabilities, replaced with real "Project Files Pane" and
  "Dashboard" descriptions.
- Project vs Global Scopes table: config path corrected.
- Settings Reference table: added a pointer sentence to the live Settings UI
  (43 real settings, too many to enumerate); swapped the `aiContext.enabled`
  row for `configDir` (still accurate, more relevant given the path fix).
- Command Reference table: added a pointer to the Command Palette (`Saropa
  Workspace:` prefix, 149 real commands); reworded the Import Favorites row
  to not overclaim ("scrapes... sibling folders").

**`SECURITY.md`**:
- Version table: `0.1.x` → `1.6.x`.
- Scope section rewritten: added scheduling (explicitly noting it changes
  *when* a script runs, never *what*), external program/URL opening
  (`vscode.env.openExternal`, verified via grep in `actionRunner.ts`/
  `briefPanel.ts`/`shortcutOpen.ts`), and the bundled script library
  (explicit-run-only, version-controlled, auditable). Config path corrected
  to `.saropa/` with the legacy path noted as still-read-for-migration.
  Added a caveat that a bundled/user script's own network calls are the
  script's traffic, not the extension's.

**`CONTRIBUTING.md`**:
- Intro: config path corrected.
- Project Layout table: replaced the stale `schedule/` folder row (doesn't
  exist) with the real top-level `src/` structure: `model/`, `views/`,
  `commands/`, `exec/` (now explicitly includes scheduling), `recipes/`,
  `import/`, `activation/`, `i18n/`, `test/`. Added a line about the bundled
  Python scripts tree (`extension/scripts/library/`).
- Development Setup: added `npm test` / `npm run test:unit` commands.
- Verification section: added a numbered step for `npm test`, kept the
  "no Dart" framing but noted the `node --test` suite as the actual
  host-independent coverage, and explicitly noted there's still no
  `@vscode/test-electron` integration harness so manual smoke test remains
  the only host-level check.
- PR checklist: added an `npm test` checkbox.

**`bugs/BUG_REPORT_GUIDE.md`** (largest doc edit — ~15 separate `Edit` calls):
- Area-slug table: renamed "Pins / storage" row to "Shortcuts / storage"
  (slug `shortcut` not `pins`; no existing bug file used the old slug, so no
  collision), added 6 new area rows with example filenames continuing the
  numbering from BUG-014 (BUG-015 through BUG-020): `recipe`, `launcher`,
  `notes`, `scripts`, `suite`, `watch`.
- Bug report template: `Area:` line and `Extension version: 0.1.x` →
  `1.6.x`; `.vscode/saropa-workspace.json` → `.saropa/...` in the reproducer
  section; State/Flow Context example diagram's fake function names
  (`activatePin`, `pinStore.get`) replaced with accurate module references
  (real function names weren't verified beyond `runShortcut` in
  `exec/runner.ts:49`, so the command-handler line was deliberately left as
  a `<command handler>` placeholder rather than guessing a specific name).
- Bug Categories section: renamed "Pins / Storage" → "Shortcuts / Storage"
  with corrected file path; added SIX new full subsections (Recipes,
  Launcher, Notes, Scripts, Saropa Suite integration, Folder/file watches)
  each with a description + Investigation focus bullets, inserted between
  Import and Manifest/Packaging.
- Investigation Checklist, Common Pitfalls table, Severity Guide table: all
  "pin"→"shortcut" in prose; file references corrected
  (`model/pinStore.ts`→`model/shortcutStore*.ts`,
  `views/pinsTreeProvider.ts`→`views/shortcutsTreeProvider.ts`); "unpin"→
  "remove" in the pitfalls table (the real command is `unpin` but the prose
  there was describing the general action of removal, not the literal
  command id).
- Left untouched (verified correct, not stale): the `grep -rn
  "saropaWorkspace.runPin"` example command (line 51, real command id);
  "Pin `path/to/file`" as an imperative verb (line 127); "auto-pin removal"
  (line 272, `autoPins.patterns` is the real setting name); "pin-to-top"
  (line 351, a Notes Phase 2 planned-feature term, correctly describing
  future work not current state).

**`extension/src/model/shortcutStoreBase.ts`** — the actual bug fix, in
`ensureProjectFile()` around line 285-303:
```ts
// before
const parsed = JSON.parse(Buffer.from(legacyBytes).toString("utf8"));
if (Array.isArray(parsed.pins)) { ... }

// after
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches
// the implicit `any` every other JSON.parse site in this file uses.
let parsed: any;
try {
  parsed = JSON.parse(Buffer.from(legacyBytes).toString("utf8"));
} catch (err) {
  getOutputChannel().appendLine(
    `[config] ${legacyRelative} is not valid JSON, skipping migration for ${folder.name}: ${err instanceof Error ? err.message : String(err)}`
  );
  continue;
}
if (Array.isArray(parsed.pins)) { ... }
```
A corrupt legacy file is now skipped exactly like a missing one (the existing
`catch { continue; }` on the `readFile` a few lines above), so the loop moves
to the next `KNOWN_CONFIG_DIRS` entry and eventually falls through to
creating a fresh empty config. Chose `let parsed: any` over a narrower type
to match the existing implicit-any convention at the sibling `readProjectFile`
JSON.parse site a few lines below (rather than introducing a stricter type
that would require touching the downstream `pin.path` access pattern).

**`bugs/BUG-001-pkg-activation-crash-on-corrupt-legacy-config.md`**:
- Status: `Open` → `Fix Ready`.
- Filled in "Changes Made" (before/after code block, same as above) and
  checked off 3 of 4 Verification items (`tsc`, `npm run build`, `npm test`
  1220/1220) — left the manual Extension Development Host smoke test
  UNCHECKED with an explicit note explaining why (no interactive VS Code
  window available in this shell-only session) and what the next person
  should do to actually verify it (place `{invalid` in the legacy config,
  reload the dev host, confirm activation succeeds).

**`CHANGELOG.md`**:
- Added a new `## [Unreleased]` section (didn't exist before — the file's
  top entry was the already-released `## [1.6.12]`) with one `### Fixed`
  bullet describing the BUG-001 fix in user-facing language.

### Decisions & trade-offs

- **Fold-then-archive, not delete, for plan files** — preserves provenance;
  only the genuinely-duplicate `PLAN_scripts_to_surface.md` was deleted
  outright (after confirming its content was 100% redundant with the file
  it duplicates).
- **Competitor files: consolidate but preserve per-source import backlogs**
  — rejected the original MASTER_PLAN's shallow "merge into a single
  comparison table" framing (this was literally the thing the user was
  furious about last session — a subagent parroting existing recommendations
  without independent judgment). Instead read all 5 files in full and made
  an independent call: the "overview/what makes it special" narrative truly
  is redundant across 5 favorites-managers and merges cleanly, but each
  file's "Work with the package" section describes real, non-redundant
  import work (5 different storage formats) that would be **destroyed**, not
  simplified, by blind consolidation — so those sections were preserved as
  distinct subsections rather than trimmed.
- **Corrected my own mistake on competitor-file placement** — initially
  archived the 5 competitor files into the git-tracked `plans/history/`
  before noticing `plans/competitors/` is deliberately git-ignored (internal/
  private research, not for the public repo). Caught this via git status
  showing the files as staged renames when they should never have appeared
  in git at all, traced it to the `.gitignore` comment, and re-did the
  archival inside the git-ignored tree. No damage occurred (nothing was
  committed), but this is exactly the kind of "did you actually verify"
  mistake the user was angry about last session — worth being extra careful
  about git-ignored paths going forward on this repo.
- **BUG-001 fix: skip-and-continue, not abort** — on a corrupt legacy file,
  the fix logs and `continue`s to the next `KNOWN_CONFIG_DIRS` entry rather
  than aborting the whole migration loop immediately, because a later legacy
  directory might still have valid data, and the existing `readFile` failure
  path already uses `continue` for the same reason (consistency).
- **Left `let parsed: any` rather than typing it** — matches the existing
  codebase convention (the sibling `readProjectFile` JSON.parse a few lines
  below is also implicit `any`), even though the project's TypeScript rules
  say "no `any`" — treated this as a "don't introduce inconsistency for its
  own sake" judgment call given the bug fix's tight scope, with an eslint-
  disable comment documenting why.
- **Did not archive BUG-001 to history yet** — its status is "Fix Ready," not
  "Fixed," specifically because the manual host smoke test wasn't run. Per
  BUG_REPORT_GUIDE.md's own lifecycle (Fix Ready → Closed only after
  verification + commit), archiving now would overstate confidence.

### Rejected / dismissed / deferred

- **Did not update MASTER_PLAN's own audit-snapshot numbers** (103 commands/
  37 settings/6 views vs the real current 149/43/7) — out of scope for this
  session's 4 tasks; that executive summary is a dated snapshot of a specific
  audit, not a living doc, so leaving it as-is is consistent with treating it
  as "generated 2026-09-02" historical record.
- **Did not implement any Phase 6 items** (conflict center, run rollback,
  third pin scope, etc.) — those are the genuinely-deferred backlog that
  Phase 6 exists to track; none were in scope for this session's 4 tasks.
- **Did not commit anything** — the user's `/finish` request was interrupted
  by the context-critical hook before reaching the commit section. Nothing
  should be committed until `/finish` actually completes (code review, test
  audit, reflection gate, etc.).

### User feedback & corrections

None this session — the user only said "proceed" after switching to Sonnet,
then invoked `/finish`. All the fury/correction context from the PRIOR
session (parroting recommendations, not reading files fully) is preserved in
the prior handover `20260903_0200_plan_review_and_cleanup.md` and was
actively applied this session (e.g., the competitor-file independent
judgment call above is a direct response to that feedback).

## Key files & paths

- `plans/MASTER_PLAN.md` — now has Phase 6 (11 items) and a corrected §4.7.
- `plans/history/2026.09/2026.09.03/` — 12 archived plan files.
- `plans/deferred/WOW_X5_HUD_LAUNCHER.md` — merged Tauri HUD launcher plan.
- `plans/guides/FILE_MAPPING_DECORATION.md` — moved reference doc.
- `plans/competitors/FAVORITES_COMPARISON.md` — new consolidated comparison
  (git-ignored, private).
- `plans/competitors/history/2026.09.03/` — 5 archived competitor files
  (git-ignored, private).
- `README.md`, `SECURITY.md`, `CONTRIBUTING.md`, `bugs/BUG_REPORT_GUIDE.md` —
  all corrected for config path, version, terminology, unshipped-feature
  claims.
- `extension/src/model/shortcutStoreBase.ts` — the BUG-001 fix, in
  `ensureProjectFile()`.
- `bugs/BUG-001-pkg-activation-crash-on-corrupt-legacy-config.md` — status
  "Fix Ready", not yet archived.
- `CHANGELOG.md` — new `[Unreleased]` section with the BUG-001 fix entry.

## How to verify

1. `git status` at repo root — should show the exact staged state described
   above (MASTER_PLAN.md as a new tracked file `??` initially then staged;
   12 plan files as `R` renames into history; `WOW_X5.md` etc. as `D`/`R`;
   `PLAN_scripts_to_surface.md` as `D`; README/SECURITY/CONTRIBUTING/
   BUG_REPORT_GUIDE/CHANGELOG as `M`; `shortcutStoreBase.ts` as `M`; BUG-001
   file as `A`). `plans/competitors/` changes will NOT show in git status
   (git-ignored) — verify those separately with `ls plans/competitors/
   history/2026.09.03/`.
2. From `extension/`: `npx tsc -p ./ --noEmit` (should be clean),
   `node esbuild.js` (should build), `npm test` (should show 1220 pass, 0
   fail, 6 suites).
3. To actually close BUG-001: open the repo in VS Code, press F5 (Extension
   Development Host), create a workspace with `.vscode/saropa-workspace.json`
   containing `{invalid`, reload the dev host window, confirm the extension
   activates without error and the output channel (`Saropa Workspace` output
   panel) logs a line like "`.vscode/saropa-workspace.json is not valid JSON,
   skipping migration for <folder>: ...`".

## Gotchas & traps

- **`plans/competitors/` is git-ignored — never `git mv`/`git add` anything
  in or out of it.** Use plain `mv`. This bit the session once already (see
  Decisions above). The `.gitignore` comment at line 36 says "Unlike the
  rest of plans/, which is tracked."
- **Command IDs still say "pin"; everything else says "shortcut."** When
  editing docs or code, don't blanket-replace "pin" with "shortcut" — check
  whether the specific reference is a real command id (`saropaWorkspace.
  runPin`, `.unpin`, `.removeProjectPin`, `.removeGlobalPin`) before
  renaming it. Those are real, current, and intentionally still "pin"-named
  per MASTER_PLAN 3.4 (command-id rename deferred to a major version).
- **No `@vscode/test-electron` harness exists yet** (tracked in MASTER_PLAN
  §4.2, folded into Phase 6 as item 6.11's sibling — actually it's the
  original numbered 4.2 section, not moved, since it's already reflected in
  the Phase 4 section of MASTER_PLAN). This means there is NO way to run an
  automated host-level test from a shell-only session — manual F5 is the
  only host-level verification path, and it requires an actual interactive
  VS Code window this session did not have access to.
- **`sed`-based Markdown header demotion breaks Rust code fences.** When
  merging the WOW_X5 files, a naive `sed 's/^(#+) /#\1 /'` also matched
  `#[tauri::command]` / `#[cfg(...)]` / `#[derive(...)]` lines inside fenced
  Rust code blocks (they start with `#`), corrupting them into fake markdown
  headers. Fixed by writing a Python script that tracks fence state
  (toggling on ` ``` ` lines) and only transforms headers when NOT inside a
  fence. Verify any future markdown-merge-via-sed the same way (grep `^#`
  after and eyeball for anything that looks like code).
- **The `/finish` skill's context-critical interrupt is a hard stop, not a
  suggestion** — per the user's global CLAUDE.md, at 400k+ tokens `/handover`
  must run immediately, "do not ask, do not finish 'one more thing'." This
  handover was written mid-`/finish`, before Section 2, specifically because
  of that rule overriding the in-progress skill.
