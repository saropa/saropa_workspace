# Deduplicate auto-shortcuts and directory-only path subtitle

Two defects in the Shortcuts sidebar tree: auto-shortcuts from `autoPins.patterns`
duplicated manually added shortcuts targeting the same file, and the tree row
description repeated the full filename (already shown as the label) as part of
the dimmed path detail.

## Finish Report (2026-07-27)

### Defect 1 — auto-shortcut duplication

`seedAutoShortcuts` (shortcutStoreRecipes.ts) checked only `removedAutoPins`
before creating a seeded row. A manually added shortcut for `pubspec.yaml`
coexisted with the auto-seeded `auto:folder:pubspec.yaml`, producing two
identical rows in the sidebar. The fix adds an `existingPins` parameter
(passed as `file.pins` from `collectProjectFolderData`) and builds a
`Set<string>` of manual paths to skip during seeding. The
`configExampleShortcut` method already had this guard — general auto-shortcuts
did not.

### Defect 2 — redundant path in row description

`buildShortcutRowDescription` set `detail = shortcut.path` for file shortcuts.
When the label defaulted to the basename (e.g. `app_en.arb`), the description
showed the full path including the filename (`lib/l10n/app_en.arb`) — redundant,
and consuming space that inline action buttons (Open, Copy path) needed. A new
`filePathDetail` helper now returns only the parent directory (`lib/l10n`) when
no custom label is set, the full path when a custom label hides the filename,
and `undefined` for root-level files (no parent directory to show).

### Files changed

- `extension/src/model/shortcutStoreRecipes.ts` — `seedAutoShortcuts` signature
  extended with `existingPins`; path dedup via `manualPaths` Set.
- `extension/src/model/shortcutStoreRefresh.ts` — call site passes `file.pins`.
- `extension/src/views/shortcutRowDescription.ts` — `filePathDetail` helper;
  `detail` assignment updated.
- `extension/src/test/shortcutRowDescription.test.ts` — fixed folder-tag
  ordering assertion (expects `"src"` not `"src/app.ts"`); added four new tests
  covering nested, root-level, custom-label, and deeply-nested path cases.
- `plans/guides/STYLEGUIDE.md` — new tree-row path convention at §4.5.
- `CHANGELOG.md` — `[Unreleased]` entries for both changes.

### Hardening (follow-up pass)

The `filePathDetail` helper was hardened for edge cases discovered during the
initial `/finish` review:

- **Empty-string labels**: an empty-string `shortcut.label` is treated as absent
  (the tree item falls back to the basename), so `filePathDetail` returns the
  parent directory rather than the full path.
- **Backslash paths**: global shortcuts store OS paths with backslashes on
  Windows. `filePathDetail` now checks both `/` and `\` as separators.
- **Long absolute paths for global-scope shortcuts**: a global shortcut's
  absolute parent directory (e.g. `D:\src\contacts`) is too long for a narrow
  sidebar row. `filePathDetail` returns only the last directory segment (e.g.
  `contacts`).
- **Launcher card subtitle alignment**: `launcherItems.ts` line 151 set
  `sub: shortcut.path` (the full path). Now aligned with the tree convention via
  `filePathDetail(shortcut) ?? shortcut.path`.
- **configExampleShortcut dedup**: confirmed already deduped against both
  `file.pins` and `autoShortcuts` — no change needed.

### Feature — shadows-auto visual indicator

When a manual shortcut's path matches an auto-pin pattern, the auto-shortcut is
suppressed by the dedup. Previously this suppression was silent. Now the manual
pin shows a distinct visual indicator:

- **Computation**: `collectProjectFolderData` (shortcutStoreRefresh.ts) calls
  `scanAutoShortcutPaths` (cached, free) after seeding auto-shortcuts and builds
  a `shadowsAutoIds` Set of manual pin IDs whose paths appear in the scanned
  auto paths. The set is stored on `ShortcutStoreBase` alongside
  `missingShortcutIds` and cleared at the start of each `refresh()`.
- **Icon**: the icon resolver (shortcutRowTokens.ts) shows a filled `pinned`
  icon with `charts.yellow` tint when `shadowsAuto` is true and no higher-
  priority state (running, missing, locked, paused, etc.) applies.
- **Tooltip**: a metadata line in the hover explains the relationship and that
  removing the manual pin will bring back the auto-shortcut.
- **Masking**: the tooltip line is suppressed when the shortcut is masked, since
  knowing the path matches a pattern leaks identity information.

### Additional files changed (hardening + feature)

- `extension/src/model/shortcutStoreBase.ts` — `shadowsAutoIds` Set +
  `shadowsAuto()` accessor.
- `extension/src/model/shortcutStoreRefresh.ts` — clears `shadowsAutoIds` in
  `refresh()`; computes it in `collectProjectFolderData`.
- `extension/src/views/shortcutRowTokens.ts` — `shadowsAuto` field on
  `ShortcutRowIconInput`; filled-pin icon branch.
- `extension/src/views/shortcutRowTooltip.ts` — `shadowsAuto` field on
  `ShortcutTooltipInput`; tooltip line in metadata section.
- `extension/src/views/shortcutTreeItem.ts` — `shadowsAuto` field on
  `ShortcutTreeItemOptions`; wired through constructor to icon and tooltip.
- `extension/src/views/shortcutTreeNodes.ts` — passes `store.shadowsAuto()` to
  `buildShortcutItem`.
- `extension/src/views/launcherItems.ts` — uses `filePathDetail()` for card
  subtitle.
- `extension/src/i18n/locales/en.json` — `shadowsAuto.tooltip` string.
- `CHANGELOG.md` — `[Unreleased]` entry for the feature.

### Test results

All description tests pass (12/12, including 4 new). 1067/1071 total tests pass;
4 pre-existing `LAUNCHER_STYLE` failures are unrelated (folded-strip styling from
a separate change in flight).
