# Plan — #17 Workspace Focus Tags

## Pain
With 50 pins across code, DevOps, and review routines, the sidebar is overwhelming.

## Target behavior
Assign tags to pins (`#dev`, `#ops`, `#review`). A filter control at the top of the Pins
view toggles the active "mode": pick **DevOps**, and only `#ops` pins (and their groups)
show; everything else hides. Clear the mode to show all.

## Approach
> Build on the shared tree-filter mechanism described in `README.md`. This is the
> primary consumer of tags as a filter facet; **#28** adds text + other facets to the
> same predicate. Do not build a second parallel filter.

### Model (`model/pin.ts`)
Add `Pin.tags?: string[]` — freeform lowercase tags without the `#`. Backward
compatible (absent = untagged).

### Filter state (`views/pinsTreeProvider.ts` or a small `pinFilter.ts`)
- A `PinFilter` holds the active tag (or set), persisted in `workspaceState`, mirrored to
  a context key `saropaWorkspace.filterActive` for the title `when` clause.
- `getChildren` applies the predicate: a pin shows when the filter is empty OR its tags
  include the active tag. A group shows only when it has at least one matching child
  (hide-empty-groups). Fire `onDidChangeTreeData` when the filter changes.

### Commands
- `saropaWorkspace.tagPin` — add/remove tags on a pin via a QuickPick of existing tags +
  "new tag" input; persists with `store.setPinTags(pin, tags)` (`mutatePin`).
- `saropaWorkspace.pickMode` — QuickPick of all tags in use → set the active filter tag.
- `saropaWorkspace.clearMode` — clear the filter (shown when `filterActive`).
- A view/title button toggles the mode picker; the title shows the active mode (and a
  count of hidden pins) so a filtered tree never looks empty-by-bug.

### Tree affordance (`views/pinTreeItem.ts`)
Append the pin's tags to its tooltip (and optionally a `#ops` chip in the description),
so tags are discoverable without opening the editor.

## Files & changes
- `model/pin.ts` — `tags?` field.
- `model/pinStore.ts` — `setPinTags`; helper to enumerate tags in use.
- `views/pinsTreeProvider.ts` (+ optional `views/pinFilter.ts`) — the shared filter
  predicate + state + context key.
- `views/pinTreeItem.ts` — tags in tooltip/description.
- `package.json` / nls / en.json — commands, title menu, context key `when`, strings.

## Deviations / limits
- "Gracefully hide / animate" is an instant filter refresh (no TreeView row animation).
- Distinct from the existing `commands/focusMode.ts`, which hides Explorer files via
  `files.exclude`. This filters the Saropa tree only; keep the two clearly separate in
  naming and copy ("Focus mode" = Explorer; "Mode/Tag filter" = Pins view).

## Risks / blast radius
- **Shared tree provider** is the contention point — land the filter mechanism once and
  have #28 extend it. A filtered, empty-looking tree must always show a visible "filter
  active — N hidden, clear filter" affordance so the user never thinks pins were lost.

## Verification
`tsc` + `esbuild`; manual: tag pins, switch modes, confirm only matching pins/groups
show and the clear-filter affordance is visible and works.

## Complexity & risk
Moderate. The model + commands are simple; the care is in the shared filter design and
the never-silently-empty guarantee.
