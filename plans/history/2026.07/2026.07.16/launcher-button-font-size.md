# Launcher card buttons: unified label size

The Saropa Launcher tab rendered its card buttons at two different text sizes:
the head Run/Open button's label was larger than the Open/Copy path buttons in a
card's expanded drawer. The head button now declares the same reduced size the
drawer buttons use, so every button label on a launcher card renders at one size.

## Defect

`extension/src/views/launcherAssets.ts` styles two button classes on a launcher
card: `.run` (the head's blue primary-action button — Run for an executable,
Open for a document) and `.btn` (the drawer's action buttons — Open, Copy path,
Pin, Schedule). `.btn` set `font-family: inherit; font-size: 0.88em`, but `.run`
set neither, so as a native `<button>` it kept the user agent's own button font
at 1em. When a card expanded and the head button revealed its text label
(`.run-label`), that label read visibly larger than the drawer buttons directly
below it on the same card.

## Change

- `.run` in `LAUNCHER_STYLE` now declares `font-family: inherit;
  font-size: 0.88em`, matching `.btn`. The head's codicon is fixed at 13px, so
  the collapsed icon-only state is visually unchanged; only the expanded text
  label shrinks to match.
- `plans/guides/STYLEGUIDE.md` records the convention: all launcher card buttons
  share the 0.88em label size, with the explicit declaration required because a
  native `<button>` does not inherit the body font.
- `extension/src/test/launcherAssets.test.ts` gains a regression test asserting
  both `.run` and `.btn` declare `font-family: inherit` and `font-size: 0.88em`.
- Root `CHANGELOG.md`: Fixed entry under the 1.5.22 section.

## Scope notes

Other `<button>` elements in the launcher webview — pane headers (0.86em),
group headers (0.8em), header filter chips (0.85em), and context-menu items
(inherit) — are navigation and header surfaces with deliberate sizes of their
own, not card action buttons; they were intentionally left unchanged.

## Verification

- `npx tsc -p ./ --noEmit` from `extension/`: clean.
- `npm run test:unit`: 956 pass, 0 fail (includes the new regression test).

## Hardening follow-up (2026-07-16)

The handoff review flagged two structural risks: a future button style (or a
duplicate `.run`/`.btn` rule) could hardcode a diverging size, and the
regression test's regex bound only the first block matching each selector.
Both closed:

- The size now lives in a `--launcher-btn-font: 0.88em` custom property on
  `:root`; `.run` and `.btn` read `var(--launcher-btn-font)`, so a retune is a
  single edit and the styles cannot drift.
- The test now asserts: the variable is defined on `:root`; EVERY line-anchored
  bare `.run` / `.btn` block (matchAll, not first-match) declares
  `font-family: inherit` and reads the variable; and the `0.88em` literal
  appears exactly once in the stylesheet (the variable definition), so a
  hardcoded copy anywhere fails the suite.
- The style guide rule names the variable, requires new card action buttons to
  read it, and records that pane/group heads, filter chips, and the context
  menu are deliberately excluded.
