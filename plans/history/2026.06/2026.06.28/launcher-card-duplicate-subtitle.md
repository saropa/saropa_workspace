# Launcher card: suppress a subtitle that only echoes the name

A file shortcut to a file at the project root carried its bare filename as both
the card title and the card path, so the Saropa Launcher rendered the same text
twice — the title and the subtitle line read identically (for example
`CHANGELOG.md` over `CHANGELOG.md`). The subtitle line is now hidden whenever it
would only repeat the title, and still appears when it adds information.

## Finish Report (2026-06-28)

### Defect

The launcher card builder (`makeCard` in `extension/src/views/launcherAssets.ts`)
unconditionally rendered the `.card-sub` element from `it.sub`. For a "mine"-pane
file shortcut, `sub` is the shortcut's `path`; for a root-level file the path is
just the filename, which already equals the card `label` (the data layer defaults
a shortcut's label to its filename in `toItem`). The result was a duplicated
subtitle under the title — most visible on root files (README, CHANGELOG, manifest
shortcuts), where the path has no directory segment to distinguish it.

### Change

`makeCard` now gates the `.card-sub` element on `it.sub && it.sub !== it.label`,
so the secondary line is built only when it carries information the title does not.
A nested path (`android/app/build.gradle`), a project-file freshness/version line,
and a watch state line all still render — those differ from the label. The fix is
purely in the webview render layer; the data layer (`launcherItems.ts`) is
unchanged, so `sub` continues to carry the path for the host's search haystack and
the expand drawer.

### Verification

- `npx tsc -p ./ --noEmit` — clean.
- `launcherAssets.test.ts` bundled and run in isolation under `node --test` — 27
  passing, including a new guard `LAUNCHER_SCRIPT: suppresses the card subtitle
  when it only echoes the name` that pins the `it.sub !== it.label` condition.

### Files

- `extension/src/views/launcherAssets.ts` — `makeCard` subtitle gate.
- `extension/src/test/launcherAssets.test.ts` — new guard test.
- `plans/guides/STYLEGUIDE.md` — new rule under the Panel-launcher section.
- `CHANGELOG.md` — Fixed entry under [1.5.8].
