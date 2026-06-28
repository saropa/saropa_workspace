# Project Files: curated catalog + per-area category grouping

The Project Files view surfaced only a flat list of root-level files (README,
CHANGELOG, manifests) and could not reach the platform config that lives in
subfolders (Android Gradle files, the iOS `Podfile`, web entry points), nor group
what it found. This change adds a curated, structured catalog that reaches nested
paths and groups the surfaced files by area in both the sidebar tree and the
bottom-Panel launcher, rendering group headers only when more than one area is
present.

## Finish Report (2026-06-28)

### Scope

VS Code extension (TypeScript) and docs. No Flutter/Dart code. Touched:
`extension/src/model/projectFiles.ts`, `extension/src/views/projectFilesProvider.ts`,
`extension/src/views/launcherItems.ts`, `extension/src/views/launcherView.ts`,
`extension/src/views/launcherAssets.ts`, `extension/package.json`,
`extension/package.nls.json`, the two affected test files, the root `CHANGELOG.md`,
and `plans/guides/STYLEGUIDE.md`.

### Defect / gap

The project-files surface was modeled as a flat `string[]` of root-relative names
(`DEFAULT_PROJECT_FILES`) and a setting `saropaWorkspace.projectFiles.files`. Two
consequences:

1. Files that live in platform subfolders (`android/app/build.gradle`,
   `ios/Podfile`, `web/index.html`) were never surfaced, even though the scanner
   already joined a relative path under the folder and stripped it for the row
   label — only the catalog never listed nested paths.
2. The view had no concept of a category. The tree grouped only by workspace
   folder; the launcher's Project files pane was a single flat card list. There
   was no way to see the Android config as a coherent group distinct from the root
   docs.

### Change

**Model (`model/projectFiles.ts`).** Replaced the flat `DEFAULT_PROJECT_FILES`
with a structured `DEFAULT_PROJECT_FILE_GROUPS: ProjectFileGroup[]` — an ordered
catalog of `{ category, glyph, files }`. Categories: **Project** (the cross-stack
root docs/manifests plus `analysis_options.yaml` and `l10n.yaml`), **Android**
(top-level and app `build.gradle` + `.gradle.kts`, `settings.gradle(.kts)`,
`gradle.properties`, `local.properties`, `AndroidManifest.xml`), **iOS**
(`Podfile`, `Info.plist`), **Web** (`index.html`, `manifest.json`). `ProjectFileInfo`
gained a `category` field; `scanProjectFiles` now takes the group list and tags
each surfaced file with the category that found it. Two pure helpers were added so
the grouping/ordering logic is unit-testable without the VS Code host:
`groupFilesByCategory` (buckets in catalog order, drops empty categories, appends
unknown user-defined categories) and `glyphForCategory` (catalog glyph for a known
category, `folder` fallback otherwise). Category labels/glyphs live inline in the
const catalog, matching the existing synthetic-group convention rather than the
l10n catalog.

**Config schema (`package.json` + `package.nls.json`).** The flat
`saropaWorkspace.projectFiles.files` array was replaced by
`saropaWorkspace.projectFiles.groups`, an object map of category name to file
paths. Paths may be nested; only the file name shows in the row. The setting
carries paths only — each category's glyph is resolved from the curated defaults,
so a user-defined category gets the generic folder glyph. The config-description
NLS key and the view-welcome string were updated to describe the grouped catalog.

**Tree provider (`views/projectFilesProvider.ts`).** Reads the configured groups,
scans with them, and renders a `byCategoryOrFlat` decision: category group nodes
(`ProjectCategoryNode`, carrying its resolved files so expanding does not re-scan)
only when more than one category has matches, otherwise a flat name-sorted list.
For a multi-folder workspace the existing folder grouping stays the outer level and
the category grouping nests within each folder.

**Launcher (`launcherItems.ts`, `launcherView.ts`, `launcherAssets.ts`).**
`fileLauncherItem` takes the category and its glyph (passed in by the host, keeping
the module free of the vscode-importing model) and emits a per-category group
identity: `section` = the bare category name, `groupId` = `files:<category>`,
header glyph = the category's. The host orders file cards by category (catalog
order from the scan) and name-sorts within a category. The webview `paneModel`
treats the files pane as grouped, but renders it flat when only one area is present
so a lone "Project" header never doubles the pane title — the same
"group-only-when-earned" rule the tree follows. Each group folds independently and
the state persists, identical to the My shortcuts / Recipes groups.

### Tests

- `extension/src/test/projectFiles.test.ts`: scan-signature updates to the
  structured group input; new assertions that a surfaced file carries its
  category, that a nested path is reached, that the default catalog spans the root
  manifests/docs plus the Android nested path, and pure-function coverage for
  `groupFilesByCategory` (catalog order, empty-category drop, user-defined-category
  append) and `glyphForCategory` (known glyph vs folder fallback).
- `extension/src/test/launcherItems.test.ts`: `category`/`categoryGlyph` added to
  all `fileLauncherItem` callers; new assertions that the card's group identity
  (`section`, `groupId`, `groupIcon`) is the category's, including a platform
  category (Android → `device-mobile`).

Command: bundled each touched test with esbuild against the vscode stub and ran
under `node --test`. Result: 39 tests pass, 0 fail (24 launcher + 15 project
files). Full `npx tsc -p ./ --noEmit` clean; `node esbuild.js` bundle builds.

### Verification limits

The webview `paneModel` grouping is plain JavaScript inside a template-literal
string, so it is exercised by the type-check and the data-layer tests but not by
an automated render test. The grouped-vs-flat rendering and fold persistence in
the running launcher are confirmable only by a manual dev-host smoke test against a
project that has more than one area present (e.g. a Flutter app with an `android/`
folder).
