# Bug Report Guide

How to file, investigate, and close bugs in `saropa_workspace`.

This is the bug process for the Saropa Workspace VS Code extension
(TypeScript). File concrete issues as separate bug files under `bugs/` using
the naming and template below — not only in chat or a downstream issue
tracker.

---

## File Naming

Use `BUG-NNN-area-description.md`, where `NNN` is a zero-padded sequence
number, `area` is one of the categories below, and `description` is a short
lowercase-with-hyphens slug.

| Area | Slug | Example |
|------|------|---------|
| Pins / storage | `pins` | `BUG-001-pins-global-pin-not-synced.md` |
| Execution | `exec` | `BUG-002-exec-cwd-ignored-on-windows.md` |
| Scheduling | `schedule` | `BUG-003-schedule-run-fires-twice.md` |
| Tree view / UX | `view` | `BUG-004-view-stale-after-rename.md` |
| Import | `import` | `BUG-005-import-favorites-json-skips-args.md` |
| Manifest / packaging | `pkg` | `BUG-006-pkg-command-missing-from-palette.md` |
| Documentation | `docs` | `BUG-007-docs-wrong-settings-key.md` |

Use lowercase with hyphens for the description. Check existing files and pick
the next free `NNN` before creating.

---

## Confirm Attribution Before Filing

**Before filing, confirm the bug is in `saropa_workspace` and not in VS Code
itself, another extension, or the user's own pinned script.** A failure
observed in the editor is not automatically this extension's fault.

For a bug report, establish:

1. **It is our code.** Grep the relevant symbol, command id, or settings key
   and point to where it lives:

   ```bash
   grep -rn "saropaWorkspace.runPin" extension/src/ extension/package.json
   ```

   Expected: a handler registered in `extension/src/` and a declaration in
   `extension/package.json`. Zero matches means the command/setting is not
   ours — do not file here.

2. **It is not the pinned script's own behavior.** If a pinned script fails or
   misbehaves when run, confirm the failure is in how the extension *invokes*
   it (wrong cwd, missing args, dropped env, wrong command prefix), not in the
   script itself. Paste the resolved command line the extension built and the
   exact failure.

3. **It is not stock VS Code behavior.** Tree-view quirks, Settings Sync
   timing, and terminal behavior can originate in the host. Note the VS Code
   version and whether the behavior persists with no other extensions enabled.

### Why this section exists

Filing without attribution evidence forces the first fix agent to waste a
round-trip discovering the bug lives elsewhere — in VS Code, another
extension, or the user's pinned script. The defense is evidence pasted
directly in the report: the code location, the resolved command line, and the
environment.

---

## Bug Report Template

Copy the block below into a new file.

````markdown
# BUG-NNN: Short, Specific Title

**Status: Open**

<!-- Status values: Open → Investigating → Fix Ready → Closed -->

Created: YYYY-MM-DD
Area: Pins / Execution / Scheduling / Tree View / Import / Packaging / Docs
File(s): `extension/src/...` (line ~NNN)
Severity: Crash / Wrong behavior / Data loss / UX / Performance / Cosmetic
Extension version: 0.1.x

---

## Summary

One or two sentences: what happens, what should happen instead.

---

## Attribution Evidence

Proof this lives in `saropa_workspace`. If the symbol/command/setting is not
found here, the bug does not belong in this repo — do not file here. See
"Confirm Attribution Before Filing".

```bash
# Command / setting / symbol IS declared and handled here
grep -rn "saropaWorkspace.<command>" extension/src/ extension/package.json
# Expected: a handler in extension/src/ and a declaration in package.json
```

**Handler:** `extension/src/<folder>/<file>.ts:NN`
**Manifest declaration:** `extension/package.json` (`contributes.commands` / `configuration`)
**Resolved command line (for execution bugs):** `<prefix> <args>` (cwd: `...`, env: `...`)
**VS Code version / OS:** `...`

---

## Reproducer

The smallest set of steps that triggers the bug. This is the single most
important section.

1. Pin `path/to/file` (project / global) with these run params: ...
2. ...
3. Observe: ...

If a specific pin definition is needed, paste the relevant
`.vscode/saropa-workspace.json` entry (or the imported `.favorites.json`
fragment).

