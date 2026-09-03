# Notes — Phase 2 (Organization) and Phase 3 (Cross-project and polish)

Continuation of the Notes feature. Phase 1 (Core MVP) shipped — see [history](history/2026.07/2026.07.29/notes-scratchpad.md).

## Phase 2 — Organization

11. **Index file** — `.notes-index.json` for manual ordering and pinned status
12. **Pin-to-top** — inline toggle, pinned notes sort above unpinned
13. **Drag-and-drop reorder** — `TreeDragAndDropController` updates the index
14. **Tags** — freeform string tags stored in the index; filter chips in the view title
15. **Sort modes** — name / modified / manual, persisted in settings

## Phase 3 — Cross-project and polish

16. **Move to Project / Move to Global** — file migration with collision handling
17. **Cross-project surfacing** — `showCrossProject` setting, "Other Projects" tree root
18. **Search/filter** — text filter in the view title (same pattern as the Shortcuts filter)
19. **Note preview on hover** — tooltip shows the first few lines of the note
20. **Launcher integration** — notes appear in the panel webview alongside shortcuts

## Open questions (carried from Phase 1)

1. **Subfolder nesting** — Should the notes folder support subdirectories rendered as collapsible groups? Adds complexity but useful for heavy note-takers. Suggest: defer to Phase 3.
2. **Note templates** — Pre-filled templates (standup, meeting notes, debug log) are a natural extension but not MVP. Defer.
3. **Max note count** — Should there be a soft limit with a warning? Thousands of files in one flat folder could slow the tree. Suggest: warn at 100, no hard cap.

## Known limitations from Phase 1

- Multi-root workspaces: only the first workspace folder's `.saropa/notes/` is used for project notes.
- No watcher debouncing at the store level (debounced at the wiring layer).
