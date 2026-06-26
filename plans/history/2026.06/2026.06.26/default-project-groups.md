# Default project groups, file auto-sorting, and recipe default homes

Project Shortcuts previously opened as a flat list with no structure until the
user hand-made groups, and a newly added file always landed at the scope's top
level. This change gives the Project scope seven built-in groups (Build, Run,
Deploy, Test, Docs, Data, Code), auto-sorts an added file into the matching group
by its name and type, and files a promoted/scheduled recipe into its declared
default group.

## Finish Report (2026-06-26)

### Scope

VS Code extension (TypeScript), plus documentation (CHANGELOG, STYLEGUIDE). No
Flutter/Dart code; the Flutter l10n section does not apply.

### Behavior added

- **Synthetic default groups in the Project scope.** Seven groups — Build, Run,
  Deploy, Test, Docs, Data, Code — render under Project Shortcuts even when empty,
  each with a distinct codicon and theme color. They are NOT stored in any
  project file: they are injected into the group list every refresh, so they show
  without writing seven folders into the committed
  `.vscode/saropa-workspace.json`. Collapse posture is persisted in `globalState`
  (default collapsed), mirroring how the recipe groups handle posture. Gated on a
  workspace folder being open and the `saropaWorkspace.defaultGroups.enabled`
  setting (default true).
- **Auto-sort on add.** When a file is added with no chosen group, it is filed
  into a default group by an ordered rule list: name-intent rules
  (publish/deploy/release, test/spec, build/compile/…, run/serve/dev/…) are
  checked before file-type rules (.md → Docs, .json/.csv/.xml/… → Data,
  .ts/.dart/… → Code), so a name like "publish" wins over the file's extension. A
  file matching no rule keeps no group and stays at the top level (the prior
  behavior). The "Added" confirmation names the group the file landed in.
- **Recipe default homes.** A recipe catalog table maps a recipe's stable id to a
  default group (test → Test, build → Build, deployed → Deploy, docs → Docs, …).
  On promotion — explicit Promote, or the one-tap schedule-enable — the stored
  shortcut files into that default group instead of a group named after the
  recipe's section. A recipe with no declared home keeps the section-named
  promotion path.

### Collision handling

A user can hand-make a group whose label matches a default group (for example
"Build"). To avoid two identically named folders, refresh suppresses the
synthetic default whose label collides with an existing project group, and both
auto-assign and recipe promotion route into the existing user group's id via a
shared `effectiveDefaultGroupId` resolver, so the membership renders in the
folder that is shown.

### Robustness

The Shortcuts tree's top-level filter now treats a shortcut whose `groupId` names
no existing group as top-level, so a shortcut filed into a default group does not
vanish when the feature is later disabled (its stored `groupId` is preserved and
it returns to its folder when re-enabled).

### Import preservation

`addShortcut` gained an `options.autoGroup` flag (default true). The bulk
favorites importers (kdcro101 bookmarks, Oleg Shilo, settings-based) pass
`autoGroup: false`, so an imported list is reconstructed as-is rather than being
re-sorted into default groups. The sibling importer is global-scope and unaffected
(auto-sort applies only to project shortcuts).

### Files changed

- `model/shortcutStoreShared.ts` — `DefaultGroupDef` + `DEFAULT_GROUPS` table,
  `DEFAULT_GROUP_EXPANDED_PREFIX`, the ordered `matchDefaultGroup` rules, the
  `RECIPE_DEFAULT_GROUP` map + `recipeDefaultGroupId`, and `isDefaultGroupId` /
  `defaultGroupLabel` helpers.
- `model/shortcutStoreRecipes.ts` — `defaultGroupsEnabled()` /
  `defaultGroupExpanded()`.
- `model/shortcutStoreRefresh.ts` — inject default groups (collision-suppressed)
  into `projectGroups`.
- `model/shortcutStoreMutationCore.ts` — `addShortcut` auto-assign +
  `options.autoGroup`; the shared `effectiveDefaultGroupId` resolver.
- `model/shortcutStoreMutation.ts` — route a promoted recipe into its default
  group.
- `model/shortcutStore.ts` — persist default-group collapse to `globalState`;
  resolve a default-group drop target's folder from the dropped shortcut.
- `views/shortcutsTreeProvider.ts` — top-level fallback for orphaned `groupId`.
- `views/shortcutTreeItems.ts` — `defaultGroup` contextValue (no rename/delete
  menu, still a drop target).
- `commands/shortcutSelection.ts` — name the default group in the add toast.
- `import/favoritesKdcroBookmarks.ts`, `import/favoritesOlegShilo.ts`,
  `import/favoritesSettings.ts` — `autoGroup: false`.
- `package.json` + `package.nls.json` — `saropaWorkspace.defaultGroups.enabled`
  setting.
- `i18n/locales/en.json` — `pin.addedToGroup`.

### Tests

`test/shortcutStoreShared.test.ts` covers the pure helpers (default-group table
consistency, the no-overlap with synthetic recipe ids, `matchDefaultGroup`
name-beats-type and file-type sorting, the no-match case, and
`recipeDefaultGroupId`). `test/shortcutStoreMutationCore.test.ts` adds behavior
tests for auto-sort on add, the user-group-absorbs-default collision, and the
feature-off path. `test/favoritesKdcro.test.ts` was updated to count only
imported (non-default) groups and to confirm an imported top-level file stays at
the top level. Full suite: 785 passing, 0 failing. `tsc --noEmit` clean; esbuild
bundle builds.

### Convention recorded

`STYLEGUIDE.md` §2 gained a note that synthetic group folder labels (the recipe
groups and the new default groups) live inline in their const routing table,
consistent with the existing `RECIPE_GROUPS`; everything else user-facing (the
toast, the setting description) stays externalized.
