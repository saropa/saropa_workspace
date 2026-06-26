# Icon picker — synonym search

The pin icon picker (`Set Icon & Color…`) offered ~99 VS Code product icons whose
QuickPick rows were labeled only by their codicon id. Type-to-filter matched the id
alone, so a user who did not know the exact id — searching "settings" for `gear`,
"octocat" for `github`, "deploy" for `rocket` — found nothing, defeating the search.

A synonym dictionary was added: each icon id now carries a keyword list shown as the
QuickPick row description and matched on, so an alternate word or a name surfaces the
icon. One synonym may name several icons, and that overlap is intended.

## Finish Report (2026-06-26)

### Scope

VS Code extension (TypeScript) plus its runtime string catalog and docs. No Dart.
Flutter/ARB localization steps are not applicable.

### Change

- `extension/src/i18n/locales/en.json` — added a `appearance.iconKeyword.<id>` entry
  for every icon offered by the picker (99 entries, one per id across all seven
  `ICON_GROUPS` categories). Each value is a space-separated synonym list in American
  English (e.g. `gear` → "settings config options cog preferences", `github` →
  "octocat octopus repo git source hub", `rocket` → "launch deploy ship start boost
  release"). The synonyms live in the catalog, not inline, so they stay externalized
  and translation-ready.
- `extension/src/commands/configureAppearance.ts` — each icon QuickPick item now sets
  `description` to `l10n('appearance.iconKeyword.' + id)`, and the picker enables
  `matchOnDescription: true`. The synonym text is therefore both visible beside the
  icon name and included in the type-to-filter match. The key is derived from the id,
  so there is no parallel id→keyword map to drift; the catalog is the single source.
  The header comment documents the dictionary.

### Why this shape

VS Code's QuickPick exposes no hidden keyword field — filtering matches only `label`,
`description`, and `detail`. Synonyms therefore had to occupy a visible, matchable
field; `description` (lighter text to the right of the label) is the standard place
and doubles as a discoverability hint. `l10n` falls back to the key string when a key
is missing, so an icon id without a synonym entry would leak a raw key as its
description — a build-time cross-check confirmed all 99 ids have a matching entry,
with no orphan keys.

### Tests

- `extension/src/test/iconSynonyms.test.ts` (new) — pure-logic test (reads the real
  `en.json` and the pure `l10n` lookup, no extension host). Asserts every synonym
  entry is a non-empty string, that a lookup returns a real value rather than the key
  fallback, that the documented aliases (`settings`/`cog` → gear, `octocat` → github,
  `deploy`/`launch` → rocket) still resolve, and that the intended `settings` overlap
  across `gear` and `settings-gear` is preserved. 4/4 pass.
- `l10n.test.ts` (existing, reads the same catalog) re-run: 10/10 pass — the added
  keys did not disturb existing assertions.
- `npx tsc -p ./ --noEmit` clean; `node esbuild.js` builds.

### Style guide

Recorded the new convention in `plans/guides/STYLEGUIDE.md` (native-first surfaces):
a type-to-search QuickPick whose labels are codes or jargon carries an externalized
synonym list matched via `matchOnDescription`, and synonym overlap across rows is
intended.

### Docs

- `CHANGELOG.md` — extended the existing icon-picker entry to cover synonym search.
- `docs/THEMING.md` — added the type-to-filter-by-synonym behavior to the icon
  section.
