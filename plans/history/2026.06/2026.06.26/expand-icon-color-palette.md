# Expand the shortcut icon-color palette to 20 named colors

The shortcut/group "Set Icon & Color…" picker offered only seven tints drawn from
the built-in VS Code chart palette (`charts.*`), which capped the available hues
and gave no control over the exact shade. This change replaces that list with a
20-swatch named palette registered as custom theme colors, spread evenly around
the color wheel so adjacent swatches stay distinguishable at icon size.

## Finish Report (2026-06-26)

### Problem

`ThemeColor` accepts only a registered color id, never a raw hex, so the picker
was limited to whatever theme colors already existed. The seven `charts.*` colors
were the cheap option but offered no true RGB control and a narrow hue range.

### Change

- **Registered 20 custom theme colors** in `extension/package.json` under
  `contributes.colors` (`saropaWorkspace.tint.<name>`), each with explicit dark,
  light, high-contrast, and high-contrast-light hex. The hex lives only in the
  manifest (single source of truth).
- **Replaced `COLOR_CHOICES`** in `extension/src/commands/configureAppearance.ts`
  with the 20 ids + label keys. The list is shared by both the per-shortcut and
  the per-group appearance pickers, so one edit covers both surfaces.
- **Added catalog entries**: 20 picker labels in
  `extension/src/i18n/locales/en.json` (`appearance.color.<name>`) and 20
  settings descriptions in `extension/package.nls.json` (`color.<name>.description`).
- **Hue tuning (second pass).** The first cut packed four blues and three greens
  close enough to be hard to tell apart at icon size. The palette was retuned to
  roughly even hue spacing: dropped the crowded extras (crimson, sky, rose),
  added red, orange, and chartreuse, and separated the green/teal/cyan/blue zone
  by both hue and lightness. Final order runs warm → cool → neutral: red, coral,
  orange, amber, gold, lime, chartreuse, green, emerald, teal, cyan, blue, indigo,
  violet, purple, magenta, pink, brown, slate, gray.

### Backward compatibility

Shortcuts previously saved with a `charts.*` color id still render — that
`ThemeColor` remains valid; the value is simply no longer pre-selected in the
picker. No migration runs and no stored data changes.

### Tests

Added `extension/src/test/appearanceColors.test.ts`: a cross-file parity guard,
since the offered colors, their registered theme colors, and their labels live in
three files that must agree (a drift renders a blank picker row or an unresolved
tint, both invisible at compile time). It asserts every offered tint is namespaced,
unique, count 20, registered in `contributes.colors`, has an `en.json` label, and
that no registered tint is orphaned. Full suite: 768 pass, 0 fail.

### Style guide

Recorded the convention in `plans/guides/STYLEGUIDE.md`: a user-selectable color
comes from a registered, named theme color (extend `COLOR_CHOICES` + add an
`appearance.color.<name>` label), never a raw hex passed to `ThemeColor`.

### Files

- `extension/package.json` — `contributes.colors` (20 entries)
- `extension/package.nls.json` — 20 color descriptions
- `extension/src/i18n/locales/en.json` — 20 picker labels
- `extension/src/commands/configureAppearance.ts` — `COLOR_CHOICES` (exported for the test)
- `extension/src/test/appearanceColors.test.ts` — new parity test
- `plans/guides/STYLEGUIDE.md` — named-color convention
- `docs/THEMING.md` — palette list updated from 7 to 20
- `CHANGELOG.md` — Unreleased entry
