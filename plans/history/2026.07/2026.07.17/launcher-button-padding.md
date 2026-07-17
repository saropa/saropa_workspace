# Launcher card buttons: unified padding on expand

An expanded launcher card showed its head Open/Run button with a visibly tighter box than the Open/Copy path buttons in the drawer directly below it: the head kept its compact icon-only padding (`2px 7px`) even after its text label appeared. The expanded head button now adopts the drawer buttons' padding, defined once as a custom property so the two styles cannot drift.

## Defect

`extension/src/views/launcherAssets.ts` gives the head button (`.run`) a compact `2px 7px` box sized for its icon-only collapsed state, while the drawer's action buttons (`.btn`) use `4px 9px 3px`. When a card expands, the head reveals its text label and sits directly above the drawer's button row — the padding mismatch made the two button styles read as different controls on the same card.

## Change

- `:root` gains `--launcher-btn-pad: 4px 9px 3px` beside the existing `--launcher-btn-font`; the comment carries the optical rationale for the 1px top bias (a codicon paired with smaller-than-em label text whose cap-height rides above the icon's optical center).
- `.btn` reads `padding: var(--launcher-btn-pad)` instead of the literal.
- New rule `.card.expanded .run { padding: var(--launcher-btn-pad); }` — the collapsed head keeps its compact icon-only box, so the dense grid is unchanged; only the expanded state adopts the drawer box.
- `extension/src/test/launcherAssets.test.ts` gains a regression test: `--launcher-btn-pad` defined on `:root`; every line-anchored bare `.btn` block reads the variable; the `.card.expanded .run` override reads it; and the `4px 9px 3px` literal appears exactly once in the stylesheet (the variable definition), so a hardcoded copy anywhere fails the suite.
- `plans/guides/STYLEGUIDE.md` records the convention next to the shared-label-size rule; root `CHANGELOG.md` gains a Fixed entry under Unreleased.

## Scope notes

The head button's border stays `none` while `.btn` carries a 1px border, so an expanded head renders 2px shorter in total height than a drawer button despite identical padding. The buttons sit on separate rows of the card, and the request was padding standardization, so the border difference was deliberately left alone.

## Verification

- `npx tsc -p ./ --noEmit` from `extension/`: clean.
- `npm run test:unit`: 963 pass, 0 fail (includes the new regression test).
