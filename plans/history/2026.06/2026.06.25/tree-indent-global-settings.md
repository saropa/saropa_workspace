# Tree indentation readability — global VS Code setting

The pins tree's third level (scope → group → pin) rendered with no visible
indentation past its parent group, making nested pins hard to read. The cause
was the default 8px tree indent in the VS Code window where the extension runs;
the fix sets a wider indent in global user settings, because tree indentation is
a VS Code user setting the extension cannot control per-view.

## Finish Report (2026-06-25)

### Defect

In the Saropa Workspace pins view, a leaf pin nested under a user group (the
third tree level, e.g. `Project Pins → Build → setup_arb_translate.py`) appeared
flush with its parent group rather than indented beneath it. At the VS Code
default `workbench.tree.indent` of 8px, a leaf row reserves the twistie width but
shows no chevron, so its icon lands almost directly under the parent folder's
icon — the level reads as un-indented.

### Root cause

Tree indentation is governed by the VS Code user setting
`workbench.tree.indent` (registered in `listService.ts` with type number,
default 8, range 4–40, and **no scope property** — therefore window-scoped and
valid in workspace settings). The VS Code TreeView / TreeDataProvider API
exposes no per-view indentation control, so the extension code cannot influence
it. The repository's `.vscode/settings.json` already set `workbench.tree.indent`
to 30, but that value only applies to windows that open the `saropa_workspace`
folder. The extension is used in other project folders, whose windows fall back
to their own setting (the 8px default). None of the three installed VS Code
editions (Code, Code - Insiders, VSCodium) had a user-level value.

### Change

Added two keys to the **global user** `settings.json` of all three editions
(`%APPDATA%\Code\User`, `%APPDATA%\Code - Insiders\User`,
`%APPDATA%\VSCodium\User`):

- `"workbench.tree.indent": 30`
- `"workbench.tree.renderIndentGuides": "always"`

These apply to every window regardless of which project folder is open, so the
nested pins tree (and the file Explorer) now step out clearly with guide lines.
No repository files changed; no extension code was modified.

### Notes for maintainers

- The extension cannot set tree indentation for end users — `workbench.tree.indent`
  is each user's own VS Code setting and applies globally to all trees. Do not
  attempt to force it from extension code; there is no API for it.
- Updating `workbench.tree.indent` does not re-render an already-open tree
  (VS Code issue #249540); a window reload is required to see the change.
- The repo's own `.vscode/settings.json` retains its workspace-scoped value of
  30; that affects only windows opening this folder and is unrelated to the
  global fix above.
