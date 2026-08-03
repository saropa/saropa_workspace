# Launcher webview context menu submenus

The Launcher panel's right-click context menu grew to ~15 items for a file shortcut, overflowing small viewports. Because the Launcher is a WebviewView (not a native tree view), VS Code's `contributes.submenus` mechanism does not apply — the menu is pure HTML/JS rendered by the webview itself.

## Finish Report (2026-08-03)

### Problem

The flat context menu in the Launcher webview panel listed every action (Open, Run, Run With, Configure Run, Set Params, Configure Schedule, Configure Triggers, Pause, Customize, Set Live Metric, Duplicate File, Rename File on Disk, Copy File To, Mask, Rename, Remove) as a single-level list. On small panels this overflowed the viewport.

### Solution

Introduced one level of hover-expandable submenu flyouts in the webview's custom HTML context menu:

- **Top-level (quick access):** Open, Run, Rename, Remove
- **Configure & Schedule submenu:** Run With, Configure Run, Set Params, Configure Schedule, Configure Triggers, Pause/Resume
- **Appearance submenu:** Customize, Set Live Metric
- **File Actions submenu (file shortcuts only):** Duplicate File, Rename File on Disk, Copy File To, Mask/Unmask

### Hardening

- **Shared flyout state:** Replaced per-row `subOpen`/`closeSub` closures with a single `activeSub`/`activeSubTimer`/`activeSubTrigger` set. Only one flyout is ever open; hovering a sibling trigger closes the previous flyout immediately (no 200ms overlap).
- **Keyboard navigation:** Up/Down moves focus within the menu or flyout. Right on a `.has-sub` trigger opens the flyout and focuses its first item. Left or Escape inside a flyout closes it and returns focus to the trigger row. Escape at the top level closes the entire menu. The menu auto-focuses its first item on open.
- **Click-outside guard:** The click-outside dismissal check now also excludes clicks inside the active submenu flyout (`activeSub.contains(e.target)`), preventing accidental close when clicking a submenu item.
- **Empty command guard:** The host's `MENU_COMMANDS` allowlist already rejects empty strings, so the submenu parent's `command: ""` never reaches `executeCommand`.
- **WHY comment restored:** The Edit-group comment explaining why `unpin` (not `removeProjectPin`/`removeGlobalPin`) is used was restored after accidental deletion.

### Files changed

- `extension/src/views/launcherItemMenu.ts` — `buildMenu()` wraps configure/appearance/file groups into parent `LauncherMenuEntry` objects with `children` arrays; WHY comment on unpin restored.
- `extension/src/views/launcherItems.ts` — `LauncherMenuEntry` interface carries optional `children`; doc comment updated to describe submenu support and the asShortcut-only contract.
- `extension/src/views/launcher/launcherScriptMenu.ts` — `buildMenuRow()` renders entries with `children` as hover-expandable flyouts; shared `activeSub`/`closeActiveSub` state; full keyboard navigation (Up/Down/Left/Right/Escape); viewport clamping; click-outside guard includes submenu.
- `extension/src/views/launcherAssets.ts` — CSS for `.has-sub`, `.menu-arrow` (right-pointing triangle), `.menu-sub` (z-index above parent menu).
- `extension/src/i18n/locales/en.json` — l10n keys `launcher.menu.sub.configure`, `launcher.menu.sub.appearance`, `launcher.menu.sub.file`.
- `extension/src/test/launcherItems.test.ts` — `allMenuCommands()` helper collects commands from both top-level and nested children; two existing assertions updated to use it.
- `plans/guides/STYLEGUIDE.md` — webview menu rule rewritten to document submenu support and keyboard navigation.
- `CHANGELOG.md` — entry added under `[Unreleased]`.
