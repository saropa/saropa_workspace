# Saropa Launcher: Watches and Project files panes

The Saropa Launcher (the bottom-Panel webview) surfaced only the user's shortcuts
and the auto-detected recipes; the sidebar's Watches and Project Files views had no
equivalent in the Panel, so a watch or a surfaced manifest could not be searched or
opened from the launcher. This change adds two new launcher panes — Watches and
Project files — that mirror those sidebar views from the same data sources.

## Finish Report (2026-06-28)

### Scope

VS Code extension (TypeScript) only. No Dart/Flutter code. Extension runtime strings
were externalized at write time (two new `en.json` keys).

### What changed

- **Item model and pure builders** (`extension/src/views/launcherItems.ts`): the
  `LauncherItem.pane` union gained `"watches"` and `"files"`. Two vscode-free builders
  were added — `watchLauncherItem` and `fileLauncherItem` — that format a watch row and
  a project-file row into the same `LauncherItem` shape the grid renders. Both are
  openable, not runnable, carry no right-click menu, and reuse the existing
  `watchesView.row*` / `projectFiles.desc*` catalog keys and the shared `fileTypeIcon`
  token map so the launcher and the sidebar never disagree on glyph, tint, or state copy.

- **Host wiring** (`extension/src/views/launcherView.ts`): `LauncherViewProvider` now
  takes the `FolderWatchStore` and the `ProjectFilesTreeProvider`. `post()` became async
  and assembles the watch cards (from `watchStore.list()` + per-watch `unseenCount`) and
  the project-file cards (from `projectFiles.listSurfacedFiles()` + a host-computed
  relative time and shortcut-state lookup) after the shortcut/recipe cards. The provider
  repaints on the watch store's list and unseen-count events and on save/folder/config
  changes. Two new untrusted-message handlers route opens by a re-validated target:
  `openWatch` only fires for an id that resolves in the live watch list; `openFile` only
  fires for an fsPath that re-resolves in the live surfaced-file set.

- **Surfaced-file accessor** (`extension/src/views/projectFilesProvider.ts`): added
  `listSurfacedFiles()` as the single source of "what the Project Files surface shows"
  (enabled toggle + configured names + scan), reused by the tree's root `getChildren` and
  by the launcher so the two cannot diverge.

- **Webview rendering** (`extension/src/views/launcherAssets.ts`): `paneModel` now emits
  four panes in fixed order — the two grouped panes (mine, recipes) followed by two flat
  panes (watches, files). Flat panes render their cards directly under the pane head with
  no collapsible group (a single category wrapped in one group would double the header);
  `.pane-flat` adds top margin so the first row clears the pane-head divider. Cards route
  their open by pane (`openWatch` / `openFile` / store `open`), attach a context menu only
  when the row has menu entries, and tag `data-pane` so the header "{n} shortcuts" count
  totals only the mine + recipes cards, never the mirrored panes.

- **Activation order** (`extension/src/activation/wiring.ts`,
  `extension/src/extension.ts`): `wireFolderWatches` now returns `{ engine, watchStore }`
  and is constructed before `setupSecondaryViews`, which gained a `watchStore` parameter,
  so the launcher can be handed the watch store at construction.

### Design decision (recorded in STYLEGUIDE 1.1a)

A mirrored watch/file card does NOT open on a bare primary click; it follows the
launcher's existing expand-then-act rule (click opens the drawer, whose Open is the
action). Rationale: opening a watch clears its unseen counter, so a single-click open
would silently mark a watch seen — the same accidental-action failure the launcher's
browse-then-act model exists to prevent. The host validates every open target rather
than trusting the webview-supplied id/path.

### Repository-state note

A concurrent folder-watch workstream's commit (`ae43dbd`) bundled an in-progress
snapshot of these launcher files, capturing `launcherAssets.ts` before a one-line
comment fix (a backtick inside the client-script template literal terminated the
string early). HEAD therefore did not type-check until the follow-up commit that
carried the fix plus the STYLEGUIDE convention bullets and a CHANGELOG version-link
bump. The full feature is captured across the two commits.

### Tests and verification

- `extension/src/test/launcherItems.test.ts` extended with six cases: an enabled watch
  with unseen files (blue bell, leading count), an idle enabled watch (plain eye), a
  disabled watch (closed eye, muted, no count), a project file with version + freshness
  and its file-type glyph, a versionless file already a shortcut (freshness + tag), and
  an unmapped file type (generic file glyph fallback).
- `npm run test:unit` — 838 pass, 0 fail.
- `npx tsc -p ./ --noEmit` — clean.
- `node esbuild.js` — bundle builds (validates the webview client script).
- Not run in an Extension Development Host; the live rendering of the two panes is
  unverified by machine.
