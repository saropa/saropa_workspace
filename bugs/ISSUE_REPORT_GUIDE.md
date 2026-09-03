# Issue Report Guide

How to file, investigate, and close bugs and feature requests in `saropa_workspace`.

This is the issue process for the Saropa Workspace VS Code extension (TypeScript). File concrete issues as separate files under `bugs/` using the naming and template below — not only in chat or a downstream issue tracker.

**Feature requests are in scope.** New command proposals, UX improvements, configuration ideas, integration enhancements, and tooling changes belong here under `bugs/` using the naming rules below and the [feature request template](#feature-request-template).

---

## File Naming

| Type | Pattern | Example |
|------|---------|---------|
| Shortcut / storage bug | `shortcut_description.md` | `shortcut_global_not_synced.md` |
| Execution bug | `exec_description.md` | `exec_cwd_ignored_on_windows.md` |
| Scheduling bug | `schedule_description.md` | `schedule_run_fires_twice.md` |
| Tree view / UX bug | `view_description.md` | `view_stale_after_rename.md` |
| Import bug | `import_description.md` | `import_favorites_json_skips_args.md` |
| Manifest / packaging bug | `pkg_description.md` | `pkg_command_missing_from_palette.md` |
| Documentation bug | `docs_description.md` | `docs_wrong_settings_key.md` |
| Recipes bug | `recipe_description.md` | `recipe_detection_misses_monorepo.md` |
| Launcher bug | `launcher_description.md` | `launcher_panel_blank_on_open.md` |
| Notes bug | `notes_description.md` | `notes_index_corrupts_on_rename.md` |
| Scripts (bundled library) bug | `scripts_description.md` | `scripts_manifest_entry_missing.md` |
| Saropa Suite integration bug | `suite_description.md` | `suite_daily_report_omits_section.md` |
| Folder / file watch bug | `watch_description.md` | `watch_fires_on_ignored_path.md` |
| New command / feature proposal | `proposal_description.md` | `proposal_pin_drag_reorder.md` |
| UX improvement proposal | `proposal_ux_description.md` | `proposal_ux_tree_inline_rename.md` |
| Configuration proposal | `proposal_config_description.md` | `proposal_config_per_workspace_defaults.md` |
| Tooling / infra request | `proposal_infra_description.md` | `proposal_infra_ci_vsix_size_check.md` |

Use lowercase with underscores. Check existing files before creating.

---

## Confirm Attribution Before Filing

**Before filing a bug here, confirm the issue is in `saropa_workspace` and not in VS Code itself, another extension, or the user's own pinned script.** A failure observed in the editor is not automatically this extension's fault. Filing without attribution evidence forces the first fix agent to waste a round-trip discovering the bug lives elsewhere — or worse, the agent guesses and ships a half-fix in the wrong repo.

### Positive attribution (required)

For every command, setting, or symbol mentioned in the report, paste the result of:

```bash
grep -rn "saropaWorkspace.<command>" extension/src/ extension/package.json
```

Expected: a handler registered in `extension/src/` and a declaration in `extension/package.json`. **Zero matches means the command/setting is not ours** — do not file here.

### Negative attribution (required when multiple sources may overlap)

If the behavior could originate in a sibling extension (Saropa Drift Advisor, Saropa Lints, etc.), also grep the suspected sibling repos to confirm the command/setting is NOT defined there:

```bash
grep -rn "saropaWorkspace.<command>" ../saropa_drift_advisor/extension/src/
```

Paste the zero-match result. If you get a match, file the bug in that repo instead.

### Script attribution (required for execution bugs)

If a pinned script fails or misbehaves when run, confirm the failure is in how the extension *invokes* it (wrong cwd, missing args, dropped env, wrong command prefix), not in the script itself. Paste the resolved command line the extension built and the exact failure.

### Host attribution

Tree-view quirks, Settings Sync timing, and terminal behavior can originate in VS Code itself. Note the VS Code version and whether the behavior persists with no other extensions enabled.

### Why this section exists

We have had bugs misattributed in both directions — extension bugs filed against VS Code, and VS Code or script behavior filed against the extension. In every case, the fix agent saw a symptom, assumed a source, and either punted the work as "somebody else's" or shipped a fix in the wrong tree. The only defense is grep evidence pasted directly in the report.

---

## Bug Report Template

Copy the block below into a new file.

````markdown
# BUG: Short, Specific Title

**Status: Open**

<!-- Status values: Open → Investigating → Fix Ready → Closed -->

Created: YYYY-MM-DD
Area: Shortcuts / Execution / Scheduling / Tree View / Import / Packaging / Docs / Recipes / Launcher / Notes / Scripts / Suite / Watches
File(s): `extension/src/...` (line ~NNN)
Severity: Crash / Wrong behavior / Data loss / UX / Performance / Cosmetic
Extension version: 1.x.x

---

## Summary

One or two sentences: what happens, what should happen instead.

---

## Attribution Evidence

Proof this lives in `saropa_workspace`. If the grep is empty, the bug does not belong in this repo — do not file here. See "Confirm Attribution Before Filing" in the guide.

```bash
# Positive — command / setting / symbol IS declared and handled here
grep -rn "saropaWorkspace.<command>" extension/src/ extension/package.json
# Expected: a handler in extension/src/ and a declaration in package.json
```

**Handler:** `extension/src/<folder>/<file>.ts:NN`
**Manifest declaration:** `extension/package.json` (`contributes.commands` / `configuration`)
**Resolved command line (for execution bugs):** `<prefix> <args>` (cwd: `...`, env: `...`)
**VS Code version / OS:** `...`

---

## Reproducer

The smallest set of steps that triggers the bug. This is the single most important section.

1. Pin `path/to/file` (project / global scope) with these run params: ...
2. ...
3. Observe: ...

If a specific shortcut definition is needed, paste the relevant `.vscode/saropa-workspace.json` entry (or the imported `.favorites.json` fragment).

**Frequency:** Always / Only with specific shortcuts / Intermittent / Platform-specific

---

## Expected vs Actual

| | Behavior |
|---|---|
| **Expected** | ... |
| **Actual** | ... |

---

## State / Flow Context

<!-- Where in the flow the bug occurs: command handler → store → view, or
     command → runner → terminal. Name the functions involved. -->

```
<command handler> (commands/shortcut*.ts)
  └─ shortcutStore.get (model/shortcutStore.ts)
      └─ runShortcut (exec/runner.ts)   ← failure here
```

---

## Root Cause

<!-- Fill in during investigation. Explain the mechanism: which condition or
     branch evaluates wrong, and why. Reference specific files and lines. -->

### Hypothesis A: ...

Explain the theory and what to check.

### Hypothesis B: ...

---

## Suggested Fix

<!-- Describe the code change. Reference file and line numbers. -->

---

## Changes Made

<!-- Fill in when a fix is written. -->

### File 1: `extension/src/<folder>/<file>.ts` (line NN)

**Before:**
```ts
old code
```

**After:**
```ts
new code
```

---

## Verification

<!-- How the fix was confirmed. No dart commands — this is a TS extension. -->

- [ ] `tsc -p ./ --noEmit` clean
- [ ] `npm run build` succeeds
- [ ] Manual smoke test in the Extension Development Host reproduces the
      original steps and now behaves correctly

---

## Commits

<!-- Add commit hashes as fixes land. -->
- `abcdef0` fix: description

---

## Environment

- saropa_workspace version:
- VS Code version:
- OS:
- Shortcut scope (project / global):
- Settings Sync enabled (yes / no):
````

---

## Feature Request Template

Copy the block below into a new file.

````markdown
# PROPOSAL: Short, Specific Title

**Status: Open**

<!-- Status values: Open → Accepted → In Progress → Closed -->
<!-- Use "Declined" if rejected, with rationale in the Decision section -->

Created: YYYY-MM-DD
Type: New command / UX improvement / Configuration / Tooling / Infrastructure
Related area: Shortcuts / Execution / Scheduling / Tree View / Import / Recipes / Launcher / Notes / Scripts / Suite / Watches

---

## Summary

One or two sentences: what the feature does and why it matters.

---

## Motivation

Why this feature is needed. Include concrete examples from real workflows where this would have saved time, prevented mistakes, or improved the user experience. Link to VS Code API docs or extension guidelines if applicable.

---

## Behavior

<!-- For new commands: describe what the command does and where it appears -->
<!-- For UX improvements: describe the interaction before and after -->
<!-- For configuration: describe the setting, its type, and its default -->

### Current behavior

Describe what happens today (or "not available").

### Proposed behavior

Describe what should happen after the feature ships.

---

## Edge Cases

<!-- Patterns that need special handling or explicit decisions -->

1. **Case description** — expected behavior / needs discussion
2. ...

---

## Alternatives Considered

<!-- Other approaches and why this one is preferred -->

---

## Decision

<!-- Fill in when the proposal is accepted or declined -->

---

## Implementation Notes

<!-- Fill in when work begins. Reference files, existing utilities, related commands -->

---

## Commits

<!-- Add commit hashes as implementation lands -->
- `abcdef0` feat: description
````

---

## What Makes a Good Bug Report

### Title

- Be specific: "global shortcut not synced to second machine" beats "shortcuts broken".
- Name the area so the file slug and the title agree.
- Classify the bug type when useful: "crash", "data loss", "wrong cwd".

### Reproducer

- Smallest possible steps — strip everything unrelated.
- Include the exact shortcut definition (run params, scope) when the bug depends on it.
- For execution bugs, paste the resolved command line the extension built, the working directory, and any env overrides.
- For platform-specific bugs, name the OS and shell.

### State / Flow Context

- Trace the path: command handler → store → view, or command → runner → terminal/output channel.
- Name the function where the behavior diverges from expected.

### Root Cause

- Explain the mechanism: which branch evaluates wrong, and why.
- Reference specific file and line numbers in `extension/src/`.

---

## Bug Categories

### Shortcuts / Storage

Shortcut data is wrong, lost, not persisted, or not synced.

**Investigation focus:**

- Is the shortcut written to the right place — project file (`.vscode/saropa-workspace.json`) for project shortcuts, `globalState` for global shortcuts?
- Are workspace-relative paths resolved correctly across machines and platforms?
- For sync issues: is the value stored in `globalState` with sync enabled, and does VS Code Settings Sync actually carry it?
- Does an auto-pinned shortcut's removal persist, and does restore bring it back?

### Execution

A pinned script does not run, runs wrong, or runs in the wrong place.

**Investigation focus:**

- Is the resolved command correct — command prefix + args, in the right cwd, with the right env?
- Integrated terminal vs background output channel: does the configured path get taken?
- Quoting and path handling on Windows vs POSIX shells.
- Is the failure in how we invoke the script, or in the script itself? (The latter is not our bug — see attribution.)

### Scheduling

A scheduled run does not fire, fires at the wrong time, or fires more than once.

**Investigation focus:**

- Timer setup and teardown — are duplicate timers created on reload or config change?
- What happens across window reload, sleep/wake, and workspace switch?

### Tree View / UX

The activity-bar view shows stale, missing, or wrong items, or feedback is absent after an action.

**Investigation focus:**

- Is the provider refreshed after every state change?
- Are Project Shortcuts and Global Shortcuts grouped and ordered correctly?
- Does single-click open and double-click run as configured (`doubleClickMs`)?
- Is there visible feedback after a run, rename, or remove?

### Import

Importing `.favorites.json` (or another supported favorites-manager format) drops, mangles, or mis-maps shortcuts.

**Investigation focus:**

- Are all fields mapped — path, label, run params (prefix, args, cwd, env)?
- How are conflicts with existing shortcuts handled?
- Is malformed input rejected with a clear message rather than crashing?

### Recipes

An auto-detected macro (formatting, lint, git-remote/PR link, dependency install) is missing, mislabeled, or runs the wrong command for the project.

**Investigation focus:**

- Does the manifest/`.git/config` detection in `recipes/` correctly identify the project's toolchain (npm vs pnpm vs yarn, Flutter vs plain Dart, etc.)?
- Is a recipe's hidden/promoted/toggled-off state (`Promote to Shortcut`, domain toggle) persisted and respected on refresh?
- Does `saropaWorkspace.recipes.enabled` gate detection correctly?

### Launcher

The bottom-panel Launcher webview is blank, stale, missing an item, or an action inside it does not reach the right shortcut/script/note.

**Investigation focus:**

- Does the webview's posted message reach the extension host handler, and does the response round-trip back to the webview?
- Is the CSP/nonce set up correctly for the panel (`launcherAssets.ts` / `launcherView.ts`)?
- Are search/filter and collapsible-section state preserved across a refresh?

### Notes

A note is not created, not found, or its content/index (pin-to-top, tags, sort order) is wrong.

**Investigation focus:**

- Is the note file written under the correct project/global `notes/` location (`model/noteStore.ts`)?
- Does the index survive a rename, move, or external edit of the note file?

### Scripts (bundled library)

A bundled script in the Scripts view fails to appear, run, or resolve its config/tags correctly.

**Investigation focus:**

- Does the script's `entry` in `extension/scripts/library/library.json` resolve to an existing file under `context.extensionPath`?
- Are user overrides (tags, config) correctly keyed by `library:<id>` so they survive an extension version update (never by absolute path)?
- Does a missing interpreter or a missing `requires` tool produce a visible, named error rather than a silent failure?

### Saropa Suite Integration

The Suite daily report or another cross-tool surface is missing a section, shows stale data, or fails to detect a sibling extension.

**Investigation focus:**

- Is the sibling extension detected via `vscode.extensions.getExtension(id)` correctly, including the absent-tool fallback (dimmed row / omitted section, never an error)?
- Does the sibling's exported `getDailySummary` API respond within the documented timeout, and does a missing/older API degrade to an omitted section?

### Folder / File Watches

A folder watch does not fire, fires on an ignored path, or misses a change that occurred while the window was closed.

**Investigation focus:**

- Does the watch respect `.gitignore` (for a git-aware watch) or the configured glob (for the mtime-based folder watch)?
- Is the baseline correctly diffed on startup so changes made while the window was closed are caught?
- Is the watcher disposed and re-created (not leaked) when its target changes?

### Manifest / Packaging

A command, menu, view, or setting is missing, mislabeled, or wrongly gated.

**Investigation focus:**

- Is the command declared in `package.json` and registered in `extension/src/extension.ts`?
- Does the `when` clause / `viewItem` match what the code sets as `contextValue`?
- Are display strings resolved via `%key%` (`package.nls.json`) rather than showing the raw key?
- Does the production `npm run package` bundle include everything the VSIX needs?

### Documentation

A doc, setting description, or README statement is wrong or out of date.

**Investigation focus:**

- Does the documented settings key / command id match `package.json`?
- Does the described behavior match the current code?

---

## Feature Request Categories

### New Command / Feature Proposal

A command, view contribution, or capability that does not exist yet.

**How to report:** Create `bugs/proposal_description.md`, copy the [Feature Request Template](#feature-request-template), and complete **Behavior** (current vs proposed) plus **Motivation**.

**Evaluation criteria:**

- Does the feature solve a real workflow pain point?
- Is there prior art in other VS Code extensions or file-manager tools?
- Does it overlap with an existing command? Check `package.json` contributes and `ROADMAP.md`
- Is the VS Code API surface available for the desired interaction?

### UX Improvement

An improvement to an existing surface — tree view, quick pick, feedback, or layout.

**How to report:** Create `bugs/proposal_ux_description.md` and describe the current UX, the proposed UX, and why the change matters.

**Evaluation criteria:**

- Does the change follow the [style guide](plans/guides/STYLEGUIDE.md)?
- Is it consistent with existing surfaces in the extension?
- Does it require new i18n keys (it should, if user-facing)?

### Configuration Proposal

A new setting, or a change to an existing setting's type, default, or scope.

**How to report:** Create `bugs/proposal_config_description.md` and describe the setting key, type, default, scope (user / workspace), and motivation.

### Tooling / Infrastructure Request

Improvements to the build pipeline, publish script, test harness, or CI.

**How to report:** Create `bugs/proposal_infra_description.md` and describe the current behavior, desired behavior, and motivation.

---

## Investigation Checklist

Use this when diagnosing a new bug.

- [ ] **Positive attribution grep** — `grep -rn "saropaWorkspace.<command>" extension/src/ extension/package.json` returns at least one match, pasted in the report. Zero matches = do not file here
- [ ] **Script attribution** — for execution bugs, confirmed the failure is in how the extension invokes the script, not in the script itself (resolved command line pasted)
- [ ] **Host attribution** — confirmed the behavior is not stock VS Code (version noted, tested with other extensions disabled if ambiguous)
- [ ] **Reproduce it** — minimal steps, with the exact shortcut definition
- [ ] **Read the handler** — find the command handler in `extension/src/commands/` and trace the flow
- [ ] **Check the store** — `model/shortcutStore*.ts`: where is the shortcut read/written (project file vs `globalState`)?
- [ ] **Check execution** — `exec/runner.ts`: what command line is built, in what cwd, with what env, on what surface (terminal vs output channel)?
- [ ] **Check the view** — `views/shortcutsTreeProvider.ts`: is refresh called after the change?
- [ ] **Check the manifest** — `package.json` command/menu/setting matches the code (ids, `when`, `contextValue`)
- [ ] **Check platform** — does it reproduce on Windows and POSIX?
- [ ] **Compile + build** — `tsc -p ./ --noEmit` clean and `npm run build` succeeds

---

## Common Pitfalls

These patterns have caused bugs before. Check for them during investigation.

| Pitfall | Why It Breaks | Correct Pattern |
|---------|---------------|-----------------|
| Blaming the extension for a pinned script's own failure | The script exits non-zero on its own logic; we ran it correctly | Confirm the resolved command line is right; if so, it is not our bug |
| Filing here without positive grep | Wastes a fix agent's round-trip when the command actually lives in a sibling extension | `grep -rn "saropaWorkspace.<cmd>" extension/src/ extension/package.json` must return at least one match before filing |
| Storing a global shortcut without sync semantics | Value lives only on one machine | Use `globalState` so Settings Sync can carry it |
| Absolute paths in the project shortcut file | Breaks on another machine / OS | Store workspace-relative paths in `.vscode/saropa-workspace.json` |
| Tree not refreshed after a state change | View shows stale labels/items | Fire the provider's change event after every mutation |
| Command id / setting key drift | `package.json` and code disagree; command silently does nothing | Treat `package.json` as the source of truth; match ids exactly |
| Hardcoded user-facing string | Ships English in every locale, shows raw key if mis-wired | `%key%` in `package.nls.json`, or `l10n()` from `locales/en.json` |
| Naive quoting of args/paths | Spaces and special chars break the run, especially on Windows | Build args as an array / quote per platform |
| `contextValue` / `when` mismatch | Menu item appears on wrong items or never | Align the `viewItem` regex with the `contextValue` set in code |
| Duplicate schedule timers on reload | Same run fires twice | Dispose existing timers before re-creating them |
| Silent action with no feedback | Run/rename/remove looks like nothing happened | Surface a visible outcome (message, view update) |

---

## Fix Requirements

Every bug fix must satisfy these before it can be closed.

### Code

- [ ] Fix addresses the **root cause**, not just the symptom.
- [ ] Fix includes a comment explaining what was wrong and why the new code is correct.
- [ ] No new hardcoded user-facing strings (use `package.nls.json` / `l10n()`).
- [ ] American English throughout.

### Verification

- [ ] `tsc -p ./ --noEmit` — no errors.
- [ ] `npm run build` — succeeds.
- [ ] Manual smoke test in the Extension Development Host reproduces the original steps and confirms the fix.

### Documentation

- [ ] `CHANGELOG.md` (root) updated under `[Unreleased]` → `### Fixed` for any user-visible change.
- [ ] `extension/CHANGELOG.md` left untouched — it is a generated copy of the root changelog (rewritten at package time); editing the root suffices.
- [ ] Issue report file updated with root cause, changes, and commit hashes.
- [ ] Status updated to `Closed`.

---

## Lifecycle

### Bugs

```
Open
  │
  ▼
Investigating       ← actively diagnosing, root cause section being filled in
  │
  ▼
Fix Ready           ← code written, verified, awaiting commit
  │
  ▼
Closed              ← merged, verified, file moved to history
```

### Feature Requests

```
Open
  │
  ├──► Declined     ← rejected with rationale, file moved to history
  │
  ▼
Accepted            ← approved, scope decided
  │
  ▼
In Progress         ← implementation underway
  │
  ▼
Closed              ← merged, verified, file moved to history
```

### Moving to History

When an issue is closed (or a proposal is declined), move its file into the shared history tree:

```
bugs/shortcut_global_not_synced.md
  → plans/history/YYYY.MM/YYYY.MM.DD/shortcut_global_not_synced.md

bugs/proposal_pin_drag_reorder.md
  → plans/history/YYYY.MM/YYYY.MM.DD/proposal_pin_drag_reorder.md
```

Use the date the issue was closed. Create the `YYYY.MM/YYYY.MM.DD` folders if they do not exist. Grep and repoint any `bugs/<file>.md` references (CHANGELOG, ROADMAP, other issue files) to the new path in the same commit.

---

## Severity Guide

| Severity | Meaning | Examples |
|----------|---------|---------|
| Critical | Data loss or crash that blocks normal use | Shortcuts wiped on reload, activation throws |
| High | Core feature broken on a common path | Pinned scripts never run, global shortcuts not stored |
| Medium | Feature broken in a specific case | cwd ignored on Windows, import drops env |
| Low | Cosmetic or rare edge case | Wrong label casing, tooltip typo |

---

## Linking

- Reference bugs from commits: `fix: description (area_description)`
- Reference proposals from commits: `feat: description (proposal_description)`
- Reference issues from ROADMAP: `[issue file](bugs/shortcut_global_not_synced.md)` or `[proposal](bugs/proposal_pin_drag_reorder.md)`
- Reference related history: `Related: plans/history/YYYY.MM/YYYYMMDD/filename.md`

---

## Policy Note

Do not log project-specific findings or proposals directly in this guide.

- This file is process documentation only.
- Every concrete bug or feature request must live in a separate file under `bugs/` using the naming rules above.
- If you discover this happened again, move the content into dedicated issue files immediately and leave only this policy note.
