# Plan — #28 Instant Search & Chip Filters (The "Find it Now" Bar)

## Pain
With 60 pins across 8 nested groups, finding `flush_redis` means expanding folders and
scrolling past 20 unrelated pins.

## Target behavior
Filter the Pins tree by text and by facet chips (Scripts / Files / Failed / a tag). Type
"redis" or pick a chip, and the tree collapses to matches, hiding empty groups; clear to
restore.

## Approach
> This is the first/primary consumer of the **shared tree-filter mechanism** (see
> `README.md`). Build the predicate + filter state here; **#17** adds tags as another
> facet on the same predicate. Do not build two filters.

### Filter state (`views/pinFilter.ts` or in the provider)
- A `PinFilter` holding `{ text?: string; kinds?: PinKind[]; failedOnly?: boolean;
  tag?: string }`, persisted in `workspaceState`, mirrored to context keys
  (`saropaWorkspace.filterActive`, and per-chip keys for toggle state).
- `getChildren` applies the predicate to pins (label/path/command text contains `text`;
  kind ∈ kinds; last-run failed when `failedOnly`; tag match for #17). Groups show only
  when they contain a match (hide-empty-groups). Fire `onDidChangeTreeData` on any change.

### Why not a real search box
A VS Code `TreeView` has **no API for a custom header input field**. The native
type-to-search ("Find" in the tree) exists but is transient and label-only. So the
"persistent box" is delivered as:
- `saropaWorkspace.filterPins` — an `InputBox` (or a live QuickPick) that sets the text
  filter; the active filter string is shown in the **view title** (`TreeView.message` or a
  title-bar indicator) so it reads as persistent.
- Chip toggles as **view/title buttons** with toggled state via context keys:
  `[Scripts] [Files] [Failed]`, each a command flipping its facet. The active-filter
  indicator + a **Clear filters** title button complete the bar.

### Commands
- `filterPins` (set text), `toggleFilterScripts` / `toggleFilterFiles` /
  `toggleFilterFailed` (facets), `clearPinFilter`. The tag facet command is shared with
  #17's mode picker.

## Files & changes
- `views/pinFilter.ts` (new) or provider-local — filter state + predicate + context keys.
- `views/pinsTreeProvider.ts` — apply the predicate in `getChildren`; set
  `TreeView.message` to the active-filter summary; hide empty groups.
- `extension.ts` — own the `TreeView` reference to set `.message` (the provider may not
  hold it).
- `package.json` / nls / en.json — the filter + chip + clear commands, title-bar buttons
  with `when`/toggled context keys, strings.

## Deviations / limits
- **No in-sidebar persistent text box** (TreeView API limit). Delivered as an InputBox-set
  filter + a visible title indicator + chip buttons + clear — the same outcome (fast
  filter to target) via the affordances the API allows. State this clearly.
- Emoji chip glyphs from the pitch become codicons (the manifest/title uses codicons, not
  emoji).

## Risks / blast radius
- **Shared tree provider** — this is the foundation #17 builds on; design the predicate to
  compose facets cleanly. A filtered tree must **always** show a visible "filter active —
  N hidden — clear" affordance (`TreeView.message`) so the user never thinks pins vanished.

## Verification
`tsc` + `esbuild`; manual: with many pins, set a text filter and confirm only matches +
their groups show; toggle Failed and confirm only failed pins remain; clear and confirm
full restore; verify the active-filter message is always visible while filtering.

## Complexity & risk
Moderate. The predicate + persistence are simple; the care is the title-bar affordances
(API-constrained) and the never-silently-empty guarantee, shared with #17.
