# BUG-009: Multiple accessibility gaps in tree view and Launcher webview

**Status: Open**

<!-- Status values: Open → Investigating → Fix Ready → Closed -->

Created: 2026-09-02
Area: Tree View / UX
File(s): `extension/src/views/pinTreeItem.ts`, `extension/src/views/pinsTreeProvider.ts`, Launcher webview files
Severity: Medium
Extension version: 1.6.12

---

## Summary

Several accessibility gaps exist across the tree view and the Launcher webview:

1. **No `accessibilityInformation`** on tree items — screen readers get raw labels with no role or state differentiation (running, stopped, paused, masked states are invisible to assistive technology).
2. **Separator row** uses 40 box-drawing dash characters — a screen reader reads nothing meaningful (or reads "dash dash dash..." 40 times).
3. **Untapped marker** (the `●` character) reads as "black circle" to screen readers — should convey "New" or "Not yet opened".
4. **Launcher custom right-click menu** lacks `role="menu"` and `role="menuitem"` ARIA attributes, despite having careful keyboard navigation implemented.

---

## Attribution Evidence

Tree items are built in `extension/src/views/pinTreeItem.ts` and `pinsTreeProvider.ts`. The Launcher webview menu is in the Launcher view files under `extension/src/views/`. All extension code.

---

## Reproducer

1. Enable a screen reader (Narrator on Windows, VoiceOver on macOS).
2. Navigate to the Shortcuts tree view.
3. Observe: tree items announce raw label text with no role/state (e.g. "MyScript running" vs just "MyScript").
4. Navigate to a separator row — hear 40 individual dash characters or silence.
5. Navigate to an item with the `●` untapped marker — hear "black circle".
6. Open the Launcher webview, right-click to open the custom context menu — the menu is not announced as a menu by the screen reader.

**Frequency:** Always, for users of assistive technology.

---

## Expected vs Actual

| | Behavior |
|---|---|
| **Expected** | Tree items carry `accessibilityInformation` with meaningful labels and roles; separators announce as "Separator"; untapped markers announce as "New" or "Not yet opened"; the Launcher context menu has proper ARIA roles. |
| **Actual** | No accessibility information on tree items; separator reads as dashes; untapped marker reads as "black circle"; context menu lacks ARIA roles. |

---

## State / Flow Context

```
pinTreeItem.ts
  └─ TreeItem construction
      └─ accessibilityInformation: NOT SET

pinsTreeProvider.ts
  └─ separator row: label = "────...────"
      └─ no accessibilityInformation

  └─ untapped marker: "●"
      └─ screen reader reads Unicode name "black circle"

Launcher webview
  └─ custom context menu <div>
      └─ no role="menu" or role="menuitem"
```

---

## Root Cause

The `TreeItem` instances in `pinTreeItem.ts` do not set the `accessibilityInformation` property (introduced in VS Code API). The separator row uses visual box-drawing characters without an accessibility label. The untapped marker uses a Unicode bullet without contextual meaning. The Launcher context menu was built as a styled `<div>` without ARIA roles.

---

## Suggested Fix

1. **Tree items**: Set `accessibilityInformation` on each `TreeItem` with a `label` that includes the item's state (e.g. "MyScript, running", "Config file, paused") and appropriate `role`.

2. **Separator**: Set `accessibilityInformation` to `{ label: 'Separator', role: 'separator' }` (or use `TreeItemCollapsibleState.None` with a clear accessibility label).

3. **Untapped marker**: Replace the raw `●` with an accessibility-aware approach — either set `accessibilityInformation` on the tree item to include "New" or "Not yet opened" in the label, or use a different visual indicator that reads meaningfully.

4. **Launcher context menu**: Add `role="menu"` to the menu container and `role="menuitem"` to each menu item. Add `aria-label` attributes where the visible text alone is insufficient.

---

## Changes Made

<!-- Fill in when a fix is written. -->

---

## Verification

- [ ] `tsc -p ./ --noEmit` clean
- [ ] `npm run build` succeeds
- [ ] Manual smoke test with a screen reader: tree items announce state, separator is announced as "Separator", untapped items announce "New", Launcher context menu is announced as a menu

---

## Commits

<!-- Add commit hashes as fixes land. -->

---

## Environment

- saropa_workspace version: 1.6.12
- VS Code version: any (accessibilityInformation available since 1.63)
- OS: any
- Pin scope (project / global): both
- Settings Sync enabled (yes / no): n/a
