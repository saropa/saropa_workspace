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

  // The config-dir watchers are held in a mutable holder — a plain closure variable,
  // not a class field (#14) — because this whole function is a closure-style module
  // (see the file-level comment: activate() wiring split into named functions, not
  // classes), and the variable's only job is to be visible to the two other closures
  // in this function (the config-change handler and the subscriptions wrapper below)
  // that read/replace it. A class field would need its own class just to hold this
  // one mutable reference, adding a construct/dispose lifecycle for no benefit over a
  // `let` that already lives exactly as long as wireWatchers's closures do.
  // So the configDir-change handler below can dispose the CURRENT set before creating
  // a fresh one. Without this, changing saropaWorkspace.configDir at runtime to a
  // directory outside KNOWN_CONFIG_DIRS left the new dir's saropa-workspace.json
  // unwatched until the next reload — the file-watcher glob baked in configDirName()
  // at activation time only and was never re-evaluated.
  //
  // A single wrapper disposable is pushed to context.subscriptions ONCE (not per
  // batch) so repeated configDir changes don't accumulate stale entries in the
  // subscriptions array. The wrapper delegates to whatever the current batch is.
  let configDirWatchers = createConfigDirWatchers(debouncedConfigRefresh);
  context.subscriptions.push({ dispose: () => configDirWatchers.dispose() });

  // Cache of the resolved dir name the current `configDirWatchers` batch actually
  // watches, so the handler below (#17, #19) can tell a REAL change (the effective
  // directory is different) from a config-change event that fired without one — e.g.
  // VS Code re-emits onDidChangeConfiguration when a setting is written at a scope
  // that doesn't change the resolved value (a workspace-scope write identical to the
  // already-effective user-scope value), or a settings-sync round-trip rewrites the
  // same value. Recreating the FileSystemWatcher batch on every such event is wasted
  // work and briefly drops watch coverage for no reason.
  let lastConfigDirName = configDirName();

  // Debounced recreation (#17, #19): wraps the dispose/recreate pair so a burst of
  // configDir-affecting events (programmatic setting writes, or VS Code applying a
  // change at multiple scopes in one gesture) collapses into at most one rebuild
  // after 150ms of quiet, and skips the rebuild entirely when the resolved dir name
  // did not actually change.
  const recreateConfigDirWatchers = makeDebounced(() => {
    const currentDirName = configDirName();
    if (currentDirName === lastConfigDirName) {
      // Same effective directory — nothing to rewatch, so leave the existing batch
      // (and its coverage) alone.
      return;
    }
    lastConfigDirName = currentDirName;
    // Tear down the old watchers and create a fresh set that includes the new
    // configDirName() value, so hand edits to the new config dir's
    // saropa-workspace.json trigger a repaint. The wrapper disposable in
    // context.subscriptions still points at this variable, so no subscriptions
    // accumulation.
    configDirWatchers.dispose();
    configDirWatchers = createConfigDirWatchers(debouncedConfigRefresh);
    void store.rescan();
  }, 150);

  // Re-seed auto-shortcuts and refresh when folders change or the auto-shortcut
  // patterns setting is edited.
  context.subscriptions.push(
    // Folder set or auto-shortcut/recipe settings changed: the set of files that match
    // can change, so re-scan (clears the cached glob/detection). Telemetry only
    // shows/hides the Recent group, so a plain repaint refresh is enough there.
    vscode.workspace.onDidChangeWorkspaceFolders(() => void store.rescan()),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("saropaWorkspace.configDir")) {
        // The set of directories that must be watched depends on configDirName(),
        // which MAY have just changed — recreateConfigDirWatchers debounces the
        // rebuild and skips it when the resolved name is unchanged (#17, #19), so
        // this handler no longer needs to reason about rapid-fire event bursts
        // itself.
        recreateConfigDirWatchers();
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
//
// Single-owner invariant (#20): this is the ONLY place in the extension that
// constructs the config-dir `saropa-workspace.json` FileSystemWatchers. wireWatchers
// above holds the one live batch (in the `configDirWatchers` closure variable) and
// always disposes the previous batch before calling this again (see
// recreateConfigDirWatchers). A second caller constructing its own batch would
// double-watch the same globs — every hand edit would refresh the store twice — and
// would not be reachable through the dispose-before-recreate path above, leaking a
// batch that this module can no longer tear down. If a future feature needs to react
// to the config file changing, it should consume store.onDidChange /
// store.refresh() rather than adding a second watcher here.
//
// createFileSystemWatcher() itself does not throw for an ordinary glob like this one
// (VS Code validates the glob pattern, not the filesystem — the directory need not
// exist yet, which is required here since a legacy/uncreated config dir is exactly
// what this batch watches for). There is no try/catch or fallback around the calls
// below: an exception here is a genuine defect (e.g. a malformed glob), not an
// expected runtime condition, so it is left to propagate and surface via VS Code's
// extension host error reporting rather than being silently swallowed.
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
  registerFolderWatchCommands(context, watchStore, engine);

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
