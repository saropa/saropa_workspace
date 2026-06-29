# Watch project-ownership and global marker

The Watches view listed every folder/file watch in every window, flagging
out-of-project ones with a struck bell and a "not alerting here" note, which read
as broken data. This change makes a watch belong to the project containing its
target (and always fire there), hides other projects' watches from a window
entirely, and introduces an explicit "global" watch that is marked distinctly.

## Finish Report (2026-06-28)

### Defect

Folder/file watches are stored in window-independent `globalState`, so the watch
list is identical in every open window. A prior change (same day,
`watch-alerts-per-project-scope.md`) gated *alerting* per project via
`alertScopes`, but the Watches sidebar and the launcher Watches pane still
*listed* every watch regardless of project, rendering out-of-scope rows with a
`bell-slash` glyph and a `watchesView.rowElsewhere` ("not alerting here")
description. A watch on a project's own `bugs/` folder could also read "not
alerting here" when its stored `alertScopes` did not match the live folder path,
and the activity-bar badge summed unseen files across all watches, so one
project's pending count surfaced in unrelated windows.

### Resolution

The single source of truth `watchAlertsIn(watch, folderPaths)` was rewritten to a
three-step rule: a global watch alerts everywhere; a project always alerts for a
target inside one of its folders (automatic, independent of `alertScopes`); only
then does `alertScopes` opt an outside-the-project target into extra windows. This
guarantees a project always sees its own watches and removes the prior
`[]`-means-muted-everywhere semantic (a watch is silenced by disabling it, not by
an empty scope).

A `global?: boolean` field was added to `FolderWatch`, with an `isGlobalWatch`
helper. Both the Watches tree (`watchesTreeProvider`) and the launcher Watches
pane (`launcherView` + `launcherItems.watchLauncherItem`) now filter their lists
to `watchAlertsIn`, so other projects' watches are absent rather than flagged. A
global watch is marked with a `globe` glyph and a "global" note in both surfaces
and in the Manage Folder Watches QuickPick; the tooltip states it alerts in every
project. The activity-bar badge total (`FolderWatchStore.totalUnseen`) gained an
optional `folderPaths` argument and is now computed against the open folders, so a
window's badge only counts watches that fire in it.

The inline row menu was reduced to enable/disable + remove; the per-project
opt-in/out and the new Make global / Make local toggle live in the Manage Folder
Watches hub. The superseded `saropaWorkspace.alertHereWatch` /
`saropaWorkspace.muteHereWatch` commands, their inline `view/item/context`
entries, `commandPalette` stubs, and NLS titles were removed, and the row
`contextValue` was simplified from `watch<State>.<here|elsewhere>` to
`watch<State>`. `defaultAlertScopes` and its test were dropped (no consumer under
the new additive `alertScopes` semantics). The bug-suggestion path
(`maybeSuggestBugsWatch`) no longer stores a redundant `alertScopes` for an
in-project target.

### Affected surfaces

- `extension/src/model/folderWatch.ts` — `global` field, rewritten
  `watchAlertsIn`, `isGlobalWatch`, scoped `totalUnseen`, removed
  `defaultAlertScopes`.
- `extension/src/views/watchesTreeProvider.ts` — list filter, global marking,
  filtered count, repaint on workspace-folder change, simplified `contextValue`.
- `extension/src/views/launcherView.ts` / `launcherItems.ts` — same filter and
  global marking on the launcher Watches cards.
- `extension/src/commands/folderWatchCommands.ts` — Make global / Make local in
  the manage hub, additive `applyAlertHere`, removed inline command wrappers.
- `extension/src/activation/wiring.ts` — badge total scoped to open folders,
  recomputed on folder change.
- `extension/package.json`, `extension/package.nls.json`,
  `extension/src/i18n/locales/en.json` — removed alert/mute commands + menus +
  strings; added global row/scope/make strings.
- `plans/guides/STYLEGUIDE.md` §4.7 — rule rewritten: project owns its state, a
  window only lists what fires in it, cross-project items are marked "global".

### Verification

- `npx tsc -p ./ --noEmit` — clean.
- `npm run test:unit` (Node built-in runner, vscode-stubbed) — 869 pass, 0 fail.
  New coverage: global-watch alerting, own-folder alerts regardless of scope,
  scoped badge total, and global launcher-card rendering (idle + unseen).

### Notes

- The earlier same-day `watch-alerts-per-project-scope.md` history record is left
  intact; it accurately documents the opt-in scoping design this change
  supersedes.
- Existing watches need no migration: an absent/empty `alertScopes` resolves to
  "own project only", and `global` defaults to local.
