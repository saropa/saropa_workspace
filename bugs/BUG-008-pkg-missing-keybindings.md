# BUG-008: Most keyboard-driven commands ship without default keybindings

**Status: Open**

<!-- Status values: Open → Investigating → Fix Ready → Closed -->

Created: 2026-09-02
Area: Packaging
File(s): `extension/package.json` (`contributes.keybindings`)
Severity: Medium
Extension version: 1.6.12

---

## Summary

Only one keybinding is registered in the extension manifest (Alt+P for Peek). Several commands designed for keyboard-first usage ship without any default keybinding: add active file as shortcut, run selected shortcut, focus shortcuts view, filter shortcuts, and `runTopPin1` through `runTopPin5`. These commands exist and are registered but are only reachable via the command palette or mouse, defeating their purpose as quick-access operations.

---

## Attribution Evidence

The `contributes.keybindings` array in `extension/package.json` contains only one entry. The commands themselves are declared in `contributes.commands` in the same file and have handlers in `extension/src/commands/`.

---

## Reproducer

1. Install the extension.
2. Open Keyboard Shortcuts (Ctrl+K Ctrl+S).
3. Search for `saropaWorkspace`.
4. Observe: only the Peek command has a default keybinding. All other commands — including the `runTopPin1`-`runTopPin5` commands specifically designed for keyboard shortcuts — show no default binding.

**Frequency:** Always — this is a manifest gap.

---

## Expected vs Actual

| | Behavior |
|---|---|
| **Expected** | Commands designed for keyboard-first access ship with sensible default keybindings, especially `runTopPin1`-`runTopPin5` which have no other ergonomic invocation path. |
| **Actual** | Only one command (Peek) has a default keybinding. The rest require the command palette or a custom user keybinding. |

---

## State / Flow Context

```
package.json contributes.keybindings
  └─ Alt+P → Peek   ← only binding

Missing bindings for:
  - addActiveFileAsShortcut
  - runSelectedShortcut
  - focusShortcutsView
  - filterShortcuts
  - runTopPin1 through runTopPin5
```

---

## Root Cause

The keybinding declarations were never added to `contributes.keybindings` in `package.json` for these commands. The commands were registered and functional but shipped without default key assignments.

---

## Suggested Fix

Add default keybindings in `contributes.keybindings` for the most keyboard-oriented commands. Suggested bindings (to be finalized — must avoid conflicts with common VS Code and extension keybindings):

- `runTopPin1` through `runTopPin5`: e.g. `Ctrl+Alt+1` through `Ctrl+Alt+5`
- `addActiveFileAsShortcut`: e.g. `Ctrl+Alt+A`
- `focusShortcutsView`: e.g. `Ctrl+Alt+S`
- `runSelectedShortcut`: e.g. `Ctrl+Alt+R`

Each binding should include an appropriate `when` clause to avoid conflicts when the shortcuts view is not focused.

---

## Changes Made

<!-- Fill in when a fix is written. -->

---

## Verification

- [ ] `tsc -p ./ --noEmit` clean
- [ ] `npm run build` succeeds
- [ ] Manual smoke test: confirm new keybindings appear in Keyboard Shortcuts and trigger the correct commands
- [ ] Verify no conflicts with common VS Code keybindings

---

## Commits

<!-- Add commit hashes as fixes land. -->

---

## Environment

- saropa_workspace version: 1.6.12
- VS Code version: any
- OS: any
- Pin scope (project / global): n/a
- Settings Sync enabled (yes / no): n/a
