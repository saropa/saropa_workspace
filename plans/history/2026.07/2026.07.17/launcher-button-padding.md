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

## Follow-up: full box parity (2026-07-17)

The scope note above's deliberate leftovers were closed on request ("collapse the remaining visual delta"):

- `.card.expanded .run` now also carries `border: 1px solid transparent`, matching `.btn`'s 1px border thickness so the expanded head and a drawer button measure the same total height. The transparent color leaves the blue primary look unchanged (the background paints under the border).
- The expanded head icon grows from the collapsed 13px to the drawer's 16px codicon size. Both read a new `--launcher-btn-icon: 16px` variable on `:root` (`.btn .codicon` previously relied on the codicon font's own 16px default; it is now pinned explicitly so the pairing cannot drift).
- The collapsed head's 13px icon and `2px 7px` box remain single-use literals with comments naming them as deliberate — the dense grid state is untouched.
- New regression test pins the `:root` icon variable, the transparent border on the expanded head, and both `.codicon` rules reading the variable. Style guide and changelog updated in the same change.
