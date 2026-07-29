# Launcher panel: drag-and-drop between groups

The Launcher webview's card drag-and-drop only supported moving cards between
panes (e.g. recipes → My Shortcuts via the folded strip). Cards within a pane
could not be moved between groups — dragging a shortcut card onto a different
group header had no effect.

## Finish Report (2026-07-29)

### What changed

The Launcher webview now supports dragging a shortcut card onto a different group
header within the same pane to move it there.

**Webview (client script):**

- `launcherScriptCards.ts` — the card drag record now carries `groupId` so drop
  targets can distinguish same-group from cross-group drags; dragstart/dragend
  call `syncGroupDropTargets()` to highlight/clear eligible group headers.
- `launcherScriptCore.ts` — `canDropOnGroup(groupId)` gates on same-pane,
  different-group; `syncGroupDropTargets()` toggles `.can-drop` on all group
  elements during a drag.
- `launcherScriptRender.ts` — `makeGroup` wires the group head as a drag-over /
  drop target, posting `{ type: 'dropOnGroup', groupId, id }` to the host.
- `launcherAssets.ts` — `.group.can-drop` and `.group.drop-over` CSS affordances
  mirror the folded strip's visual pattern (inset box-shadow + drop background).

**Host (message handler):**

- `launcherViewMessages.ts` — `applyGroupDrop` parses the composite
  `"scope:rawGroupId"` format, validates the shortcut's scope and non-recipe
  status, and delegates to `store.moveShortcuts()`. The store's own `refresh()`
  drives the webview repaint.

**Tests:**

- `launcherDrop.test.ts` — 6 new tests: move into group, ungroup on bare-scope
  drop, reject recipe, reject cross-scope, reject unknown id, reject invalid
  scope.
- `launcherAssets.test.ts` — 3 new string-presence assertions for
  `dropOnGroup`, `canDropOnGroup`, and `syncGroupDropTargets`.

### Architectural note (not fixed)

The composite groupId format (`"scope:rawGroupId"`) is constructed in
`launcherItems.ts` and parsed by hand in `launcherViewMessages.ts`. A shared
helper would remove the implicit contract between the two files — flagged for a
future pass under the project's single-source-of-truth rule.
