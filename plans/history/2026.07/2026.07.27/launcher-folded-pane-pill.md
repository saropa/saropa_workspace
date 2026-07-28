# Launcher: a folded pane's head reads as a pill, not a cut-off section header

A collapsed pane in the Saropa Launcher webview shed its width but kept the styling of an
open section header — an `auto`-width `border-bottom` under an uppercase title. At label
width that chrome stopped reading as a header and started reading as a broken-off table
header: four stray underlined fragments floating in the empty space beside the one open
pane.

## Finish Report (2026-07-27)

### Defect

`launcherAssets.ts` gave a collapsed pane `flex: 0 1 auto` and its head `width: auto`, and
changed nothing else about the head. Every other declaration on `.pane-head` was authored for
a full-width section header:

- `border-bottom: 1px solid var(--vscode-widget-border, …)` — a divider that separates a
  header from the body beneath it. With no body rendered and an auto-width box, it becomes a
  short underline sitting under a fragment of text, attached to nothing.
- `text-transform: uppercase; letter-spacing: 0.05em` on `.pane-title` — correct for a
  standing section header, but it makes a shrunken head still claim to be one.
- `padding: 6px 2px 4px; margin-bottom: 4px` — 2px of horizontal padding is invisible at full
  width and leaves the label touching the box edge once the box is only as wide as the label.

The panel is wide and short, so with one pane open and four folded, the four folded heads all
land on the open pane's header line (the `.panes` flex row is `align-items: flex-start`) and
occupy the dead space to its trailing edge. That placement is correct — it costs no vertical
space in a surface where vertical space is the scarce axis — but the styling made the row read
as debris rather than as four controls.

### Change

`.root:not(.searching) .pane.collapsed .pane-head` restyles the folded head as a pill:

- `border: 1px solid var(--vscode-widget-border, var(--vscode-editorWidget-border, transparent))`
  — the shorthand replaces the section-header underline with a full box.
- `border-radius: 999px` plus `background: var(--vscode-editorWidget-background, transparent)`
  and a `:hover` fill, so the pill reads as tappable.
- `padding: 5px 10px 4px` — the horizontal padding gives the label room inside the box; the
  vertical padding is chosen so the pill's text shares a baseline with the open pane's title
  (1px border + 5px padding equals the open `.pane-head`'s 6px top padding). Without that the
  strip rode ~3px high against the section title beside it.
- `gap: 5px` (from 7px) and `margin-bottom: 0`, since neither the header's breathing room nor
  its divider margin applies to a pill.

The rule is gated to `.root:not(.searching)`, matching the width rule directly above it: a
search force-reveals a folded pane's body (`.root.searching .pane .pane-body`), at which point
the pane is full width again and needs its header styling back. Selector specificity (three
classes) beats the base `.pane-head` rule regardless of source order, so the `border` shorthand
reliably overrides the base `border-bottom`.

### Alternative considered and rejected

Moving the folded heads onto their own full-width row above the open panes (a flex line break,
or stacking them one per row). Rejected: the launcher lives in the bottom panel, which is wide
and short. Stacking four folded sections spends up to four rows of the scarce vertical budget
to display four labels, while the inline strip costs zero — the folded heads sit in space the
open pane's header row was already leaving empty.

### Verification

- `npx tsc -p ./ --noEmit` — clean.
- `node esbuild.js` — bundle builds.
- `node --test out/test/launcherAssets.test.cjs` — 35/35 pass, including a new guard
  (`a folded pane's head reads as a pill, not a cut-off section header`) asserting the folded
  head rule exists, carries `border-radius: 999px`, and carries a full `border: 1px solid`
  rather than the section-header underline.

The aggregate `npm test` run fails across essentially every file in `out/test/`, including
files untouched here (`doubleClick`, `favorites*`, `gitBranch`). That failure predates this
change and was not investigated.

### Style guide

`plans/guides/STYLEGUIDE.md` §1.1a gains the general rule this change instantiates: when a
control shrinks, restyle it for the size it lands at — full-width chrome (dividers, uppercase
section titles, header padding) must not ride along at chip size. The same section's stale
description of the panes track (`repeat(auto-fit, minmax)`) was corrected to the wrapping flex
line the code actually uses, since a grid track cannot shed a folded item's `minmax` width and
that is precisely why the layout is flex.

### Flagged, not fixed (separate workstream)

A review pass over the shared working tree found a defect in
`extension/src/model/shortcutStoreRecipeGroups.ts` (the "Daily Routines" rename work, authored
elsewhere and not part of this change). The new guard `r.group !== "scheduled"` in
`selectRecommendedRecipes` is intended to exclude rituals already visible in their own category
group, but `detectScheduledRecipes` (`extension/src/recipes/scheduledRecipes.ts:157-159`) stamps
`group = "scheduled"` on every item it returns unconditionally — asserted by
`extension/src/test/scheduledRecipes.test.ts:106`. The guard is therefore always false in
production, and step 1 of `selectRecommendedRecipes` ("every disabled scheduled ritual first")
is dead code: no disabled ritual can reach the Recommended shelf.

The existing test `extension/src/test/shortcutStoreShared.test.ts:104-114` passes but does not
cover this: its `scheduledRecipe()` helper leaves `group` undefined, so the guard evaluates
`undefined !== "scheduled"` and the ritual is admitted — the opposite of production behavior.
A test that builds the recipe the way `detectScheduledRecipes` does would fail and expose it.
