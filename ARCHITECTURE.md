# Architecture

A one-page map of how Saropa Workspace is put together. The extension is a
TypeScript VS Code extension bundled with esbuild; all source lives under
[extension/src/](extension/src/).

## Activation flow

[extension/src/extension.ts](extension/src/extension.ts) `activate()` wires
everything up and registers each disposable on `context.subscriptions`, so a
window reload tears it all down cleanly:

1. Construct the `ShortcutStore` (the single source of truth for shortcuts).
2. Create the click dispatcher (single click opens, double click runs).
3. Create the **Shortcuts** tree view (also the drag-and-drop controller).
4. Create the **Project Files** tree view (read-only file/version overview).
5. Register commands, the terminal-cleanup hook, the scheduler, the background
   process registry, and the smart-suggestion tracker.
6. Load the initial shortcut set (`store.init()`), then arm the scheduler.
7. Offer the one-time favorites import when a source file is detected.

`activate()` only wires things up; file IO and terminal work are deferred to the
commands and the store, never run eagerly in the activation path.

## Modules

```
extension/src/
  extension.ts            activate(): wires store, views, commands, scheduler
  model/
    shortcut.ts           Shortcut, ShortcutGroup, ShortcutExecConfig, ShortcutSchedule, schema version
    shortcutStore.ts      persistence + in-memory cache; project file + globalState
    projectFiles.ts       scan interesting files, stat them, extract versions
  views/
    shortcutsTreeProvider.ts  the Shortcuts tree + drag-and-drop controller
    shortcutTreeItem.ts   tree items for shortcuts, scope roots, and groups
    projectFilesProvider.ts  the Project Files tree + relative-time formatting
    scheduleStatusBar.ts  status-bar item for the next scheduled run
    suggestions.ts        on-device open-frequency tracker and shortcut prompt
  commands/
    shortcutCommands.ts   every registered command handler
  exec/
    runner.ts             assemble and run a shortcut (terminal or background channel)
    doubleClick.ts        timing-based open-vs-run discriminator
    scheduler.ts          in-process timers for scheduled shortcuts
    schedule.ts           next-occurrence math for atTime / everyMs
    processRegistry.ts    tracks background child processes (Stop action)
    runStatus.ts          last-run outcome per shortcut (badge / tooltip)
    recentRuns.ts         bounded, on-device recently-run list
  import/
    favoritesImport.ts    detect and import .favorites.json and sibling favorites
  i18n/
    l10n.ts               runtime string lookup with {token} interpolation
    locales/en.json       the English runtime catalog
```

## Data and storage

- **Project shortcuts** live in `<folder>/.vscode/saropa-workspace.json` with paths
  stored **relative** to the folder, so they survive clone/move and are shareable
  via the repository.
- **Global shortcuts** live in the extension's `globalState` with **absolute** paths,
  so they ride VS Code Settings Sync across machines.
- **Auto-shortcuts** are not persisted as data; they are recomputed each refresh from
  `saropaWorkspace.autoPins.patterns`. Removing one records its id in
  `removedAutoPins` so it is not re-seeded.
- The on-disk schema is versioned (`ProjectShortcutsFile.version`); new fields are
  added without breaking older files, and migrations run on read.

## Principles in the code

- **Local-first, no remote telemetry.** Nothing is transmitted; local run history
  and shortcut-suggestion counts are on-device only. See [docs/PRIVACY.md](docs/PRIVACY.md).
- **No silent async.** Every run surfaces an outcome (toast and/or the output
  channel).
- **Translation-ready.** No inline English: manifest strings use the NLS `%key%`
  pipeline (`package.nls.json`), runtime strings use `l10n()` and
  `src/i18n/locales/en.json`.
