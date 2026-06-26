add a new feature so we can add a watch on a folder for new or changed. 

e.g. on startup or during normal operation,  let me know if there are new files written in D:\src\saropa_workspace\bugs

or watch a file for changes and toast if there is one

must be on start up - so we need to cache the watched file list

can do the same for not-github commited files/folders

## Finish Report (2026-06-26)

### Status

Implemented for filesystem (new/changed) watches. The "not-git-committed
files/folders" item is a distinct engine (git index/working-tree state, not an
mtime diff) and is split into the still-active
[`PLAN_UNCOMMITTED_FILES_WATCH.md`](../PLAN_UNCOMMITTED_FILES_WATCH.md).

### What shipped

A folder/file watch feature that notifies on new or changed files, both live and on
window open, plus a sidebar view with per-watch counters.

- **Model** (`extension/src/model/folderWatch.ts`): a `FolderWatch` record
  (folder or file target, `new`/`changed` mode, optional glob), a pure
  `diffSnapshots` over relative-path → mtime maps, and a `FolderWatchStore` over
  `globalState` holding the watch list, the cached per-watch baseline snapshot, and
  a per-watch unseen-files tally. Three separate globalState keys so reading the
  small watch list never deserializes the large baselines, and a baseline write
  never rewrites the list. A `onDidChange` event signals list changes (engine
  re-arms watchers); a separate `onDidChangeCounts` signals tally changes (view +
  badge repaint without re-arming watchers).
- **Engine** (`extension/src/exec/folderWatchEngine.ts`): a deferred startup scan
  that diffs each watch against its cached baseline so files written while the
  window was closed surface on open (the "must be on startup" requirement), plus a
  per-watch `FileSystemWatcher` for live detection. A first scan with no baseline
  seeds silently rather than announcing every existing file as new. A bounded
  recursive walk skips VCS/build/cache directories and caps at 5000 files; symlinked
  directories are not followed (`Dirent.isDirectory()` is false for a symlink), so a
  symlink cycle cannot recurse infinitely. Each non-empty delta records the files as
  unseen and toasts, naming up to five files.
- **Watches view** (`extension/src/views/watchesTreeProvider.ts`): one row per
  watch, its description leading with the unseen count and a tinted bell glyph when
  files are pending; the view's activity-bar badge is the sum of unseen across all
  watches, derived (never tracked separately) so the per-row counts and the badge
  cannot disagree. Clicking a row opens the newest unseen file (or reveals the
  folder), clears that watch's tally, and the badge recalculates.
- **Commands** (`extension/src/commands/folderWatchCommands.ts`): watch a folder,
  watch a file, manage watches, and the row-level open/toggle/remove. A deferred,
  once-per-folder suggestion offers to watch a project's `bugs/` folder when one
  exists and is not already watched — detected at runtime, never a hardcoded path.
- Manifest (view, welcome, commands, Explorer and view menus), `package.nls.json`
  titles, `en.json` runtime strings, CHANGELOG `[Unreleased]`, and a STYLEGUIDE rule
  (§4.5) for standing counters that clear on interaction.

### Tests

`extension/src/test/folderWatch.test.ts` covers the pure snapshot diff (new vs
changed semantics, deletions ignored, backward-moving mtime ignored, deterministic
sort, empty-baseline behavior the engine must seed around) and the store's unseen
tally (accumulate/de-duplicate, per-watch clear, removal drops the total, duplicate
target+mode rejected, the counts event fires only on a real change). Full unit
suite: 763 pass, 0 fail.

### Verification

Type-check (`tsc --noEmit`) clean; production bundle builds; full `npm test` green.
Device/manual smoke of the live toast and badge behavior is the user handoff below.
