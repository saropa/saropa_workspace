# Untapped-shortcut row marker

The Saropa Workspace activity-bar icon showed a count of untapped shortcuts
(added but never opened or run), but nothing in the sidebar distinguished those
rows, so the badge pointed at no identifiable items — a user opening the sidebar
could not tell which shortcuts the number referred to or how to clear it. This
change marks each untapped row with a leading dot and repaints the tree in step
with the badge, so the count becomes actionable.

## Finish Report (2026-06-27)

### Defect

The untapped-shortcuts count lived only on `TreeView.badge` (set by
`refreshUntappedBadge` in `extension/src/activation/viewState.ts`). The tree rows
carried no per-item indication of tapped vs untapped state — the tree providers
(`views/`) never read `tappedShortcuts`. Two consequences:

1. The badge total had no visible referent: the user saw a number, opened the
   view, and every row looked identical.
2. Even though tapping a shortcut recomputed the badge (via
   `tappedShortcuts.onDidChange` wired in `viewState`), the Shortcuts tree did not
   repaint on that event, so any future per-row marker would have lagged the
   badge.

### Change

- `views/shortcutTreeItem.ts` — added an `untapped` constructor parameter
  (appended, narrow, matching the existing `sweepBadge` / `metricBadge` pattern).
  When true on a non-recent, non-annotation row, a leading marker (`●`, the
  `UNTAPPED_MARKER` constant) is prepended to the row `description`, and a hover
  line (`untapped.rowTooltip`) explains what clears it. The marker is kept out of
  the `·`-joined description segments so it reads as a status dot, not a detail
  field. Annotation rows return before the marker is read; Recent rows are built
  on the non-recent-false default (a Recent entry is tapped by definition).
- `views/shortcutTreeNodes.ts` — `buildShortcutItem` passes
  `!tappedShortcuts.has(shortcut.id)` as the untapped flag. `buildRecentItem`
  leaves it at the default.
- `views/shortcutsTreeProvider.ts` — subscribes to `tappedShortcuts.onDidChange`
  and fires a tree repaint, so the dot disappears in step with the badge total
  the moment a shortcut is opened, run, or peeked.
- `i18n/locales/en.json` — added `untapped.rowTooltip`.
- `plans/guides/STYLEGUIDE.md` §4.5 — added the rule that a count badge must
  point at a visible per-row marker (the binary unseen/seen case), not just a
  numeric per-row counter.
- `CHANGELOG.md` (root) — `[Unreleased]` entry; `README.md` — extended the badge
  description to name the dot.

### Scope notes

- The marker is applied only in the Shortcuts sidebar tree, where the
  `TreeView.badge` lives. The bottom-panel Saropa Launcher carries no badge and
  was deliberately left unchanged.
- The icon was not used to carry the marker: the row icon resolver
  (`shortcutRowTokens.ts`) already encodes file-type tints, and an untapped tint
  would override them. The description marker is the conflict-free surface.

### Verification

- `npx tsc -p ./ --noEmit` (from `extension/`) — clean.
- `node esbuild.js` — bundle builds.
- `npm run test:unit` — 815 pass, 0 fail (includes `tappedShortcuts.test.ts`).
- No node-runnable test constructs `ShortcutTreeItem` (it imports `vscode`, so it
  is excluded from the `node --test` path; the extension-host harness is not
  wired). The tapped/untapped decision is `!tappedShortcuts.has(id)`, already
  covered by `tappedShortcuts.test.ts`; the marker rendering is a string prefix.

## Finish Report (2026-06-28)

### Defect (follow-up)

The first iteration prepended the untapped marker to the row `description`. VS Code
renders a `TreeItem.description` in the dimmed `descriptionForeground` color, so the
dot sat gray-on-gray next to the (also gray) file path and was effectively invisible
in the sidebar. The activity-bar count badge therefore still pointed at no
distinguishable rows — the same dead end the marker was meant to remove.

### Change

- `views/shortcutTreeItem.ts` — the marker now leads the row **label**
  (`displayLabel`), which renders in the full-strength foreground, instead of the
  description. The label is computed as `baseLabel` (the masked/aliased/basename
  name) and prefixed with `UNTAPPED_MARKER` only when `untapped`. The description
  prefix was removed; the description is back to the plain `·`-joined body. Annotation
  rows still never show the dot — their early-return branch overwrites `this.label`
  after `super()`. The change is display-only: `this.id`, reveal, rename (reads
  `shortcut.label` from the model), and drag/drop are unaffected.
- `plans/guides/STYLEGUIDE.md` §4.5 — the binary-count marker rule now mandates the
  label (not the description), naming the dimmed-color failure mode as the reason.

### Verification

- `npx tsc -p ./ --noEmit` (from `extension/`) — clean.
- `node esbuild.js` — bundle builds.
- No node-runnable test constructs `ShortcutTreeItem`; the change is a label-string
  prefix, and no existing test (`shortcutRowFormatting.test.ts`,
  `shortcutTreeDragDrop.test.ts`) asserts the marker, so none needed updating.
