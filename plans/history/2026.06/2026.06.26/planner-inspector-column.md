# Planner detail inspector: right-side resizable column

The Schedule & Workflow Planner showed a selected item's details in a strip pinned
below the full-height Day/Week grid, where it scrolled out of sight and read as a
separate, unexplained "information section" rather than a detail view. The strip also
lacked a way to resume a paused schedule and gave no explanation of what a seeded
recipe (e.g. Workspace bloat scan) actually does.

## Finish Report (2026-06-26)

### Scope
VS Code extension (TypeScript), webview only. Files changed:
`extension/src/views/plannerPanel.ts`, `plannerScript.ts`, `plannerAssets.ts`,
`extension/src/i18n/locales/en.json`, `CHANGELOG.md`, plus tests
`extension/src/test/plannerScript.test.ts`, `plannerAssets.test.ts`.

### Defect
The planner's detail surface was a block-level strip rendered after the stage. On a
tall, scrolling Day/Week grid it sat at the bottom of the document, so selecting an
item updated a panel the user had scrolled past — the gesture appeared to do nothing,
and the surface was mistaken for an unrelated info section. Two functional gaps
compounded it: the strip exposed Run / Open / Schedule / Triggers but no
pause/resume control (the only toggle was in the right-click menu), and it never
surfaced a recipe's own description, so a seeded/disabled scheduled recipe was an
unlabeled timer.

### Change
- Detail surface moved into its own right-hand column inside a new `.workarea` flex
  container: the stage flexes to fill, the inspector docks right and is `position:
  sticky` under the toolbar so it stays in view while the grid scrolls. When nothing
  is selected the inspector is `display:none` and the stage spans full width.
- A close (×) button in the inspector header clears the selection (`select(null)`),
  hiding the column and dropping all selection highlights; the stage returns to full
  width.
- The inspector renders the node's `description` as an info note (`.dinfo`) and a
  Pause/Resume button mirroring the existing `toggleEnabled` host path; the toggle
  emits a toast naming the pin and its new state.
- Both side columns are user-resizable. A shared `attachResizer` helper drives the
  inspector (handle on its left edge, clamp 240–560px) and the Workflow toolbox
  (handle on its right edge, clamp 130–340px). Widths persist in webview state
  (`detailW` / `toolboxW`) and feed the `--detail-w` / `--toolbox-w` CSS vars on
  reload. The inspector's handle is a persistent sibling of a new `#detail-body`
  wrapper, so it survives the wholesale innerHTML re-render that rebuilds the body.
- Removed the obsolete `scrollIntoView` from `select()` (it existed to surface the
  former bottom strip; the sticky column makes it unnecessary and it would cause a
  stray scroll).

### Verification
- `npx tsc -p ./ --noEmit`: clean.
- `node esbuild.js`: bundle builds.
- `npm run test:unit`: 728 pass / 0 fail, including new invariants asserting the close
  action clears selection, the description/info note and pause-toggle are present, the
  resize helper persists `detailW`/`toolboxW` and drives the layout vars, and the
  stylesheet sizes both columns via the vars with `col-resize` handles.

### Notes for reviewers
- Webview client-script display strings stay inline (American English) per
  `plans/guides/STYLEGUIDE.md` §2; host-side strings (panel aria-label, the
  pause/resume and link toasts) go through `l10n` keys in `en.json`.
- No new color literals: the resize handles and inspector use existing `--vscode-*`
  and brand tokens, keeping the stylesheet's "theme everything" invariant green.
