# Folder-watch confirmation toasts auto-dismiss

The folder-watch configuration confirmations (added / removed / no-watches) were
shown with a buttonless `showInformationMessage`, which VS Code gives no timeout
and which can linger in the toast stack until manually dismissed. They now clear
themselves after a short delay, while action-bearing alerts keep their persistent
form.

## Finish Report (2026-06-28)

### Defect

`folderWatchCommands.ts` reported every watch configuration change with
`vscode.window.showInformationMessage(message)` and no action button. VS Code's
message API exposes no auto-dismiss timeout, and a buttonless information toast can
remain in the notification stack until the user dismisses it by hand. The reported
symptom was the watch-added confirmation — "Watching `bugs` for new and changed
files, including changes made while this window was closed." (`folderWatch.addedChanged`)
— never timing out. The same pattern affected the sibling confirmations
(`folderWatch.addedNew`, `folderWatch.addedFile`, `folderWatch.removed`,
`folderWatch.none`).

### Change

Added a local `notifyWatchChange(message)` helper in `folderWatchCommands.ts` that
shows the acknowledgment through `vscode.window.withProgress` at
`ProgressLocation.Notification`, resolving after a fixed delay (`WATCH_NOTICE_MS`,
4000 ms). A progress notification closes the moment its task settles, so the
confirmation auto-dismisses — the behavior the plain message API does not provide.
The six pure-confirmation call sites were routed through the helper.

Two call sites were deliberately left on `showInformationMessage`:

- The bugs-folder offer prompt (`folderWatch.suggestBugs` with the
  `folderWatch.suggestBugsAction` button) — it carries an action and must persist
  until the user answers.
- The engine's "files changed — Open" alerts in `folderWatchEngine.ts`
  (`folderWatch.changedFiles` / `newFiles` / `newFilesStartup`) — they carry an
  Open action and are meant to stay until acted on. Untouched.

### Convention recorded

`plans/guides/STYLEGUIDE.md` section 4.1a now states the rule: a notification that
only confirms a completed action auto-dismisses (progress-notification helper); a
notification the user is expected to act on keeps the persistent
`showInformationMessage(message, action)` form.

### Verification

- `npx tsc -p ./ --noEmit`: `folderWatchCommands.ts` has zero type errors.
- Strings stay externalized through `l10n`; no new keys were needed (the helper
  changes only the delivery surface, not the message text). Voice and American
  English unchanged.

### Blocked

The full bundle (`node esbuild.js`) and the unit-test bundle (`npm test`) cannot
build because of a pre-existing, unrelated syntax error in
`src/views/launcherAssets.ts:525` ("Expected `;` but found `shown`") from the
launcher workstream, already committed on `main`. That file is a separate
workstream and was not modified here. The notification change is independently
type-clean; once the launcher file builds, the existing `folderWatch.test.ts`
(model diff logic, unaffected by this change) runs unchanged.
