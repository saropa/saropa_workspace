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

## Finish Report (2026-06-25)

Status: Implemented.

### Outcome
Workspace focus tags ship as a facet of the existing shared Pins-view filter
(`views/pinFilter.ts`), not a second filter. A pin carries freeform lowercase
`tags`; the view can be narrowed to one tag ("mode"), collapsing the tree to the
matching pins and the groups that hold them, with the active mode and a hidden
count always shown in the filter banner.

### What was already present
The shared filter mechanism this plan depended on (originally scoped under #28,
"instant search & chip filters") existed before this work: `PinFilter`,
`PinFilterState`, `pinMatchesFilter`, `countHidden`, `filterMessage`,
`isFilterActive`, the find-bar commands in `commands/filterCommands.ts`, the
provider wiring in `views/pinsTreeProvider.ts` (predicate application, hide-empty
groups, matching counts), and the `extension.ts` message/context-key sync. The
model field `Pin.tags` and the store methods `setPinTags` / `tagsInUse` were also
already in place. This work added only the tag facet and its UI on top.

### Changes
- `views/pinFilter.ts` — added the `tag` facet: a field on `PinFilter`, a branch in
  `pinMatchesFilter` (a pin must carry the active tag; an untagged pin is hidden by
  any tag mode), inclusion in `isFilterActive` and `filterSummary`, and
  `setTag` / `getTag` / `clearTag` on `PinFilterState`. `clearTag` drops only the
  tag facet, so a mode composes with any active text/kind/failed facet.
- `views/pinTreeItem.ts` — `#ops` chips appended to the row description and a tags
  line in the hover; both suppressed when a pin is untagged.
- `commands/tagPin.ts` (new) — the Tag Pin action: a multi-select of tags in use
  (pre-checking the pin's current tags) plus a "new tag" prompt; rejects auto and
  recipe pins (recomputed, not stored).
- `commands/filterCommands.ts` — `pickMode` (single-select tag picker with a
  "show all" entry) and `clearMode`; took a `PinStore` argument to read tags in use.
- `commands/pinCommands.ts` — registered `saropaWorkspace.tagPin`.
- `extension.ts` — passed the store into `registerFilterCommands`.
- `package.json` / `package.nls.json` / `i18n/locales/en.json` — the three commands,
  the toolbar mode button, the per-pin Tag action, command-palette gating, and the
  `tag.*` / `mode.*` / `filter.facet.tag` strings.

### Deviations from the plan
- `clearMode` clears only the tag facet; the existing generic Clear button still
  clears every facet. The plan described `clearMode` as "clear the filter" — scoping
  it to the tag keeps the single-shared-filter contract intact.
- The "active mode + N hidden" affordance reuses the shared filter banner (which now
  names the tag) rather than a #17-only message, per "do not build a second filter".
- README was not extended: the sibling filter feature shipped without a README
  section, the plan's file list did not include README, and the CHANGELOG carries the
  user-facing announcement.

### Verification
- `tsc -p ./ --noEmit` — clean.
- `node esbuild.js` production-equivalent bundle — built.
- New unit test `src/test/pinFilter.test.ts` (6 cases: tag match / miss / untagged
  hidden / no-tag shows all / `isFilterActive` with a tag / tag composes with the
  kind facet) — all pass under `node --test`.
