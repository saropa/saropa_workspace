# Launcher kind pill — neutral gray, not card-tinted

The Saropa Launcher board read as over-colored: each card showed its identity
color three times — on the left accent stripe, on the glyph, and on the kind pill
(SHELL / MACRO / COMMAND / ROUTINE). The pill is now a muted gray so the board has
a single color signal per card while the stripe and icon still carry the tint.

## Finish Report (2026-06-27)

### Defect

The launcher card pill (`.chip` in `extension/src/views/launcherAssets.ts`)
inherited the per-card accent via `var(--card-tint, …)` for both its text color
and border. Combined with the colored left stripe (`border-left: 3px solid
var(--card-tint, …)`) and the tinted glyph (`.card-ic`), every card carried the
same color three times. With ~78 cards on the wide Panel surface the board looked
busy rather than scannable.

### Change

`.chip` now binds to `--vscode-descriptionForeground` for both color and border,
at `opacity: 0.7`, with a comment recording why the pill is intentionally not
tinted. The card's identity color is unchanged on the stripe and icon, so kind is
still legible — the pill simply stops adding a redundant third color layer.

The webview style invariants are unaffected: no hex literal is introduced and the
color still resolves from a `--vscode-*` theme variable, so the existing
"binds to a theme variable" and "no hardcoded hex" tests continue to pass across
light / dark / high-contrast themes.

### Tests

Added `LAUNCHER_STYLE: the kind pill is neutral gray, not tinted with --card-tint`
to `extension/src/test/launcherAssets.test.ts`. It isolates the `.chip` rule and
asserts it uses `--vscode-descriptionForeground` and does not reference
`--card-tint`, pinning the new behavior against a future re-tint regression. Full
suite: 824 passing, 0 failing. Type-check (`npx tsc -p ./ --noEmit`) clean.

### Convention recorded

`plans/guides/STYLEGUIDE.md` (section 1.1a, Panel launcher) gained a bullet
stating the rule: one color signal per launcher card — stripe + icon carry the
tint, structural labels (the kind pill) stay neutral.

### Files

- `extension/src/views/launcherAssets.ts` — `.chip` recolored to neutral gray.
- `extension/src/test/launcherAssets.test.ts` — new test pinning the pill color.
- `CHANGELOG.md` — `[Unreleased]` Changed entry.
- `plans/guides/STYLEGUIDE.md` — one-color-per-card convention recorded.
