# Watch alerts scoped per project

A folder/file watch is stored in window-independent `globalState`, and the watch
engine scanned and armed every enabled watch with no project filter, so a watch
toasted its "new files" alert in every open VS Code window at once. A watch set up
in one project (notably the "watch this project's `bugs/` folder" offer) therefore
popped alerts in unrelated projects — a contacts bug report surfaced in the
saropa_workspace window.

## Finish Report (2026-06-28)

### Defect

`FolderWatchStore` persists the watch list, baselines, and unseen tallies in
`context.globalState` by design: a watch targets an absolute path and must resolve
identically across windows. The engine's startup scan (`scanAllEnabled`), live
watcher arming (`reconcileWatchers`), and debounced fire path all iterated the full
global list with only an `enabled` check. Because every window ran the same engine
over the same global list, an enabled watch raised its alert in all of them. The
per-project bugs-watch suggestion (`maybeSuggestBugsWatch`) made this visible: it is
offered per project but stored globally, so its alerts leaked into other projects.

### Change

Alerting is now opt-in per project, gated by a single shared predicate.

- **Model** (`model/folderWatch.ts`): added `alertScopes?: string[]` to
  `FolderWatch` — the workspace-folder fsPaths allowed to alert. Semantics are kept
  distinct on purpose: `undefined` = never scoped, alert only in the project that
  contains the target (lets pre-existing watches self-correct with no migration
  write); `[]` = explicitly muted everywhere (an opt-out that removed the last
  project must persist); `[paths]` = alert only in windows holding one of those
  folders. Added pure helpers `watchAlertsIn(watch, folderPaths)` (the single source
  of truth for "does this watch fire here"), `isPathInside`, and
  `defaultAlertScopes` (materializes the implicit containing-project scope before an
  opt-in/out edit).
- **Engine** (`exec/folderWatchEngine.ts`): the startup scan, watcher arming, and
  debounced fire all gate on `watchAlertsIn(watch, this.folderPaths())`, so an
  out-of-scope watch does nothing in a window (no scan, no live watcher, no toast).
  Subscribed to `onDidChangeWorkspaceFolders` to rescan when the open projects
  change, so a watch moving in/out of scope re-arms and surfaces files that landed
  while it was unwatched here; the subscription is disposed with the engine.
- **Commands** (`commands/folderWatchCommands.ts`): new watches (folder, file, and
  the bugs offer) are created with an explicit `alertScopes` set to the project(s)
  open in the creating window (the bugs offer scopes to its own folder). Added
  `saropaWorkspace.alertHereWatch` / `saropaWorkspace.muteHereWatch` and a shared
  `applyAlertHere`, also surfaced as an action in the Manage Folder Watches hub. The
  opt-out path leaves an explicit `[]` so a removed project stays muted.
- **Watches view** (`views/watchesTreeProvider.ts`): rows compute per-window alert
  state and render it — a struck bell plus a "not alerting here" description when the
  current project is not opted in, and a tooltip line naming the scope. The row
  `contextValue` now encodes both enabled state and scope
  (`watch<Enabled|Disabled>.<here|elsewhere>`) so the right opt-in/out inline action
  shows; `package.json` `when` clauses were switched to regex matches on that shape.
- **Strings**: command titles in `package.nls.json`; runtime strings
  (`folderWatch.alertHere`, `folderWatch.muteHere`, `folderWatch.alertHereOn/Off`,
  `folderWatch.noProjectOpen`, `watchesView.rowElsewhere`,
  `watchesView.scopeHere/scopeElsewhere`, and a `{scope}` param on
  `watchesView.rowTooltip`) in `src/i18n/locales/en.json`.

### Existing-watch behavior

A watch created before this change has no `alertScopes`, so it falls back to the
containing-project rule: it alerts only in the project whose folder contains its
target, and nowhere else. The leaked contacts bugs watch therefore stops alerting
in the saropa_workspace window with no user action and no migration step.

### Tests

`extension/src/test/folderWatch.test.ts` gained four cases pinning the gate: a
never-scoped watch alerts only in its containing project (and not in another);
an explicitly-scoped watch alerts only in listed projects (including a multi-root
window); an empty scope is muted everywhere; and `defaultAlertScopes` materializes
the containing project among the current folders. 17/17 unit tests pass.

### Verification

`npx tsc -p ./ --noEmit` clean; `node esbuild.js` bundle builds; targeted unit
tests pass. The new convention is recorded in
`plans/guides/STYLEGUIDE.md` §4.7 (window-independent state alerts per project,
never every window).
