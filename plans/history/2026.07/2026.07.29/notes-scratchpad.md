# Notes — persistent scratchpad with project and global scope

## Problem

The existing scratchpad (WOW #6) creates throwaway in-memory buffers — useful for a quick paste, useless for anything you want to find again. Developers keep sticky notes, checklists, meeting fragments, and debugging breadcrumbs in random files that clutter the repo or get lost across projects. There is no organized, searchable, always-visible place for this inside VS Code.

## Feature summary

A **Notes** section in the Saropa Workspace sidebar — a 6th tree view alongside Shortcuts, Recipes, Watches, Project Files, and Scripts. Notes are real files on disk (Markdown by default), organized into project-scoped and global collections, visible in the tree, and editable in the normal VS Code editor. Global notes surface across every workspace.

## Storage model

### Project notes (default)

```
<workspace-folder>/.saropa/notes/
  standup-checklist.md
  api-migration-log.md
  ...
```

The `.saropa/` folder is already the extension's config directory (shareable via the repo if the team opts in). Notes live alongside the shortcut config but in their own subfolder. The folder is created on first note. Files are plain text/Markdown — no wrapper JSON, no metadata sidecar. The filename IS the note identity.

### Global notes

```
<configDir>/notes/
```

Where `<configDir>` is the OS-level VS Code user data directory (`globalStorageUri` from the extension context). Global notes are not tied to any workspace and appear in every project's Notes view under a "Global Notes" root — the same project/global split pattern used by Shortcuts.

### Index file (minimal)

Each scope gets an optional `.notes-index.json` that stores display order, pinned/starred status, and tags — metadata that does not belong in the note file itself. The index is auto-created and auto-repaired; deleting it resets order to alphabetical. Schema:

```jsonc
{
  "version": 1,
  "entries": [
    {
      "filename": "standup-checklist.md",
      "order": 0,
      "pinned": true,         // sticky at top
      "tags": ["daily"]
    }
  ]
}
```

No note content is duplicated in the index.

## Tree view design

```
NOTES (6th view: saropaWorkspace.notes)
├── 📌 standup-checklist.md          ← pinned to top
├── api-migration-log.md
├── scratch-2026-07-29.md
├── ── Global Notes ──────────────── ← scope root (like Global Shortcuts)
│   ├── interview-questions.md
│   └── regex-cheatsheet.md
```

### Tree item behavior

| Action | Behavior |
|--------|----------|
| Single click | Open the note file in the editor (preview mode) |
| Double click | Open the note file in the editor (pinned tab, not preview) |
| Inline button (play icon) | N/A — notes don't run |
| Inline button (pin icon) | Toggle pinned-to-top |
| Context menu | Rename, Delete, Move to Project / Move to Global, Tags, Copy Path |

### View title actions (toolbar)

- **New Note** (primary) — creates a note via a name input box, opens it
- **New Note from Clipboard** — creates a note pre-filled with clipboard content
- **Refresh** — re-scan the notes folders
- **Sort** (overflow) — by name / by modified date / by manual order
- **Show Global Notes** toggle (overflow) — hide/show the global scope root

## Commands

| Command ID | Title | Surface |
|------------|-------|---------|
| `saropaWorkspace.newNote` | New Note... | View title button, command palette |
| `saropaWorkspace.newNoteFromClipboard` | New Note from Clipboard | View title overflow, command palette |
| `saropaWorkspace.deleteNote` | Delete Note | Context menu |
| `saropaWorkspace.renameNote` | Rename Note | Context menu |
| `saropaWorkspace.moveNoteToProject` | Move to Project Notes | Context menu (on global notes) |
| `saropaWorkspace.moveNoteToGlobal` | Move to Global Notes | Context menu (on project notes) |
| `saropaWorkspace.toggleNotePin` | Pin / Unpin Note | Context menu, inline icon |
| `saropaWorkspace.tagNote` | Edit Tags... | Context menu |
| `saropaWorkspace.openNotesFolder` | Open Notes Folder | View title overflow |
| `saropaWorkspace.refreshNotes` | Refresh Notes | View title button |

## Migration (global ↔ project)

"Move to Project Notes" copies the file from `globalStorageUri/notes/` to `.saropa/notes/`, updates both index files, and deletes the original. The reverse does the same in the other direction. If a filename collision exists, the user is prompted to rename. The move is a file-system operation — the note content is untouched.

## Global surfacing across all projects

Global notes live in a single shared folder, so they appear in every workspace's Notes view automatically. No cross-workspace syncing is needed — the tree provider reads from one location.

For project notes from *other* workspaces (the "surface everywhere" option): a settings toggle `saropaWorkspace.notes.showCrossProject` (default `false`) adds a "Other Projects" collapsible root that scans known workspace folders' `.saropa/notes/` directories. This is opt-in because scanning arbitrary folders has a cost and a privacy implication. The list of known workspace folders comes from VS Code's recent workspaces API or a user-configured list in settings.

## Interaction with existing scratchpad

The existing `newScratchpad` command stays as-is — it creates ephemeral in-memory buffers for throwaway work. The Notes feature is the persistent counterpart. A natural upgrade path: "New Note from Editor" command (future) could save an open untitled scratchpad buffer as a named note.

## File watching

A `FileSystemWatcher` on `.saropa/notes/**` and the global notes folder triggers tree refreshes when notes are created, renamed, or deleted outside the extension (e.g., from the terminal or file explorer). This keeps the tree in sync without manual refresh.

## Implementation phases

### Phase 1 — Core (MVP)

1. **Notes tree view** — register `saropaWorkspace.notes` as a 6th view in the sidebar container, collapsed by default
2. **NotesProvider** — `TreeDataProvider` that reads `.saropa/notes/` (project) and `globalStorageUri/notes/` (global), returns `NoteTreeItem` rows sorted alphabetically
3. **NoteTreeItem** — renders filename, modified-date description, codicon `note` icon; click opens the file
4. **New Note command** — input box for name → creates `.md` file → opens it
5. **Delete Note command** — confirmation dialog → deletes file → refreshes tree
6. **Rename Note command** — input box → `fs.rename` → refreshes tree
7. **FileSystemWatcher** — auto-refresh on external changes
8. **i18n** — all strings externalized to `en.json` and `package.nls.json`
9. **package.json contributions** — view, commands, menus, welcome content

### Phase 2 — Organization

10. **Index file** — `.notes-index.json` for manual ordering and pinned status
11. **Pin-to-top** — inline toggle, pinned notes sort above unpinned
12. **Drag-and-drop reorder** — `TreeDragAndDropController` updates the index
13. **Tags** — freeform string tags stored in the index; filter chips in the view title
14. **Sort modes** — name / modified / manual, persisted in settings
15. **New Note from Clipboard** — pre-fills content

### Phase 3 — Cross-project and polish

16. **Move to Project / Move to Global** — file migration with collision handling
17. **Cross-project surfacing** — `showCrossProject` setting, "Other Projects" tree root
18. **Search/filter** — text filter in the view title (same pattern as the Shortcuts filter)
19. **Note preview on hover** — tooltip shows the first few lines of the note
20. **Launcher integration** — notes appear in the panel webview alongside shortcuts

## Files touched (Phase 1 estimate)

| File | Change |
|------|--------|
| `src/views/notesProvider.ts` | New — tree data provider |
| `src/views/noteTreeItem.ts` | New — tree item rendering |
| `src/commands/noteCommands.ts` | New — command handlers |
| `src/model/noteStore.ts` | New — read/write notes folder, index file |
| `src/activation/wiringViews.ts` | Register the notes view and watcher |
| `src/activation/wiringCommands.ts` | Register note commands |
| `extension/package.json` | View, commands, menus, when-clauses |
| `extension/package.nls.json` | Manifest string keys |
| `src/i18n/locales/en.json` | Runtime string keys |

## Decisions

- **Note format** — Markdown by default. The "New Note" command appends `.md` when the user omits an extension. If the user types an explicit extension (e.g. `query.sql`, `scratch.json`), that extension is used as-is — no format picker, no restriction.

## Open questions

1. **Subfolder nesting** — Should the notes folder support subdirectories rendered as collapsible groups? Adds complexity but useful for heavy note-takers. Suggest: defer to Phase 3.
2. **Note templates** — Pre-filled templates (standup, meeting notes, debug log) are a natural extension but not MVP. Defer.
3. **Max note count** — Should there be a soft limit with a warning? Thousands of files in one flat folder could slow the tree. Suggest: warn at 100, no hard cap.

## Non-goals

- Rich text editing (WYSIWYG) — VS Code's Markdown preview is sufficient.
- Note syncing across machines beyond what VS Code Settings Sync provides for global notes.
- Collaborative / shared notes — local-first principle.
- Note encryption — out of scope; users who need it can use encrypted filesystems.
