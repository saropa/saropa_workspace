# Plan: Launcher panel restructure — one flexible panel component, not six panes

## The problem, precisely

The Launcher (`saropaWorkspace.launcher`, the horizontal webview docked in
VS Code's bottom Panel area alongside Terminal/Output/Problems) merges six
content sources — Shortcuts, Recipes, Watches, Files, Scripts, Notes — into
two side-by-side flex panes, each with its own stat-chip toggle in a custom
HTML header row. In practice, a real workspace produces something like:
4 curated shortcuts next to 48 auto-detected recipes, 6 files, and 7
scripts — all rendered with equal visual weight, so the header (title,
version badge, star icon, four separate stat chips, an eye icon, a gear, a
search icon, a search box with its own counter badge) fights the four
small cards that are actually the point. Getting to the content you
curated requires manually toggling off everything else, every session.

Adding Mobile Remote Control (the adb command catalog) as a seventh
pane/chip would make this strictly worse — one more thing to manage, not
one more useful surface.

## The actual fix: fewer parallel regions, not smarter defaults on the same regions

Two earlier ideas were both wrong in the same way — they preserved "many
categories all visible at once" and just tried to make the visibility
smarter (auto-collapse unused ones, remember state, etc.). The real
problem is the *count of parallel regions* competing for one horizontal
strip, not their individual default state. The fix is structural:
**collapse six-plus panes down to one category list plus one content
area**, using a single generic panel component everywhere a panel is
needed — not a special-cased "rail" on the left and a different "column"
widget on the right.

## Target layout

- **Left panel** (resizable, collapsible): a flat list — **All** at the
  top, then one entry per category (Shortcuts, Recipes, Watches, Files,
  Scripts, Notes, **Mobile Remote Control**). Selecting a category filters
  the center area to just that category. Selecting **All** shows
  everything, grouped by category.
- **Center**: the existing card grid (CSS Grid, `repeat(auto-fill,
  minmax(247px,1fr))`), unchanged — it already works well and just needs
  to render whichever item set the left panel's selection resolves to.
- **Right panel** (resizable, collapsible, off by default): an adb
  run-history list (built new for this step — direct investigation found
  no existing rendered history table anywhere in this codebase; see
  `launcherRunHistory.ts`'s own header comment for the full correction).
  **Not** a live adb output/terminal stream — see "Explicitly deferred"
  below for why.
- **Title bar**: search is **always visible** (not an icon-triggered
  popover) and typing into it **always switches the selection to All**,
  so a search is never silently scoped to whatever category happened to
  be selected. Sort and settings/config move out of the custom in-content
  header and into the native VS Code panel title bar (the same chrome
  strip that already carries the maximize/fullscreen and close icons),
  using `contributes.menus["view/title"]` — the same mechanism the
  Shortcuts tree view already uses for its own title-bar icons. If three
  separate icons risk overflowing into VS Code's "…" menu in a narrow
  panel, bundle sort+settings under one overflow icon (the Shortcuts view
  already does this for its own less-common actions) and leave search as
  its own always-visible element.
- **One generic panel component**, used identically for the left list and
  the right table — same resize handle, same collapse behavior, same
  persisted width — not two different widgets with different mechanics.

## What's reusable, and what's new

Confirmed by direct investigation of the current code — this section
exists so implementation doesn't re-derive it:

- **Resizable panels**: no split-view exists in the Launcher today (its
  two-pane layout is a responsive flex-wrap reflow, not a resizer). One
  real drag-resize implementation exists elsewhere in this codebase
  though — the Planner webview's `attachResizer()`
  (`src/views/planner/plannerScriptCore.ts`) plus its CSS handle
  (`src/views/plannerAssets.ts`). Port that pattern rather than writing a
  new one. It has no built-in collapse-to-hidden behavior; pair it with
  the Launcher's own existing hidden/toggle persistence idiom
  (`setPaneHidden`/`isPaneHidden` in `src/views/launcher/launcherScriptCore.ts`)
  for the collapse behavior.
- **`view/title` icons on a webview view**: confirmed to work identically
  to a tree view (it's a platform mechanic keyed on the view's `id`, not
  its content type). `saropaWorkspace.launcher` currently has zero such
  entries — `saropaWorkspace.pins` and the other tree views already do,
  and are the pattern to copy. One new wrinkle: a title-bar action whose
  effect is inside the webview (e.g. "focus search") needs a *new*
  host→webview `postMessage` direction — today the host only ever pushes
  full data payloads unprompted; it never nudges the webview's own UI
  state. This is a small addition, not a redesign of the protocol.
- **Category data model**: `LauncherItem.pane`
  (`src/views/launcherItems.ts`) is already exactly the right per-category
  key for the six existing sources, but it's a closed TypeScript union
  that needs widening to add `"mobileRemote"`, with every switch over it
  updated (the client's pane-grouping table, the header's stat-count
  pushes). There's no existing host-side "grouped category list with
  counts" builder — only an inline per-pane counter — so a small new pure
  function is warranted (not a big lift).
- **Mobile Remote Control as a category**: the adb catalog's existing pure
  builders (`ADB_COMMAND_CATALOG`, `groupAdbCatalog`, `resolveAdbCommand`,
  and the wire-model builder in `src/views/remoteControl/remoteControlData.ts`)
  already do 100% of "turn the catalog into resolved rows" — reuse them
  directly via a new thin adapter that maps each resolved entry into a
  `LauncherItem`, following the exact shape of the four existing
  per-source adapters (`launcherWatchItem.ts`, `launcherFileItem.ts`,
  etc.). Running/pinning a card routes through the existing
  `runAdbCommand()` (`src/views/remoteControl/remoteControlActions.ts`) —
  no new execution path.

## Explicitly deferred: live adb output in the right panel

Adb commands currently always run in a fresh VS Code integrated terminal
(`useIntegratedTerminal: true`, hardcoded in `runAdbCommand()`), and
**a VS Code extension cannot read a terminal's output back** — that's a
platform limitation, not a gap in this codebase. Making the right panel
show real, live command output would require switching adb runs onto a
captured/background execution path (one exists — `runInBackground` +
`BoundedCapture` in `src/exec/outputCapture.ts` — but adb runs don't use
it today) plus a new streaming event mechanism that doesn't exist
anywhere in `src/exec/` yet. It would also change the interaction model:
a captured run can't be typed into or interrupted the way a real terminal
can.

Given that cost and behavior change, this plan ships the right panel as
a small new run-history list built from data that already exists
(`exec/adbRunHistory.ts`'s `recent()`/`counts()`, previously used only to
bias the standalone panel's search ranking — zero new tracking/storage,
zero behavior change to how commands actually run) and defers live output
streaming as a clearly-separate follow-on decision, not something bundled
into this rework.

## Build order

1. Port the generic resizable/collapsible panel component (from Planner's
   `attachResizer` + CSS handle) as a shared Launcher fragment; wire it to
   left and right panel slots with persisted widths and collapsed state.
2. Widen `LauncherItem.pane` to include `"mobileRemote"`; add the
   `launcherAdbItem.ts` adapter reusing the existing adb catalog builders;
   thread an `AndroidProjectProfile` into `buildAllItems()` the same way
   `remoteControlPanel.ts` already resolves one.
3. Add the host-side category-list builder (`buildCategoryList()` or
   similar) feeding the left panel; wire left-panel selection to filter
   the center grid (client-side, no new host message needed unless
   selecting Mobile Remote Control requires data the host hasn't already
   pushed).
4. Move search to an always-visible title-bar element; wire it so typing
   forces the selection to "All" regardless of current category.
5. Add `view/title` icon contributions for sort/settings (bundled under
   one overflow icon if needed); wire the new host→webview nudge message
   for any action whose effect lives inside the webview.
6. Build the right panel's adb run-history list from `adbRunHistory`'s
   existing recency/count data (no existing rendered table turned out to
   exist to reuse — see the "Right panel" bullet above).
7. Remove the now-redundant custom header decoration (stat chips, gear,
   search icon+box, star icon) once its functions have moved into the
   left panel / title bar.
8. Tests for every new pure function (category list builder, the adb
   adapter, the widened pane union's exhaustiveness); manual verification
   of resize/collapse/persist behavior (not unit-testable — no split-view
   test harness in this codebase).
