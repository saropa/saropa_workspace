# Multi-root attribution surface

Plan 1.2, item 2 — show the owning workspace folder on each project shortcut's
tree row when two or more workspace folders are open.

## Finish Report (2026-07-27)

### Problem

In a multi-root workspace, project shortcuts from different workspace folders
appear under a single "Project Shortcuts" header with no indication of which
`.vscode/saropa-workspace.json` owns each one. The user cannot tell at a glance
which folder a shortcut belongs to.

### Change

A new `owningFolder` field threads through the tree-item builder chain:

- `shortcutTreeNodes.ts` — `owningFolderName()` reads `store.folderOf(shortcut)`
  and returns the folder's `.name` only when `scope === "project"` and
  `workspaceFolders.length >= 2`. Single-folder workspaces and global shortcuts
  are unaffected.
- `shortcutTreeItem.ts` — accepts `owningFolder?` as the last constructor param
  and passes it to both the description and tooltip builders.
- `shortcutRowDescription.ts` — appends `"in {folder}"` as the trailing
  `·`-joined segment of the row description.
- `shortcutRowTooltip.ts` — prepends `"Owned by workspace folder {folder}."` to
  the metadata section of the hover tooltip (before tags and branch).
- `en.json` — two new l10n keys: `folder.rowTag`, `folder.tooltip`.

### Test coverage

Three new assertions in `shortcutRowDescription.test.ts`:

1. Description includes folder tag when `owningFolder` is set.
2. Description omits folder tag when `owningFolder` is undefined.
3. Folder tag appears after the file-path segment in the `·`-joined row.

Full suite: 1047 tests, 0 failures. tsc and esbuild clean.
