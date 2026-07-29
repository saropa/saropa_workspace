# Plan: redesign the launcher's folded strip as a connected segmented bar

Status: planned, not started. Written for a developer new to this codebase — read the "How this code is put together" section before touching anything.

## The problem

In the Saropa Workspace panel (the launcher webview), collapsing a section moves it into a horizontal strip at the top of the board, where it renders as a standalone rounded pill: chevron hidden, then icon + UPPERCASE TITLE + count, each pill bordered on its own, with a 6px gap between pills, floating over empty background. With several sections collapsed this reads as scattered text buttons in dead space (developer feedback 2026-07-29), not as a control.

Note: this is the bottom **Panel** webview, not the activity-bar sidebar. The sidebar uses native tree views and is out of scope. Do not change anything under the sidebar providers (`shortcutsTreeProvider.ts`, `recipesTreeProvider.ts`, etc.).

## The design

Turn the strip into one **connected segmented bar**, like a toolbar button group:

1. **Segments touch.** No gap between collapsed pills. They share dividers (a 1px line between neighbors), and only the bar's outer corners are rounded — not each segment.
2. **Icon + count only.** The text label is visually hidden inside the strip. The section's codicon (star, clock, eye, files, library) identifies it; the count stays as a small number beside the icon. The existing "Show {name}" tooltip and the accessible name cover discoverability.
3. **The bar is a visible band.** The strip container gets its own background fill and outer border, so it reads as a deliberate region even before you notice the segments.

Everything else about the strip's behavior stays exactly as it is: click to expand, drag a segment to reorder the strip, drop a card on a segment to file it into that section, search force-expands all panes.

## How this code is put together (read first)

- The launcher webview's **client-side JavaScript is authored as TypeScript template strings**. Files under [extension/src/views/launcher/](../extension/src/views/launcher/) each export a `LAUNCHER_SCRIPT_*` string constant; `launcherScript.ts` concatenates them into ONE `<script>` tag. They share one global scope, so a function defined in one fragment is callable from another. You are editing string literals that contain JavaScript — the TypeScript compiler does not check the code inside them, so a typo there only shows up at runtime in the dev host.
- The **CSS lives in a template string too**, in [launcherAssets.ts](../extension/src/views/launcherAssets.ts).
- The strip mechanics live in [launcherScriptFolded.ts](../extension/src/views/launcher/launcherScriptFolded.ts): `makePaneHead()` builds each pane's header button (which becomes the pill when folded), `placePanes()` moves each pane between the open-panes row and the folded strip, `wirePaneDrag()` handles reorder + card drops, `syncDropTargets()` lights up valid drop targets during a drag.
- DOM shape: the strip is `<div class="folded">`, containing whole `<div class="pane collapsed">` elements; each pane's first child is the `<button class="pane-head">` holding `.pane-chevron`, `.pane-glyph`, `.pane-title`, `.pane-count`. When a pane is in the strip, only its head is visible (`.pane-body` is `display: none` via `.pane.collapsed`).

## Changes

All changes are in [extension/src/views/launcherAssets.ts](../extension/src/views/launcherAssets.ts) — this is a CSS-only redesign except for one accessibility check at the end. Do not edit `launcherScriptFolded.ts` unless the accessibility check (step 5) fails.

### Step 1 — make the strip container a band

Find the `.folded` rule (around line 173). Today it is a wrapping flex row with `gap: 6px`. Change it to:

```css
.folded {
  display: flex; flex-wrap: wrap; align-items: stretch;
  gap: 4px 0;
  margin-bottom: 10px;
  border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border, transparent));
  border-radius: 6px;
  overflow: hidden;
  width: fit-content;
  max-width: 100%;
  background: var(--vscode-editorWidget-background, transparent);
}
```

Why each piece:

- `gap: 4px 0` — zero column gap makes segments touch; the 4px row gap only matters when a narrow panel wraps the bar onto a second line.
- `border` + `border-radius` + `overflow: hidden` on the **container** gives the bar rounded outer corners while the segments inside stay square. This sidesteps the ":first visible child" problem — a pane can be `.hidden`, so `:first-child` selectors on segments are unreliable for corner rounding.
- `width: fit-content` — the band hugs its segments instead of stretching a full row of background across the panel.
- `align-items: stretch` — every segment matches the tallest, so dividers run full height.
- Keep the fallback-chain style used throughout this file: every `var()` chain must end in a static keyword (see the comment at line 196 for why — an all-undefined chain drops the declaration entirely).

### Step 2 — turn pills into segments

Find the `.folded .pane-head` rule (around line 187). Replace the pill styling:

```css
.folded .pane-head {
  width: auto;
  height: 100%;
  gap: 5px;
  padding: 5px 10px;
  margin-bottom: 0;
  border: none;
  border-radius: 0;
  background: none;
}
```

Then add dividers between neighboring segments. The border goes on the **pane wrapper**, not the head, because `placePanes()` reorders panes by re-appending them and the wrapper is what sits in the flex row:

```css
.folded .pane + .pane { border-left: 1px solid var(--vscode-widget-border, var(--vscode-panel-border, transparent)); }
```

`.pane + .pane` (adjacent sibling) is deliberate: a `.hidden` pane still occupies a DOM slot, so `:not(:last-child)` would draw a divider before nothing. With `+` the worst case is one divider next to a hidden pane, which `display: none` on the hidden pane collapses anyway.

