# Version bump to 1.6.0 and changelog consolidation

The unreleased 1.5.28 section (context-menu reorganization into submenus) was never published. Its single changelog entry was merged into the Unreleased section, the standalone 1.5.28 heading and overview were removed, and the combined section was promoted to 1.6.0 — reflecting a minor-version bump warranted by the scope of changes: config directory migration (`.vscode` to `.saropa`), launcher pill strip, daily routines wizard, drag-and-drop filing, auto-pin deduplication, and the menu reorganization.

## Changes

- `extension/package.json`: version `1.5.28` → `1.6.0`.
- `CHANGELOG.md`: merged `[1.5.28]` Changed bullet into `[Unreleased]`'s Changed section; removed the `[1.5.28]` heading, overview, and separator; renamed section from `[Unreleased]` to `[1.6.0]`; added overview line summarizing the four headline changes with a `v1.6.0` log link.

## Finish Report (2026-07-28)

Docs-only change. No runtime behavior affected. The overview line was written to cover the four most prominent user-facing changes in the release; the full bullet list under Added/Fixed/Changed carries the detail. The log link targets the `v1.6.0` tag, which does not exist yet — it will resolve once the release is tagged.
