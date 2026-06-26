# Comments and separators in the pin list

Roadmap: Later / Exploratory. Net-new. Carries the cross-cutting tree/run/badge surface.

## Verified current state

`PinKind = "file" | "shell" | "url" | "command" | "macro"` (`pin.ts:13`). Every pin has
a populated `path` and an action — there is **no** annotation-only entry kind. The tree
renders pins (icon + label) and groups (folders); there is no separator/divider visual.
oleg-shilo Favorites Manager offers comment lines and dividers; this adds the equivalent.

## Remaining work

1. **New non-action entry kinds.** Extend `PinKind` with `"comment"` and `"separator"`
   (extend the existing union — discriminated-union rule). A comment carries a label and
   no target/action; a separator carries neither. `path` becomes optional for these kinds
   (or holds an empty sentinel) — handle the model change through a schema migration, not
   a silent drop.
2. **Tree rendering.** In `pinsTreeProvider.ts` / `pinTreeItem.ts`, render a comment as a
   non-runnable, dimmed label row and a separator as a visual divider row. Both are
   **leaf, non-expandable** nodes (consistent with the double-click bug avoidance noted in
   the roadmap's UX constraints).
3. **Run/click safety — the cross-cutting surface.** Comment and separator entries are
   **not runnable and not openable**. Every code path that assumes a pin has a target must
   guard the new kinds:
   - the click/double-click discriminator (`doubleClick.ts`) — a click on a comment/
     separator is inert;
   - the runner (`runner.ts`) — refuse to build a run plan for these kinds;
   - badges/status (`pinBadges.ts`, `runStatus.ts`) — no run badge, no last-run status;
   - the run palette / "Run Pin…" list — exclude them;
   - export/import (`pinSetExport.ts`, `favoritesImport.ts`) — round-trip them as
     ordering/annotation entries;
   - drag-and-drop ordering — they participate in order so they can divide the list.
4. **Authoring commands.** "Add comment" and "Add separator" commands (view title /
   context menu), plus rename for comments. Inserted at a chosen position so they annotate
   and divide a long list.

## Approach

- The discriminated union on `PinKind` is the single guard point — every consumer
  switches on kind, so the new kinds fail closed (no action) wherever they are not
  explicitly handled. Audit each consumer listed above; this is the bulk of the work and
  the reason this item is cross-cutting, not a one-file add.
- Reuse the existing ordering/drag machinery so separators move like any entry.
- New strings via `l10n()`; the add/rename commands name the entry.

## Acceptance criteria

- Comment and separator entries render in the tree (dimmed label / divider) as
  non-runnable, non-openable leaf nodes.
- No run path, badge, palette entry, or click action treats them as actionable.
- They participate in ordering/drag and round-trip through export/import.
- Existing stored pins migrate unaffected.

## Dependencies

- None blocking. Touches the tree, runner, double-click, badges, palette, and
  export/import — verify each consumer guards the new kinds. Tests depend on Phase 4.1.

## Finish Report (2026-06-25)

The core feature shipped: comment and separator entries now label and divide the
pin list. One sub-item of the export/import work is carried forward (see below).

### What was implemented

- **Model** (`extension/src/model/pin.ts`): `PinKind` extended with `"comment"`
  and `"separator"`. New `isAnnotationPin(pin)` predicate is the single
  discriminated-union guard every consumer reads. The kind lives in `action.kind`
  (so `pinKind` routes it); `path` stays a required string with an empty-string
  sentinel for annotations (no schema-version bump — existing stored pins are
  untouched, and the new kinds only appear in entries the user creates).
- **Store** (`pinStore.ts`): `addAnnotationPin(kind, scope, label?, after?)` creates
  the entry. With an anchor pin it inserts immediately after that pin in the same
  scope and group via the new `placeAfter` helper (mirrors the drag-reorder
  renumbering); with no anchor it appends to the project scope's top level.
- **Tree** (`pinTreeItem.ts`): a comment renders as a muted comment-glyph label row;
  a separator renders as a box-drawing divider row (`SEPARATOR_LABEL`). Both are
  leaf nodes with **no `command`** (a click is inert), no `resourceUri`, and no
  badges. Their `contextValue` is `annotationComment` / `annotationSeparator` —
  deliberately not `pin`-prefixed, so the `viewItem =~ /^pin/` menus do not leak
  Run / Open / Configure onto them.
- **Run/click safety** (`pinCommands.ts`): `openPin`, `peekPin`, and `runPinCommand`
  fail closed on annotations. They are excluded from the "Run Pin..." palette
  (`pickPin`) and from the "top pin N" / run-by-reference ordering (`orderedPins`).
  They still drag and reorder like any pin (the drop controller keys off the
  `PinTreeItem` instance, not the contextValue), so they divide the list.
- **Authoring** (`pinCommands.ts` + `package.json`): `saropaWorkspace.addComment`
  and `saropaWorkspace.addSeparator` commands, surfaced on the Pins view title
  (append) and a pin's / annotation's context menu (insert after). Rename reuses
  `renamePin` (comments only); remove reuses `unpin`. Strings via `l10n()` +
  `package.nls.json`.
- **Export/import** (`pinSetExport.ts`): annotations round-trip through the pin-set
  file; `isDuplicate` never dedupes a comment/separator, so repeated dividers each
  survive a re-import.
- **Tests** (`src/test/annotationPin.test.ts`): pure unit tests pinning the
  `pinKind` / `isAnnotationPin` guard for every kind (87 total pass).

Verification: `tsc --noEmit` clean for all touched files; `npm run test:unit`
green (87/87); `node esbuild.js` bundles.

### Carried forward

The external-favorites import round-trip is not implemented — see
`comments-and-separators-import.md`. `favoritesImport.ts` currently treats `#`
comment lines and blank lines in a kdcro101-format favorites file as structural and
drops them; importing them as comment / separator annotation pins is the remaining
work.