Keep the existing `.folded .pane-head:hover` rule but confirm it still reads well without the per-pill border — the hover background fill is now the only hover cue, which is fine (that is how VS Code's own toolbar buttons behave).

### Step 3 — hide the text label inside the strip, keep it accessible

Add a rule that visually hides `.pane-title` inside the strip **without** removing it from the accessibility tree. Do not use `display: none` — that would strip the button's accessible name for screen readers. Use the standard clip pattern:

```css
.folded .pane-title {
  position: absolute;
  width: 1px; height: 1px;
  padding: 0; margin: -1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
```

The head button then shows: glyph + count. The chevron is already hidden in the strip (`.folded .pane-chevron { display: none; }` — leave that rule alone).

### Step 4 — restyle the count and update the drop affordances

The count is now the only text in a segment, so give it slightly more presence than the current `0.8em` description-colored text, but keep it secondary:

```css
.folded .pane-count { font-size: 0.78em; font-weight: 600; }
```

(Leave the base `.pane-count` rule alone — it still styles open pane headers.)

The drag/drop affordances currently work by recoloring each pill's own border (`.can-drop` and `.drop-over` around line 212). Segments no longer have their own borders, so switch both to an inset box-shadow, which draws inside the segment without shifting layout:

```css
.folded .pane.can-drop .pane-head { box-shadow: inset 0 0 0 1px var(--vscode-focusBorder); }
.folded .pane.drop-over .pane-head {
  box-shadow: inset 0 0 0 1px var(--vscode-focusBorder);
  background: var(--vscode-list-dropBackground, var(--vscode-list-hoverBackground, transparent));
}
```

Delete the old `border-color`-based `.can-drop` / `.drop-over` declarations they replace. Also check `.folded .pane.dragging .pane-head { opacity: 0.5; }` still exists and leave it.

### Step 5 — update the stale comments

The long comment block above `.folded` and `.folded .pane-head` (lines 164–186) explains the **pill** design and cites the 2026-07-27 feedback. Rewrite it to explain the **segmented bar** design: why the container owns the border/radius (hidden panes break per-segment corner selectors), why the label is clip-hidden rather than removed (accessible name), why affordances moved to box-shadow (segments have no borders to recolor). Do not leave the old pill rationale in place — a comment describing a design that no longer exists is worse than none.

Similarly update the comment in `launcherScriptFolded.ts` line 20–23 if it still says "four elements crowded the pill" — the head now shows two elements (glyph + count) in the strip. Comment-only edit; do not change the code there.

## What NOT to do

- Do not add or remove DOM elements in `makePaneHead()` — the title span must stay in the DOM (step 3 depends on it).
- Do not touch the open-pane header styles (`.pane-head` base rule, `.pane-glyph`, `.pane-title` base rule) — open sections keep their full-width underlined headers.
- Do not change `placePanes()`, the drag wiring, or the persisted state shape (`collapsed` map + `order` array). This redesign is visual only.
- No new l10n keys are needed: no new user-visible strings are introduced, and the "Show {name}" tooltip already exists (`strings.showSection`).

## Verification (in this order)

1. IDE diagnostics after each edit (they stream automatically — a clean edit is the analyze result). **Do not run `dart analyze` — there is no Dart in this repo.**
2. From `extension/`: `npx tsc -p ./ --noEmit` (type-check; note it cannot see inside the template strings, so it mostly guards the TS around them).
3. From `extension/`: `node esbuild.js` (confirms the bundle builds).
4. Manual smoke test — press F5 to launch the Extension Development Host, open the Saropa Workspace panel, then check each of these:
   - Collapse two or three sections: they form one connected bar with rounded outer corners, dividers between segments, no text labels, icon + count visible.
   - Hover a segment: hover background appears; tooltip says "Show <section name>".
   - Click a segment: the section expands back into the panes row with its full header, and focus stays on the header button (press Tab to confirm focus did not fall to the body).
   - Drag one segment onto another: the strip reorders, and the order survives collapsing/expanding another pane.
   - Drag a shortcut card while sections are folded: eligible segments light up with the inset focus ring; dropping files the card into that section.
   - Type in the search box: folded panes re-expand into the row (search force-reveals them), and clearing the search returns them to the bar.
   - Narrow the panel until the bar wraps: the second row is separated by the 4px row gap and still readable (the wrapped rows sharing one outer border is a known, accepted trade-off).
   - Screen reader spot check (or inspect the accessibility tree via Developer: Toggle Developer Tools → Elements → Accessibility): each folded segment's button still exposes the section title as its name.
   - Switch between a light and a dark theme: the band background and dividers are visible in both.
5. Update the root `CHANGELOG.md` `## [Unreleased]` section (never `extension/CHANGELOG.md` — it is generated and a hook blocks it) with one line describing the collapsed-section redesign.
6. Update [plans/guides/STYLEGUIDE.md](guides/STYLEGUIDE.md): record the new convention — "collapsed launcher sections render as a connected icon+count segmented bar; labels live in the tooltip/accessible name" — so the guide does not lag the code.

## Files touched

| File | Change |
| --- | --- |
| `extension/src/views/launcherAssets.ts` | All CSS changes (steps 1–4) plus comment rewrite (step 5) |
| `extension/src/views/launcher/launcherScriptFolded.ts` | Comment-only update (step 5) |
| `CHANGELOG.md` (root) | Unreleased entry |
| `plans/guides/STYLEGUIDE.md` | New collapsed-section convention |
