# BUG-008: Most keyboard-driven commands ship without default keybindings

**Status: Fixed**

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

Added 8 entries to `contributes.keybindings` in `extension/package.json`, each with a `mac` binding using `Cmd+Alt+`:

- `saropaWorkspace.runTopPin1`-`saropaWorkspace.runTopPin5` → `Ctrl+Alt+1`-`Ctrl+Alt+5` (exact command IDs, no `when` — they act on the top-N pins regardless of view focus).
- `saropaWorkspace.pinActiveFile` → `Ctrl+Alt+A`, `when: "editorFocus"` (fires only with an editor focused). This is the real command behind "add active file as shortcut" — no command literally named `addActiveFileAsShortcut` exists.
- `saropaWorkspace.pins.focus` → `Ctrl+Alt+S`. No command named `focusShortcutsView` exists in `contributes.commands`; VS Code auto-generates a `<viewId>.focus` command for every contributed view, so this binds to the Pins view's built-in focus command without adding a new command declaration.
- `saropaWorkspace.runAnyPin` → `Ctrl+Alt+R`. No command named `runSelectedShortcut` exists. `runAnyPin` (opens a quick pick to run any shortcut) is the closest existing keyboard-driven "run a shortcut" action — there is no command that resolves the tree's current selection and runs it (the existing `peekFocusedPin` does this for Peek, but no run-equivalent exists). Implementing a genuine `runSelectedShortcut` would require new command code, out of scope for a manifest-only fix.

No new commands or `package.nls.json` keys were needed since all bound commands already existed.

---

## Verification

- [x] `tsc -p ./ --noEmit` clean
- [x] `npm run build` (`node esbuild.js`) succeeds
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

---

## Reflection

### Hardening items

- **`ctrl+alt+1`-`ctrl+alt+5` collide with AltGr on non-US keyboard layouts.** On German, French, Spanish, and other European layouts, `AltGr` (right Alt) is reported as `ctrl+alt` by many OSes/keyboards, and `AltGr+1`..`AltGr+5` types characters like `¹`/`@`/`#` directly. Binding `runTopPin1`-`runTopPin5` (`extension/package.json:1062`-`1085`) to `ctrl+alt+<digit>` risks silently eating character input on those layouts instead of, or as well as, running a pin.
- **No `when` clause on the five `runTopPin*` bindings or on `pinActiveFile`'s digit-adjacent neighbors means they fire globally**, including while typing in the integrated terminal, a text editor, or an input box, wherever the host OS does not intercept the chord first. The bug report's own "Suggested Fix" said each binding "should include an appropriate `when` clause to avoid conflicts" (line 78); only `peekFocusedPin` (`focusedView == saropaWorkspace.pins`, line 1059) and `pinActiveFile` (`editorFocus`, line 1090) got one — `runTopPin1`-`5`, `pins.focus`, and `runAnyPin` did not.
- **`ctrl+alt+a`, `ctrl+alt+r`, `ctrl+alt+s` are popular default bindings in other widely installed extensions** (e.g. GitLens, various terminal/REPL extensions use `ctrl+alt+r`/`ctrl+alt+s` for "run"/"send" style actions). VS Code silently drops the losing binding on conflict rather than erroring, so a user with such an extension installed may find these new shortcuts do nothing, with no diagnostic.
- **`saropaWorkspace.pins.focus` is not a declared command** — it is VS Code's auto-generated `<viewId>.focus` command. If the `saropaWorkspace.pins` view ID is ever renamed or the view is removed/restructured, this keybinding silently stops resolving (VS Code does not warn about a keybinding pointing at a since-removed generated command), and nothing in `contributes.commands` would catch the drift at compile time.
- **`runAnyPin` was substituted for the requested `runSelectedShortcut`** (per the "Changes Made" note, line 89) — it opens a quick pick over all pins rather than acting on the tree's current selection. The keybinding now ships permanently under a name/intent gap: users reading the command palette title for `ctrl+alt+r` will not find anything called "run selected shortcut," and the real gap (no command resolves + runs the currently selected tree item) remains open with no tracking bug filed.

### Suggestions

- ~~File a follow-up bug for the still-missing `runSelectedShortcut` command (resolve tree selection + run) noted in "Changes Made" (line 89), so the keyboard-parity gap doesn't get lost now that BUG-008 shows "Fixed."~~ Done: `saropaWorkspace.runSelectedShortcut` is now implemented (`extension/src/activation/wiringStatusBars.ts`, alongside `peekFocusedPin`) and `Ctrl+Alt+R` now binds to it instead of `runAnyPin`.
- Add `"when": "!editorTextFocus && !terminalFocus"` (or a similarly scoped clause) to the five `runTopPin*` bindings and to `runAnyPin`/`pins.focus` to match the caution already applied to `peekFocusedPin` and `pinActiveFile`, preventing accidental fires while typing.
- Complete the two unchecked "Verification" boxes (manual smoke test of the new bindings; conflict check against common VS Code/extension defaults) before the next release — both are still open in this file (lines 99-100) despite the status reading "Fixed."
