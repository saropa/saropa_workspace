# Planner — Workflow tab usability and inspectable schedule items

The Schedule & Workflow Planner had two usability defects: scheduled items in the
Day/Week views could be clicked but the detail strip rendered below a full-height
grid where the change went unseen, and the Workflow tab dumped every pin — almost
all of them unchained — into a single vertical column, producing an effectively
infinite scroll with no clear way to use the surface. This work makes scheduled
items inspectable, separates the workflow graph from the un-wired pins, and
surfaces the previously hidden link builder.

## Changes

### Click an item to see its detail (Day/Week views)
- `select()` in `extension/src/views/plannerScript.ts` now toggles a selected
  outline on Week blocks (`.block.sel`), Day markers (`.marker.sel`), and shelf
  chips (`.shelf-pin.sel`), and scrolls the detail strip into view when a pin is
  selected outside the Workflow view. Previously the detail strip updated below a
  720px-tall grid, so a click appeared to do nothing.
- `mk.dataset.id` is set on Day markers so selection can target them.

### Compact / comfortable row density (Day/Week grids)
- A `density` state ('compact' | 'comfortable') drives a single `hourH` source
  (30px / 60px). `applyDensity()` writes both the `--hour-h` CSS variable (grid
  lines, gutter) and `HOURH()` (block geometry, now-line), keeping the two layers
  in sync from one value. Comfortable doubles the per-hour height so tightly
  stacked morning clusters become readable.
- A toolbar toggle button (`id="density"` in `plannerPanel.ts`) flips the mode;
  the choice persists in webview state alongside `view` and `shelfOpen`.

### Workflow tab: canvas vs. shelf
- `workflowNodes()` now returns only pins that take part in an edge (a chain or
  event link) plus the wired event nodes; `shelfPins()` returns the rest. This
  removes the unchained-pin tower that caused the infinite scroll.
- Un-wired pins render in a compact, collapsible **Unlinked pins** shelf below the
  canvas as a wrapped chip grid. Dragging a chip onto a canvas step adds a trigger
  so the dropped pin runs after that step; gaining an edge moves it onto the
  canvas, so the shelf only ever holds un-wired pins. The collapsed state persists.
- A shelf filter box appears only past `SHELF_FILTER_AT` (12) pins. It hides
  non-matching chips live via `style.display` rather than re-rendering, so a drag
  in progress is never interrupted, and shows a no-match note.
- `fitCanvasHeight()` sizes the canvas to its content (floor 420px) instead of a
  fixed 560px, removing dead scroll space.
- An always-visible how-to band states the gestures and carries an **Add link**
  button (opens the same searchable pin link builder as the canvas right-click,
  which was undiscoverable) and an **Auto-arrange** button that re-lays chains into
  tidy layered columns.
- An empty-canvas state explains how to start when no pins are chained yet.

## Internationalization note

The planner webview's injected client script (`PLANNER_SCRIPT`) runs in the
browser context and cannot call the host-side `l10n` helper, so its display
strings are inline by architecture. The new strings follow that existing
convention. The previously-undocumented exception was recorded in
`plans/guides/STYLEGUIDE.md` section 2 (Internationalization), including the
proper fix path (a host-to-webview string map injected at render time) for when
client-script localization is prioritized.

## Verification

- `npx tsc -p ./ --noEmit` — clean.
- `node esbuild.js` — bundle builds.
- `npm run test:unit` — 724 pass, 0 fail. The `PLANNER_STYLE` invariant tests
  (theme binding, no stray non-brand hex, reduced-motion guard, color-scheme)
  cover the new CSS; the additions use `color-mix`/`var()` only, no raw hex.
- Webview DOM interactions (drag, filter, scroll, selection) are not unit-testable
  under the project's `node --test` harness, which has no DOM and no `vscode`
  host; per `.claude/rules/test.md` such host-dependent assertions are kept out
  until a `@vscode/test-electron` harness exists.