**Frequency:** Always / Only with specific pins / Intermittent / Platform-specific

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
activatePin (commands/pinCommands.ts)
  └─ pinStore.get (model/pinStore.ts)
      └─ runner.run (exec/runner.ts)   ← failure here
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
- Pin scope (project / global):
- Settings Sync enabled (yes / no):
````

---

## What Makes a Good Bug Report

### Title

- Be specific: "global pin not synced to second machine" beats
  "pins broken".
- Name the area so the file slug and the title agree.

### Reproducer

- Smallest possible steps — strip everything unrelated.
- Include the exact pin definition (run params, scope) when the bug depends on
  it.
- For execution bugs, paste the resolved command line the extension built, the
  working directory, and any env overrides.
- For platform-specific bugs, name the OS and shell.

### State / Flow Context

- Trace the path: command handler → store → view, or command → runner →
  terminal/output channel.
- Name the function where the behavior diverges from expected.

### Root Cause

- Explain the mechanism: which branch evaluates wrong, and why.
- Reference specific file and line numbers in `extension/src/`.

---

## Bug Categories

### Pins / Storage

Pin data is wrong, lost, not persisted, or not synced.

**Investigation focus:**

- Is the pin written to the right place — project file
  (`.vscode/saropa-workspace.json`) for project pins, `globalState` for global
  pins?
- Are workspace-relative paths resolved correctly across machines and
  platforms?
- For sync issues: is the value stored in `globalState` with sync enabled, and
  does VS Code Settings Sync actually carry it?
- Does an auto-pin removal persist, and does restore bring it back?

### Execution

A pinned script does not run, runs wrong, or runs in the wrong place.

**Investigation focus:**

- Is the resolved command correct — command prefix + args, in the right cwd,
  with the right env?
- Integrated terminal vs background output channel: does the configured path
  get taken?
- Quoting and path handling on Windows vs POSIX shells.
- Is the failure in how we invoke the script, or in the script itself? (The
  latter is not our bug — see attribution.)

### Scheduling

A scheduled run does not fire, fires at the wrong time, or fires more than
once.

**Investigation focus:**

- Timer setup and teardown — are duplicate timers created on reload or config
  change?
- What happens across window reload, sleep/wake, and workspace switch?

### Tree View / UX

The activity-bar view shows stale, missing, or wrong items, or feedback is
absent after an action.

**Investigation focus:**

- Is the provider refreshed after every state change?
- Are Project Pins and Global Pins grouped and ordered correctly?
- Does single-click open and double-click run as configured
  (`doubleClickMs`)?
- Is there visible feedback after a run, rename, or unpin?

### Import

Importing `.favorites.json` drops, mangles, or mis-maps pins.

**Investigation focus:**

- Are all fields mapped — path, label, run params (prefix, args, cwd, env)?
- How are conflicts with existing pins handled?
- Is malformed input rejected with a clear message rather than crashing?

### Manifest / Packaging

A command, menu, view, or setting is missing, mislabeled, or wrongly gated.

**Investigation focus:**

- Is the command declared in `package.json` and registered in
  `extension/src/extension.ts`?
- Does the `when` clause / `viewItem` match what the code sets as
  `contextValue`?
- Are display strings resolved via `%key%` (`package.nls.json`) rather than
  showing the raw key?
- Does the production `npm run package` bundle include everything the VSIX
  needs?

### Documentation

A doc, setting description, or README statement is wrong or out of date.

**Investigation focus:**

- Does the documented settings key / command id match `package.json`?
- Does the described behavior match the current code?

---

## Investigation Checklist

Use this when diagnosing a new bug.

- [ ] **Attribution** — confirmed the command/setting/symbol lives in
      `extension/src` + `package.json` (grep pasted); confirmed it is not the
      pinned script's own behavior or stock VS Code.
- [ ] **Reproduce it** — minimal steps, with the exact pin definition.
- [ ] **Read the handler** — find the command handler in
      `extension/src/commands/` and trace the flow.
- [ ] **Check the store** — `model/pinStore.ts`: where is the pin read/written
      (project file vs `globalState`)?
