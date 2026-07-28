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

### Test results

All description tests pass (12/12, including 4 new). Unrelated failures in
`shortcutStoreMutationCore.test.ts` from a separate `.vscode/` → `.saropa/`
config-path migration are pre-existing and not caused by this change.
