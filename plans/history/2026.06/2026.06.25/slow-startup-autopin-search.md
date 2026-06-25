# Slow startup: auto-pin patterns triggered whole-workspace searches

Opening the Saropa Workspace activity-bar view ran two full-workspace file
searches on every window launch, stalling first paint. Auto-pin patterns that
name an exact file were resolved with the VS Code search service instead of a
direct file check, so a project that did not contain those files still paid a
project-wide search cost.

## Finish Report (2026-06-25)

### Defect

The extension activates on `onStartupFinished` and `activate()` awaits
`store.init()` → `refresh()` → `seedAutoPins()` → `scanAutoPinPaths()`. That last
function was the only call to `vscode.workspace.findFiles` on the awaited
activation path, invoked once per configured `autoPins.patterns` entry per
workspace folder.

`findFiles` spins up the workspace search service, which walks the project file
tree even when the requested file is absent. With the default configuration
(`pubspec.yaml`, `analysis_options.yaml`) that meant two whole-workspace searches
on every launch — wasted entirely in any project that contains neither file (the
common non-Dart case). This was the dominant avoidable cost on the path to the
first tree paint.

### Mechanism of the fix

An auto-pin pattern that contains no glob metacharacters can only ever match the
single file at that relative path: a `RelativePattern` without `**` does not
recurse. Such a pattern is now resolved with one `vscode.workspace.fs.stat`
instead of a search-service call. `findFiles` is retained only for patterns that
actually contain glob syntax (`*`, `?`, `{`, `}`, `[`, `]`), detected by the new
module-level `isGlobPattern` helper.

For a literal pattern the result is an instant hit or miss; for a real glob the
behavior is unchanged. The folder-relative output, the de-duplication set, and
the per-folder scan cache are all preserved, so callers see identical results —
only the cost of the no-match case drops from a file-tree walk to a single stat.

### Files changed

- `extension/src/model/pinStore.ts`
  - Added `isGlobPattern(pattern)` module helper.
  - `scanAutoPinPaths()` now branches: literal patterns resolve via `fs.stat`
    (file-type checked, absence swallowed as the normal case); glob patterns keep
    the capped `findFiles` path. A shared `add()` closure preserves the existing
    seen-set de-duplication for both branches.

### Behavior preserved

- Root-level-only matching for the default exact-name patterns (unchanged — a
  no-`**` pattern never recursed under `findFiles` either).
- Nested literal patterns containing a path separator (e.g. `src/config.yaml`)
  still resolve, because `Uri.joinPath` handles the relative segments.
- Glob patterns still expand through the search service with the
  `**/node_modules/**` exclusion and the 50-result cap.

### Verification

- `npx tsc -p ./ --noEmit` — clean.
- `node esbuild.js` — bundle builds.
- No automated test exists for `scanAutoPinPaths`: the function is a thin wrapper
  over VS Code filesystem APIs (`findFiles` / `fs.stat`) that are only available
  inside the extension host, and the repository currently ships no test sources
  (`extension/src/test` is absent). Verified by inspection and a manual reasoning
  pass over the literal/glob/nested cases above.
- Runtime confirmation in an Extension Development Host (F5) was not performed in
  this environment.

### User-facing record

`CHANGELOG.md` (root) `[Unreleased]` → Fixed carries a plain-language "Faster
startup" entry describing the removed search cost.
