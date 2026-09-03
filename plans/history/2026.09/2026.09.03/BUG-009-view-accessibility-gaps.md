# BUG-009: Multiple accessibility gaps in tree view and Launcher webview

**Status: Fixed**

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

The file names in the original report (`pinTreeItem.ts`, `pinsTreeProvider.ts`) predate a
rename; the actual files are `extension/src/views/shortcutTreeItem.ts` (both the tree-item
construction and the separator/untapped-marker annotation layout live here) and
`extension/src/views/launcher/launcherScriptMenu.ts` (the webview client script fragment
that builds the right-click menu DOM).

1. `shortcutTreeItem.ts`: added `buildAccessibilityLabel()`, which composes a screen-reader
   label from the same state priority `computeRowStateBadge` uses for the visible badge
   (stopping > running > locked > paused > missing > untapped), and set it via
   `accessibilityInformation` on every `ShortcutTreeItem`.
2. `shortcutTreeItem.ts`: the separator annotation row now sets
   `accessibilityInformation: { label: l10n("a11y.separator"), role: "separator" }` instead of
   leaving the 40-dash label to be read literally. The comment annotation row also gets an
   explicit `accessibilityInformation` for consistency.
3. The untapped marker (`●`) keeps its visible glyph (full-strength label color, per the
   existing design note) but the new `buildAccessibilityLabel()` appends "not yet opened"
   (`a11y.untappedState`) to the accessible label, so the fact reaches screen-reader users
   through the label channel instead of relying on Unicode glyph names.
4. `launcherScriptMenu.ts`: added `role="menu"` + `aria-label` (item name + "actions") to the
   top-level context menu and each submenu, `role="menuitem"` to every menu button, and
   `aria-haspopup`/`aria-expanded` on rows that open a submenu (flipped true/false in
   `showSub`/`closeActiveSub`). `launcherView.ts` now sends the two new label templates
   (`menuAriaLabel`, `menuSubAriaLabel`) through the existing `strings` payload.
5. New i18n keys added to `extension/src/i18n/locales/en.json`: `a11y.missingState`,
   `a11y.untappedState`, `a11y.separator`, `launcher.menu.ariaLabel`, `launcher.menu.subAriaLabel`.

---

## Verification

- [x] `tsc -p ./ --noEmit` clean
- [x] `node esbuild.js` succeeds
- [ ] Manual smoke test with a screen reader: tree items announce state, separator is announced as "Separator", untapped items announce "not yet opened", Launcher context menu is announced as a menu (not yet run — no screen reader available in this environment)

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

---

## Reflection

### Hardening items

- `buildAccessibilityLabel()` (`shortcutTreeItem.ts`) is a pure function of a snapshot of state passed in at construction time; if `ShortcutTreeItem` instances are ever cached/reused across a refresh instead of rebuilt, the label goes stale while the visible badge (recomputed by `computeRowStateBadge`) updates — the two channels would disagree, which is the exact failure mode the priority-order comment is trying to prevent.
- The priority order in `buildAccessibilityLabel` (stopping > running > locked > paused > missing > untapped) is hand-duplicated from `computeRowStateBadge` in `shortcutRowDescription.ts` rather than shared — a future state (e.g. a new lock kind or a "queued" state) added to one function and not the other will silently desync the spoken and visual channels with no compile-time signal.
- `menu.setAttribute('role', 'menu')` in `launcherScriptMenu.ts` is applied only to the top-level right-click menu and each dynamically created submenu (`showSub`) — there is no automated check that every future menu-building code path sets it; a new menu variant added later could ship without the role and regress silently since nothing fails at build time.
- `aria-expanded` on a submenu trigger row is flipped in `showSub`/`closeActiveSub`, but the mouse-driven open/close path (`mouseenter`/`mouseleave` with a 200 ms `activeSubTimer`) and the keyboard path (`ArrowLeft`/`Escape`) both call `closeActiveSub` — if a future edit adds another dismissal path (e.g. clicking elsewhere in the menu) without routing through `closeActiveSub`, the trigger's `aria-expanded` state can go stale relative to whether the submenu DOM node is actually present.
- The untapped marker's accessible fact ("not yet opened") is appended only through `buildAccessibilityLabel`'s `untapped` branch; nothing enforces that every code path constructing a `ShortcutTreeItem` for an untapped shortcut actually passes `untapped: true` — a missed call site reverts silently to the bare name with no visible or automated signal.
- Manual screen-reader verification (Narrator/VoiceOver) was never run — the checklist item is explicitly unchecked in Verification. The `tsc`/`esbuild` checks confirm the ARIA attributes and `accessibilityInformation` objects are well-typed and present, not that they read sensibly aloud (e.g. label ordering, redundant announcements, or the submenu's `aria-label` reading naturally after the parent menu's own label).

### Suggestions

- Extract the shared state-priority list (stopping > running > locked > paused > missing/untapped) into one ordered array or lookup consumed by both `computeRowStateBadge` and `buildAccessibilityLabel`, so a new state can only be added in one place and the visual/spoken channels can't drift apart.
- Add a lightweight unit test (in the existing `node --test` harness) asserting `buildAccessibilityLabel` returns the state substring for at least one representative case per priority level, so a regression in the branch order or a dropped `l10n` key fails a fast test instead of waiting for a manual screen-reader pass.
- Track the unchecked manual screen-reader verification as a follow-up item (or a dedicated bug) rather than letting it stay indefinitely deferred in this closed bug's checklist — the fix is otherwise unverified for its actual purpose.
