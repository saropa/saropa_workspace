# Launcher: project-file cards show the Open icon while collapsed

Project Files cards in the Saropa Launcher webview previously exposed their Open
action only after the card was expanded (in the drawer), so the collapsed grid gave
no one-click way to open a file. This change makes a project-file card lead with an
Open head button, so the go-to-file icon is visible in the collapsed grid — matching
the affordance a document-file shortcut in the My shortcuts pane already carried.

## Finish Report (2026-07-09)

### Defect

The launcher card builder (`makeCard`) renders a head-row primary-action button only
when the item carries `headAction`. `fileLauncherItem` (Project Files) left
`headAction` unset, so a surfaced project file rendered with no head button and
surfaced Open only in the expand drawer. A My shortcuts document file, by contrast,
sets `headAction: "open"` (via `toItem` in `launcherItems.ts`) and shows the
go-to-file icon on the collapsed head. The two file surfaces disagreed on a visible
affordance.

### Change

- `extension/src/views/launcherFileItem.ts` — the returned `LauncherItem` now sets
  `headAction: "open"`. In `makeCard` this renders the head Open button (icon-only
  when collapsed, `.run-label` text on expand) and, via the drawer gate
  `it.openable && it.headAction !== 'open'`, suppresses the now-duplicate Open in the
  drawer. `copyable` is unchanged, so Copy path remains in the drawer. The item's `id`
  is the file's `fsPath`, which the head's `postOpen(it)` routes as an `openFile`
  message the host re-validates against the live surfaced-file set.
- `plans/guides/STYLEGUIDE.md` — the head-button rule previously stated the
  "browse-only Watches and Project-files panes keep their deliberate expand-then-act
  model." It now records that a surfaced project file leads with Open, and that only
  the Watches pane keeps the no-head-button model, because a watch's Open also clears
  its unseen counter (a bare-click Open there would silently lose state) whereas
  opening a project file is non-destructive and needs no such guard.
- `extension/src/test/launcherItems.test.ts` — the primary project-file card test now
  asserts `headAction === "open"`, pinning the new lever.
- `CHANGELOG.md` — Unreleased "Changed" entry.

### Rationale for the Watches divergence

Watches deliberately carry no head button (`watchLauncherItem` sets `openable: true`
and no `headAction`): a watch's Open clears its unseen counter, so an accidental
bare-click Open on a browse surface would lose state. Opening a project file performs
read-only editor navigation (`vscode.open`), so the same guard is unnecessary and the
collapsed Open icon is safe.

### Verification

- `npx tsc -p ./ --noEmit` — the touched files type-check clean. (An unrelated
  pre-existing error in `extension/src/commands/configureRun.ts`, a file carrying
  another workstream's in-flight change, was not introduced or addressed here.)
- `node esbuild.js` — bundle builds.
- `node --test out/test/launcherItems.test.js` — 29 tests pass, 0 fail, including the
  updated project-file assertion.

### Out-of-scope note (not changed)

`extension/src/views/launcher/launcherScriptCards.ts` carries a comment (near the
card click-to-expand handler) describing Open/Run as "destructive" actions. That
wording is pre-existing and now slightly looser for project files (Open is
non-destructive). It sits in a file this change did not edit and was left untouched.

## Finish Report — drawer button height (2026-07-09)

### Defect

The launcher webview's drawer action buttons (`.btn` — Open, Copy path, Pin, Schedule) paired a 16px codicon with sub-em label text under symmetric vertical padding (`3px 9px`). The label's cap-height rides above the icon's optical center, so the text read as sitting high — not vertically centered against the icon.

### Change

`extension/src/views/launcherAssets.ts` — the `.btn` padding changed from `3px 9px` to `4px 9px 3px`. The extra pixel is on top only: it grows the button by exactly 1px and lowers the flex content box ~0.5px, dropping the label into optical center. `.btn.primary` declares no padding of its own, so primary and secondary buttons keep identical box metrics. The head `.run` button (icon-only until expand) is unchanged — it is not an always-labeled button.

### Verification

- `node esbuild.js` — bundle builds.
- `node --test out/test/launcherAssets.test.js` — 30 tests pass, 0 fail. No test asserts on `.btn` padding, so none regressed.
