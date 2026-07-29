# Launcher panel: drag-and-drop between groups

The Launcher webview's card drag-and-drop only supported moving cards between
panes (e.g. recipes → My Shortcuts via the folded strip). Cards within a pane
could not be moved between groups — dragging a shortcut card onto a different
group header had no effect, and there was no way to reorder cards within a group.

## Finish Report (2026-07-29)

### What changed

The Launcher webview now supports dragging a shortcut card onto a different group
header to move it there, and onto another card to reorder (insert before the
target). Several hardening fixes were applied to the initial implementation.

**Shared helpers (`shortcutStoreShared.ts`):**

- `compositeGroupId(scope, groupId)` builds the `"scope:rawGroupId"` format.
- `parseCompositeGroupId(composite)` parses it back, returning `undefined` for
  invalid scopes. Both `launcherItems.ts` and `launcherViewMessages.ts` now use
  these instead of inline string operations, closing the implicit-contract gap.

**Webview (client script):**

- `launcherScriptCards.ts` — the card drag record carries `groupId`; each card is
  also a drop target (dragover/dragleave/drop) posting `dropOnCard` to the host.
  `effectAllowed` is `copyMove` (was `copy`). `dragleave` checks
  `relatedTarget` containment to prevent flicker when moving between child elements.
- `launcherScriptCore.ts` — `canDropOnGroup(groupId)` gates on same-pane,
  different-group; `canDropOnCard(targetId)` gates on same-pane, different-card.
  `syncGroupDropTargets()` toggles `.can-drop` on group elements during a drag.
  `syncCardDropTargets()` clears card `drop-over` on dragend (cards do not show
  `can-drop` to avoid visual noise).
- `launcherScriptRender.ts` — `makeGroup` wires the group head as a drop target,
  posting `dropOnGroup` to the host. `dragleave` checks `relatedTarget`
  containment to prevent flicker on child-element transitions.
- `launcherAssets.ts` — `.group.can-drop` and `.group.drop-over` CSS affordances
  on group headers; `.card.drop-over` shows a top-border insertion indicator on
  the hovered card.

**Host (message handler):**

- `launcherViewMessages.ts` — `applyGroupDrop` uses `parseCompositeGroupId`,
  accepts an optional `beforeShortcutId`, and delegates to `store.moveShortcuts()`.
  Handles both `dropOnGroup` (no before) and `dropOnCard` (before = target id)
  messages.

**Tests (1106 total, 0 failures):**

- `shortcutStoreShared.test.ts` — 4 new tests for `compositeGroupId` /
  `parseCompositeGroupId` (round-trip, bare scope, invalid scope).
- `launcherDrop.test.ts` — 10 new tests covering group drop (move, ungroup,
  reject recipe/cross-scope/unknown/invalid) and card drop (reorder, ungroup +
  reorder, reject recipe, reject cross-scope).
- `launcherAssets.test.ts` — 6 new string-presence assertions for `dropOnGroup`,
  `dropOnCard`, `canDropOnGroup`, `canDropOnCard`, and `relatedTarget` flicker
  guard.
