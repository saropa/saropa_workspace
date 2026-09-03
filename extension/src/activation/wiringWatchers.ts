import * as vscode from "vscode";
import { ShortcutStore } from "../model/shortcutStore";
import { BranchSetBinder } from "../exec/branchSets";
import { KNOWN_CONFIG_DIRS, configDirName } from "../model/shortcut";
import { FolderWatchStore } from "../model/folderWatch";
import { FolderWatchEngine } from "../exec/folderWatchEngine";
import { getOutputChannel } from "../exec/terminalRunner";
import { WatchesTreeProvider } from "../views/watchesTreeProvider";
import { registerFolderWatchCommands } from "../commands/folderWatchCommands";
import { maybeSuggestBugsWatch } from "../commands/folderWatchSuggest";
import { syncViewCount } from "../views/viewCount";
import { runShortcutsOnSave, makeDebounced } from "./activationHelpers";

// Activation wiring block split out of extension.ts (and, before that, out of
// wiring.ts once that file itself grew past the project's line-count cap) so
// activate() stays a short, readable sequence of named steps. Both watcher-wiring
// functions (config/folder listeners and folder/file watches) live in one file
// since they are the two reactive-listener concerns extension.ts wires side by side.

// The reactive listeners: folder/config changes (rescan/refresh), run-on-save, and
// the hand-edited shortcuts-config file watcher.
export function wireWatchers(
  context: vscode.ExtensionContext,
  store: ShortcutStore,
  branchSetBinder: BranchSetBinder
): void {
  // Live refresh on a hand-edited shortcuts config: watch every folder's
  // saropa-workspace.json at the configured dir and all known legacy dirs, so
  // migration and hand edits trigger a repaint. The store's OWN writes also trip
  // the watcher, so refreshes are debounced + guarded by the re-entrancy check
  // in refresh() to coalesce bursts into a single repaint.
  const debouncedConfigRefresh = makeDebounced(() => void store.refresh(), 150);

  // The config-dir watchers are held in a mutable holder so the configDir-change
  // handler below can dispose the CURRENT set before creating a fresh one.
  // Without this, changing saropaWorkspace.configDir at runtime to a directory
  // outside KNOWN_CONFIG_DIRS left the new dir's saropa-workspace.json unwatched
  // until the next reload — the file-watcher glob baked in configDirName() at
  // activation time only and was never re-evaluated.
  //
  // A single wrapper disposable is pushed to context.subscriptions ONCE (not per
  // batch) so repeated configDir changes don't accumulate stale entries in the
  // subscriptions array. The wrapper delegates to whatever the current batch is.
  let configDirWatchers = createConfigDirWatchers(debouncedConfigRefresh);
  context.subscriptions.push({ dispose: () => configDirWatchers.dispose() });

  // Re-seed auto-shortcuts and refresh when folders change or the auto-shortcut
  // patterns setting is edited.
  context.subscriptions.push(
    // Folder set or auto-shortcut/recipe settings changed: the set of files that match
    // can change, so re-scan (clears the cached glob/detection). Telemetry only
    // shows/hides the Recent group, so a plain repaint refresh is enough there.
    vscode.workspace.onDidChangeWorkspaceFolders(() => void store.rescan()),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("saropaWorkspace.configDir")) {
        // The set of directories that must be watched depends on
        // configDirName(), which just changed. Tear down the old watchers and
        // create a fresh set that includes the new configDirName() value, so
        // hand edits to the new config dir's saropa-workspace.json trigger a
        // repaint. The wrapper disposable in context.subscriptions still
        // points at this variable, so no subscriptions accumulation.
        configDirWatchers.dispose();
        configDirWatchers = createConfigDirWatchers(debouncedConfigRefresh);
        void store.rescan();
      } else if (
        e.affectsConfiguration("saropaWorkspace.autoPins.patterns") ||
        e.affectsConfiguration("saropaWorkspace.recipes.enabled") ||
        e.affectsConfiguration("saropaWorkspace.aiContext.enabled") ||
        e.affectsConfiguration("saropaWorkspace.aiContext.claudeChatFolders")
      ) {
        void store.rescan();
      } else if (e.affectsConfiguration("saropaWorkspace.telemetry.enabled")) {
        void store.refresh();
      } else if (
        e.affectsConfiguration("saropaWorkspace.branchAware.enabled")
      ) {
        // Turning branch-awareness on aligns the active set to the current branch's
        // binding immediately (applyNow ignores the change-guard); turning it off is
        // a no-op here — the binder simply stops switching on the next checkout.
        void branchSetBinder.applyNow();
      }
    })
  );

  // Run-on-save: when a file is saved, run any runnable file shortcut that targets it
  // and has opted in (exec.runOnSave). Registered as a disposable so the listener
  // is torn down on deactivation; a leaked listener would double-fire after a
  // reload.
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((doc) =>
      runShortcutsOnSave(store, doc.uri)
    )
  );
}

// Build FileSystemWatchers for every known legacy config dir plus the CURRENT
// configDirName() (read fresh on each call). Returns a single composite
// Disposable that tears down the entire batch, so callers can swap it on a
// configDir change without accumulating stale entries in context.subscriptions.
function createConfigDirWatchers(
  debouncedConfigRefresh: () => void
): vscode.Disposable {
  const disposables: vscode.Disposable[] = [];
  const watchedDirs = new Set<string>(KNOWN_CONFIG_DIRS);
  watchedDirs.add(configDirName());
  for (const dir of watchedDirs) {
    const watcher = vscode.workspace.createFileSystemWatcher(
      `**/${dir}/saropa-workspace.json`
    );
    disposables.push(
      watcher,
      watcher.onDidChange(debouncedConfigRefresh),
      watcher.onDidCreate(debouncedConfigRefresh),
      watcher.onDidDelete(debouncedConfigRefresh),
    );
  }
  return vscode.Disposable.from(...disposables);
}

// Folder/file watches (PLAN_FILE_AND_FOLDER_WATCH): build the watch store + engine,
// register the add/manage commands, and return both the engine (so activate() can run its
// startup scan once, deferred past activation — the scan does file IO and must not run in
// the activation path) and the watch store (so the Saropa Workspace panel can show a Watches pane
// from the same source the Watches tree reads). The engine is a disposable so its live
// FileSystemWatchers are released on deactivation.
export function wireFolderWatches(
  context: vscode.ExtensionContext
): { engine: FolderWatchEngine; watchStore: FolderWatchStore } {
  const watchStore = new FolderWatchStore(context);
  const engine = new FolderWatchEngine(watchStore, getOutputChannel());
  context.subscriptions.push(engine);
  registerFolderWatchCommands(context, watchStore);

  // The "Watches" view: one row per watch, each carrying its unseen-files counter.
  const watches = new WatchesTreeProvider(watchStore);
  const watchesView = vscode.window.createTreeView("saropaWorkspace.watches", {
    treeDataProvider: watches,
  });
  context.subscriptions.push(watchesView, syncViewCount(watchesView, watches));

  // No activity-bar badge for unseen watched files. VS Code aggregates the badge of
  // EVERY view in a container onto the single container icon, so a count set here shows
  // as a bare number on the activity-bar icon with nothing naming what it counts, and
  // clicking that icon only opens the container — it does not mark any file seen, so the
  // number does not clear on the one gesture that looks like it should. Unseen files are
  // surfaced per-row in the Watches view instead, where the row names the watch.

  // Offer to watch the project's bugs/ folder for new files, once per folder.
  // Deferred (not awaited) so it never blocks activation.
  void maybeSuggestBugsWatch(context, watchStore);

  return { engine, watchStore };
}
