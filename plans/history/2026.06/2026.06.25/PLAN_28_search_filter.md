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

## Finish Report (2026-06-25)

Shipped the instant text + facet-chip filter for the Pins view as the primary
consumer of the shared tree-filter mechanism.

### What was built
- `extension/src/views/pinFilter.ts` (new) — the shared filter mechanism. Holds the
  `PinFilter` state shape (`text?`, `kinds?`, `failedOnly?`), the `PinFilterState`
  class (persisted in `workspaceState` under `saropaWorkspace.pinFilter`, with an
  `onDidChange` event and one mutator per facet), the pure `pinMatchesFilter`
  predicate, and the chip-state / hidden-count / message helpers. The state shape and
  predicate are the single surface #17 (workspace focus tags) extends — it adds one
  optional `tag` field and one predicate branch rather than building a parallel filter.
- `extension/src/commands/filterCommands.ts` (new) — the "find it now" bar. A
  `TreeView` has no API for a persistent header input, so the bar is delivered as a
  single `InputBox`: `onDidChangeValue` applies the text facet live (the tree collapses
  to matches as the user types), and three title-area buttons toggle the Scripts /
  Files / Failed facets (lit with `$(check)`), plus a Clear button. The three facet
  toggles are also standalone palette commands (`toggleFilterScripts/Files/Failed`) so
  they are independently invokable and reusable by #17.
- `extension/src/views/pinsTreeProvider.ts` — applies the predicate in `getChildren`
  via a `matches(pin)` helper (always true when no filter is set, so the unfiltered
  tree is unchanged). Hides empty groups and empty scope roots while filtering; header
  counts show the matching count while active. A `scopePins(scope)` helper excludes
  recipe pins so the hidden-count population matches what the headers render.
- `extension/src/extension.ts` — constructs `PinFilterState`, passes it to the provider,
  registers the filter commands, and owns the `TreeView` to keep the chip context keys
  (`filterActive`, `filterScripts`, `filterFiles`, `filterFailed`) and the always-visible
  `TreeView.message` ("Filter: … — N hidden — clear …") in sync on every filter change
  and every store change. The message is the never-silently-empty guarantee.
- Manifest + strings: six commands, the toolbar buttons (`$(filter)` → `$(filter-filled)`
  when active, plus Clear, gated on `filterActive`), command-palette entries,
  `package.nls.json` titles, and `en.json` runtime strings.

### Deviations from the pitch (as planned)
- No in-sidebar persistent text box (TreeView API limit) — delivered as the InputBox
  find bar + a visible title-bar indicator/message + chip buttons + clear.
- Chips are toggle buttons inside the find bar (with explicit on/off state) rather than
  separate title-bar toggle icons: a title button cannot show toggled state, and a
  single surface for text + chips matches the pitch's "find bar with chips" better.
- The `tag` facet is left as the documented extension point for #17 (one field + one
  predicate branch); `model/pin.ts` was not touched, keeping #17's `tags?` field in its
  own scope. This is intentional, not a dead field.
- Emoji chip glyphs became codicons (`$(terminal)`, `$(file)`, `$(error)`, `$(filter)`).

### Verification
`node esbuild.js` bundles clean. The filter modules are type-clean: a full `tsc`
reports exactly two errors, both in a separate in-flight workstream (a `ChainRunner`
constructor-arity change and an `idle` trigger kind in `plannerPanel.ts`), neither in
the files this change touched. The repo has no test harness (`npm test` points at a
`runTests.js` that has never been created), so no automated tests were run; the predicate
is a pure function and was validated by inspection.
