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
