import * as vscode from "vscode";
import { ShortcutStore } from "../model/shortcutStore";
import { BranchSetBinder } from "../exec/branchSets";
import { FolderWatchStore } from "../model/folderWatch";
import { FolderWatchEngine } from "../exec/folderWatchEngine";
import { getOutputChannel } from "../exec/terminalRunner";
import { WatchesTreeProvider } from "../views/watchesTreeProvider";
import { registerFolderWatchCommands } from "../commands/folderWatchCommands";
import { maybeSuggestBugsWatch } from "../commands/folderWatchSuggest";
import { l10n } from "../i18n/l10n";
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
  // Re-seed auto-shortcuts and refresh when folders change or the auto-shortcut
  // patterns setting is edited.
  context.subscriptions.push(
    // Folder set or auto-shortcut/recipe settings changed: the set of files that match
    // can change, so re-scan (clears the cached glob/detection). Telemetry only
    // shows/hides the Recent group, so a plain repaint refresh is enough there.
    vscode.workspace.onDidChangeWorkspaceFolders(() => void store.rescan()),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (
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

  // Live refresh on a hand-edited shortcuts config: watch every folder's
  // .vscode/saropa-workspace.json and re-read it into the tree when it changes on
  // disk (the power-user path alongside the GUI editors). The store's OWN writes
  // also trip the watcher, so refreshes are debounced to coalesce the write-then-
  // notify burst into a single repaint rather than refreshing twice per edit.
  const configWatcher = vscode.workspace.createFileSystemWatcher(
    "**/.vscode/saropa-workspace.json"
  );
  const debouncedConfigRefresh = makeDebounced(() => void store.refresh(), 150);
  context.subscriptions.push(
    configWatcher,
    configWatcher.onDidChange(debouncedConfigRefresh),
    configWatcher.onDidCreate(debouncedConfigRefresh),
    configWatcher.onDidDelete(debouncedConfigRefresh)
  );
}

// Folder/file watches (PLAN_FILE_AND_FOLDER_WATCH): build the watch store + engine,
// register the add/manage commands, and return both the engine (so activate() can run its
// startup scan once, deferred past activation — the scan does file IO and must not run in
// the activation path) and the watch store (so the Saropa Launcher can show a Watches pane
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
  context.subscriptions.push(watchesView);

  // View title shows the watch count; cleared to undefined at zero so no "0"
  // appears on an empty view.
  const syncWatchesCount = (count: number): void => {
    watchesView.description = count > 0 ? String(count) : undefined;
  };
  context.subscriptions.push(watches.onDidChangeCount((c) => syncWatchesCount(c)));
  syncWatchesCount(watches.count);

  // Activity-bar badge: unseen new/changed files for watches that alert in THIS
  // window only (owned-here, opted-in-here, or global) — scoping the total to the
  // open folders so the badge never reflects another project's pending files (the
  // badge form of the "do not blast every project" rule). Recomputed when a tally or
  // the watch list changes, and when the open folders change (a watch moves in/out of
  // scope). Zero shows no badge (VS Code hides an undefined badge).
  const syncWatchesBadge = (): void => {
    const folders = (vscode.workspace.workspaceFolders ?? []).map(
      (f) => f.uri.fsPath
    );
    const total = watchStore.totalUnseen(folders);
    watchesView.badge =
      total > 0
        ? { value: total, tooltip: l10n("watchesView.badgeTooltip", { count: total }) }
        : undefined;
  };
  context.subscriptions.push(
    watchStore.onDidChangeCounts(() => syncWatchesBadge()),
    watchStore.onDidChange(() => syncWatchesBadge()),
    vscode.workspace.onDidChangeWorkspaceFolders(() => syncWatchesBadge())
  );
  syncWatchesBadge();

  // Offer to watch the project's bugs/ folder for new files, once per folder.
  // Deferred (not awaited) so it never blocks activation.
  void maybeSuggestBugsWatch(context, watchStore);

  return { engine, watchStore };
}
