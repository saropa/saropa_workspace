# Launcher drawer detail text — slightly larger font

The detail text shown in an expanded launcher card's drawer (the description
beneath the card head, revealed on a primary click) rendered at `0.9em`, small
enough to read as cramped against the card name above it. The font size was
bumped one step so the detail reads more comfortably without disturbing the
compact card grid.

## Finish Report (2026-06-28)

### Change

- [extension/src/views/launcherAssets.ts](../../../../extension/src/views/launcherAssets.ts)
  — `.drawer-desc` `font-size` raised from `0.9em` to `0.97em`, with
  `line-height` nudged from `1.4` to `1.45` to keep the slightly larger text
  evenly spaced. This is the only selector that styles the expanded-card detail
  description; the compact card subtitle (`.card-sub`, `0.82em`) and the rest of
  the launcher type scale are untouched, so only the expanded drawer grows.

### Scope and review

- Pure CSS literal change inside the inlined `LAUNCHER_STYLE` template. No logic,
  no control flow, no API surface, no new strings, no new screen — the
  STYLEGUIDE constraints (Saropa title prefix, string externalization, visible
  feedback, voice, American English) are not engaged by a font-size tweak.

### Verification

- `npx tsc -p ./ --noEmit` from `extension/` — exit 0.
- `extension/src/test/launcherAssets.test.ts` does not assert on the
  `font-size`/`line-height` literals, so no test pins the old value and none
  needed updating. The size is a visual property confirmed by manual render.

### Documentation

- Root `CHANGELOG.md` `## [Unreleased]` → Changed: entry recording the
  `0.9em` → `0.97em` bump.