- [ ] **Check execution** — `exec/runner.ts`: what command line is built, in
      what cwd, with what env, on what surface (terminal vs output channel)?
- [ ] **Check the view** — `views/pinsTreeProvider.ts`: is refresh called
      after the change?
- [ ] **Check the manifest** — `package.json` command/menu/setting matches the
      code (ids, `when`, `contextValue`).
- [ ] **Check platform** — does it reproduce on Windows and POSIX?
- [ ] **Compile + build** — `tsc -p ./ --noEmit` clean and `npm run build`
      succeeds.

---

## Common Pitfalls

These patterns have caused bugs before. Check for them during investigation.

| Pitfall | Why It Breaks | Correct Pattern |
|---------|---------------|-----------------|
| Blaming the extension for a pinned script's own failure | The script exits non-zero on its own logic; we ran it correctly | Confirm the resolved command line is right; if so, it is not our bug |
| Storing a global pin without sync semantics | Value lives only on one machine | Use `globalState` so Settings Sync can carry it |
| Absolute paths in the project pin file | Breaks on another machine / OS | Store workspace-relative paths in `.vscode/saropa-workspace.json` |
| Tree not refreshed after a state change | View shows stale labels/items | Fire the provider's change event after every mutation |
| Command id / setting key drift | `package.json` and code disagree; command silently does nothing | Treat `package.json` as the source of truth; match ids exactly |
| Hardcoded user-facing string | Ships English in every locale, shows raw key if mis-wired | `%key%` in `package.nls.json`, or `l10n()` from `locales/en.json` |
| Naive quoting of args/paths | Spaces and special chars break the run, especially on Windows | Build args as an array / quote per platform |
| `contextValue` / `when` mismatch | Menu item appears on wrong items or never | Align the `viewItem` regex with the `contextValue` set in code |
| Duplicate schedule timers on reload | Same run fires twice | Dispose existing timers before re-creating them |
| Silent action with no feedback | Run/rename/unpin looks like nothing happened | Surface a visible outcome (message, view update) |

---

## Fix Requirements

Every bug fix must satisfy these before it can be closed.

### Code

- [ ] Fix addresses the **root cause**, not just the symptom.
- [ ] Fix includes a comment explaining what was wrong and why the new code is
      correct.
- [ ] No new hardcoded user-facing strings (use `package.nls.json` /
      `l10n()`).
- [ ] American English throughout.

### Verification

- [ ] `tsc -p ./ --noEmit` — no errors.
- [ ] `npm run build` — succeeds.
- [ ] Manual smoke test in the Extension Development Host reproduces the
      original steps and confirms the fix.

### Documentation

- [ ] `CHANGELOG.md` (root) updated under `[Unreleased]` → `### Fixed` for any
      user-visible change.
- [ ] `extension/CHANGELOG.md` left untouched — it is a generated copy of the
      root changelog (rewritten at package time); editing the root suffices.
- [ ] Bug report file updated with root cause, changes, and commit hashes.
- [ ] Status updated to `Closed`.

---

## Lifecycle

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

### Moving to History

When a bug is closed, move its file:

```
bugs/BUG-NNN-area-description.md
  → bugs/history/YYYYMMDD/BUG-NNN-area-description.md
```

Use the date the bug was closed. Create the date folder if it does not exist.

---

## Severity Guide

| Severity | Meaning | Examples |
|----------|---------|---------|
| Critical | Data loss or crash that blocks normal use | Pins wiped on reload, activation throws |
| High | Core feature broken on a common path | Pinned scripts never run, global pins not stored |
| Medium | Feature broken in a specific case | cwd ignored on Windows, import drops env |
| Low | Cosmetic or rare edge case | Wrong label casing, tooltip typo |

---

## Linking

- Reference bugs from commits: `fix: description (BUG-NNN)`.
- Reference related history: `Related: plans/history/YYYY.MM/YYYYMMDD/filename.md`.

---

## Policy Note

Do not log project-specific bug findings directly in this guide.

- This file is process documentation only.
- Every concrete issue must live in a separate bug file under `bugs/` using
  the naming rules above.
- If you discover this happened, move the content into dedicated bug files
  immediately and leave only this policy note.
