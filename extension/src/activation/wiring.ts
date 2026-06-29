import * as vscode from "vscode";
import { ShortcutStore } from "../model/shortcutStore";
import { DoubleClickDispatcher } from "../exec/doubleClick";
import { BranchTracker } from "../exec/gitBranch";
import { BranchSetBinder } from "../exec/branchSets";
import { Scheduler } from "../exec/scheduler";
import { IdleMonitor } from "../exec/idleMonitor";
import { ChainRunner } from "../exec/chainRunner";
import { GitEventWatcher } from "../exec/systemEvents";
import { Heartbeat } from "../exec/heartbeat";
import { processRegistry } from "../exec/processRegistry";
import { metricBadges } from "../exec/metricBadges";
import { RecipesTreeProvider } from "../views/recipesTreeProvider";
import { ProjectFilesTreeProvider } from "../views/projectFilesProvider";
import { ShortcutsTreeProvider } from "../views/shortcutsTreeProvider";
import { LauncherViewProvider } from "../views/launcherView";
import { ShortcutTreeItem } from "../views/shortcutTreeItem";
import { SuggestionTracker } from "../views/suggestions";
import { TabPinSuggester } from "../views/tabPinSuggestions";
import { ScheduleStatusBar } from "../views/scheduleStatusBar";
import { SetStatusBar } from "../views/setStatusBar";
import { PlannerPanel } from "../views/plannerPanel";
import { registerTerminalCleanup, setRoutineHooks } from "../exec/runner";
import { getOutputChannel } from "../exec/terminalRunner";
import { FolderWatchStore } from "../model/folderWatch";
import { FolderWatchEngine } from "../exec/folderWatchEngine";
import { WatchesTreeProvider } from "../views/watchesTreeProvider";
import {
  registerFolderWatchCommands,
  maybeSuggestBugsWatch,
} from "../commands/folderWatchCommands";
import { registerSimulationPreview } from "../commands/simulateRun";
import { registerRunAnalytics } from "../commands/runAnalytics";
import { registerRunOutputDiff } from "../commands/diffRuns";
import { registerShortcutCommands, createRoutineHooks } from "../commands/shortcutCommands";
import { registerSetCommands } from "../commands/setCommands";
import { registerBranchSetCommands } from "../commands/branchSetCommands";
import { registerProcessMonitorCommands } from "../exec/processMonitorCommands";
import { registerHygieneCommands } from "../exec/hygieneCommands";
import { registerBloatCommands } from "../exec/bloatCommands";
import { registerProjectStatsCommand } from "../exec/projectStats";
import { registerRecipeCommands } from "../recipes/recipeCommands";
import { l10n } from "../i18n/l10n";
import {
  handleShortcutImportUri,
  runShortcutsOnSave,
  makeDebounced,
  syncShortcutPathContext,
} from "./activationHelpers";

// Activation wiring blocks split out of extension.ts so activate() stays a short,
// readable sequence of named steps. Each takes the locals it needs and returns the
// handles a later step depends on (the branch-set binder, the scheduler).

// The Recipes + Project Files secondary views, their title-count syncs, and the
// listeners that repaint them.
export function setupSecondaryViews(
  context: vscode.ExtensionContext,
  store: ShortcutStore,
  watchStore: FolderWatchStore
): void {
  // Dedicated "Recipes" view: the auto-detected shortcuts (open on GitHub, run
  // scripts, Saropa Suite tools), grouped by category. Kept as its own section so
  // detected recipes never bury the user's own shortcuts in the Shortcuts view. Read-
  // only and not arrangeable, so it is a plain provider (no drag-and-drop controller).
  const recipes = new RecipesTreeProvider(store);
  const recipesView = vscode.window.createTreeView("saropaWorkspace.recipes", {
    treeDataProvider: recipes,
    showCollapseAll: true,
  });
  context.subscriptions.push(recipesView);
  // Show the total detected-recipe count next to the view title. A zero count
  // clears the description (no "0" when nothing was detected), and the provider
  // only emits on a real change so the title does not flicker on every repaint.
  const syncRecipesCount = (count: number): void => {
    recipesView.description = count > 0 ? String(count) : undefined;
  };
  context.subscriptions.push(
    recipes.onDidChangeCount((count) => syncRecipesCount(count))
  );
  syncRecipesCount(recipes.count);

  // Third view in the container: a read-only list of interesting project files
  // (README, CHANGELOG, manifests) with each file's last-modified time and
  // declared version, so the user can see whether the changelog is current and
  // what version the project is up to without opening anything.
  const projectFiles = new ProjectFilesTreeProvider(store);
  const projectFilesView = vscode.window.createTreeView(
    "saropaWorkspace.projectFiles",
    { treeDataProvider: projectFiles }
  );
  context.subscriptions.push(projectFilesView);
  // Show the total surfaced-file count next to the view title. A zero count
  // clears the description (no "0" on an empty/disabled view), and the provider
  // only emits on a real change so the title does not flicker on every repaint.
  const syncProjectFilesCount = (count: number): void => {
    projectFilesView.description = count > 0 ? String(count) : undefined;
  };
  context.subscriptions.push(
    projectFiles.onDidChangeCount((count) => syncProjectFilesCount(count))
  );
  syncProjectFilesCount(projectFiles.count);
  // Repaint the project-files rows whenever shortcuts change, so the shortcut
  // indicator and the add/remove toggle reflect the current state immediately.
  context.subscriptions.push(store.onDidChange(() => projectFiles.refresh()));

  // Keep the "Workspace Shortcut" submenu showing only the valid action (Add when not
  // a shortcut, Remove when a shortcut) for the exact file right-clicked. Each scope's
  // shortcut files are published as a when-clause context-key object; the submenu
  // items gate on `resourcePath in/not in` it. This is per-resource accurate in
  // every surface (Explorer, editor body, editor tab, sidebar row) because the `in`
  // operator tests the acted-on resource, not the active editor. Synced on every
  // shortcut change (init fires onDidChange too, so the keys are set before first paint).
  context.subscriptions.push(
    store.onDidChange(() => syncShortcutPathContext(store))
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("saropaWorkspace.refreshProjectFiles", () =>
      projectFiles.refresh()
    )
  );

  // Repaint the project-files view when one of those files is saved (its mtime
  // and version change), when folders change, or when its settings are edited.
  // A save of any file is cheap to react to — the view rescans a handful of
  // stats — so this does not filter by filename.
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(() => projectFiles.refresh()),
    vscode.workspace.onDidChangeWorkspaceFolders(() => projectFiles.refresh()),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("saropaWorkspace.projectFiles")) {
        projectFiles.refresh();
      }
    })
  );

  // The "Saropa Launcher" Panel webview: the sidebar's surfaces in the bottom Panel, so
  // they can be searched without opening the activity-bar icon — the shortcut + recipe
  // panes (from the store), plus flat Watches and Project files panes (from the watch
  // store and the project-files provider). A second window onto those sources, not a copy:
  // it repaints from the same change events the trees do. retainContextWhenHidden keeps the
  // search text and scroll position while the Panel tab is in the background.
  const launcher = new LauncherViewProvider(
    store,
    watchStore,
    projectFiles,
    context.extensionUri
  );
  context.subscriptions.push(
    launcher,
    vscode.window.registerWebviewViewProvider(
      LauncherViewProvider.viewId,
      launcher,
      { webviewOptions: { retainContextWhenHidden: true } }
    )
  );
}

// Register the command-module subsystems and the routine hooks; returns the
// branch-set binder (the config watcher re-applies it on a settings change).
export function registerCommandModules(
  context: vscode.ExtensionContext,
  store: ShortcutStore,
  dispatcher: DoubleClickDispatcher,
  branchTracker: BranchTracker
): BranchSetBinder {
  registerTerminalCleanup(context);
  registerSimulationPreview(context);
  registerRunAnalytics(context);
  registerRunOutputDiff(context);
  registerShortcutCommands(context, store, dispatcher);

  // Named shortcut sets (multiple-favorite-sets roadmap): switch / create / rename /
  // delete / duplicate. The active set's project shortcuts are the tree's project
  // shortcuts, so switching simply swaps which set is live; global shortcuts stay
  // shared. The status-bar switcher below is the discoverable entry point.
  registerSetCommands(context, store);

  // Branch-aware shortcut sets (roadmap 3.2): bind a git branch to a shortcut set so
  // the active set follows the current branch on checkout. Built on the existing branch
  // tracker + named-set API; gated by saropaWorkspace.branchAware.enabled (off by
  // default, so single-set / non-git users see no change). Constructed before
  // branchTracker.init() below so it catches the initial branch read and aligns the
  // set to the current branch on open. Disposable so its tracker subscription is
  // released on deactivation.
  const branchSetBinder = new BranchSetBinder(context, store, branchTracker);
  context.subscriptions.push(branchSetBinder);
  registerBranchSetCommands(context, store, branchSetBinder);

  // Inject the routine engine's resolve + run hooks now that the store exists (the
  // runner cannot import the store/command layer without a cycle). A routine
  // shortcut's members are resolved and run through the same single-shortcut path the
  // tree uses.
  setRoutineHooks(createRoutineHooks(store));

  // Handle vscode://saropa.saropa-workspace/import?data=... links (WOW #4 import), so
  // a shared shortcut link opens VS Code, confirms, and adds the shortcut. Registered
  // as a disposable so the handler is torn down on deactivation.
  context.subscriptions.push(
    vscode.window.registerUriHandler({
      handleUri: (uri) => void handleShortcutImportUri(uri, store),
    })
  );
  // Helper commands invoked by "command" recipes (set up .env, open config files,
  // copy version, run nearest script).
  registerRecipeCommands(context);

  // Saropa Dashboard (roadmap 3.4): the openDashboard command (three tabs —
  // Processes / Analytics / Trends), the openProcessMonitor alias (#60) that opens
  // the Processes tab, and the grouped-snapshot command (#62). The store backs the
  // Analytics tab's shortcut-name resolution.
  registerProcessMonitorCommands(context, store);

  // Workspace hygiene scanner (recipe book section H, #63): the recursive
  // empty/oversized outlier scan that writes a dated JSON report and a sticky toast,
  // plus the per-instance saved-scan wizard.
  registerHygieneCommands(context, store);

  // Workspace bloat scan (#63): the directory-bloat half — measures the dirs VS Code
  // crawls on open + the test-downloader watcher guard, writes a dated Markdown
  // report, and offers Guard / Prune remediation for the open workspace.
  registerBloatCommands(context);

  // Sunrise project stats (#27): the per-language file/line aggregation + git
  // activity summary command, driven by the scheduled "Sunrise project stats" recipe.
  registerProjectStatsCommand(context);

  // Schedule & Workflow Planner webview: the visual day/week timelines and the
  // chained-trigger graph. Opens (or reveals the single instance of) the panel.
  context.subscriptions.push(
    vscode.commands.registerCommand("saropaWorkspace.openPlanner", () =>
      PlannerPanel.show(context, store)
    )
  );
  return branchSetBinder;
}

// The schedule + set status-bar items and the reveal/peek commands that need the
// tree-view handle.
export function setupStatusBars(
  context: vscode.ExtensionContext,
  store: ShortcutStore,
  tree: ShortcutsTreeProvider,
  treeView: vscode.TreeView<vscode.TreeItem>
): void {
  // Status-bar item for the soonest upcoming scheduled run; clicking it reveals
  // the shortcut in the tree. The reveal command lives here because it needs the tree
  // view handle created above.
  const scheduleStatusBar = new ScheduleStatusBar(store);
  context.subscriptions.push(scheduleStatusBar);

  // Status-bar shortcut-set switcher: shows the active set's name and opens the
  // switcher QuickPick on click. Hidden while the workspace is on the lone default
  // set, so single-set users see no new chrome until they create a second set.
  // Disposable so its status-bar item and store subscription are released on
  // deactivation.
  context.subscriptions.push(new SetStatusBar(store));
  context.subscriptions.push(
    vscode.commands.registerCommand("saropaWorkspace.revealNextScheduled", async () => {
      const id = scheduleStatusBar.getCurrentShortcutId();
      const shortcut = id ? store.findShortcut(id) : undefined;
      if (!shortcut) {
        return;
      }
      await treeView.reveal(tree.revealItem(shortcut), {
        select: true,
        focus: true,
        expand: true,
      });
    })
  );

  // Keyboard peek: peek the file shortcut currently selected in the Shortcuts view. A
  // keybinding cannot receive the focused tree item as an argument, so the command
  // reads the view's selection here (where the tree view handle lives) and delegates
  // to the shared peekShortcut command. No-op when nothing (or a non-shortcut row) is
  // selected.
  context.subscriptions.push(
    vscode.commands.registerCommand("saropaWorkspace.peekFocusedPin", () => {
      const selected = treeView.selection.find(
        (item) => item instanceof ShortcutTreeItem
      );
      if (selected instanceof ShortcutTreeItem) {
        void vscode.commands.executeCommand("saropaWorkspace.peekPin", selected.shortcut);
      }
    })
  );
}

// The background engines (scheduler, idle monitor, chain runner, git watcher,
// heartbeat, process registry, metric badges, suggestion trackers); returns the
// scheduler so activate can start it once the pin set is loaded.
export function wireBackgroundEngines(
  context: vscode.ExtensionContext,
  store: ShortcutStore
): Scheduler {
  // In-process scheduler for shortcuts with a schedule. Registered as a disposable so
  // every timer is cleared on deactivation (no orphaned timers leak).
  const scheduler = new Scheduler(store);
  context.subscriptions.push(scheduler);

  // Editor-idle detector (WOW #18): tracks time since the last VS Code interaction and
  // feeds the chain engine's run-on-idle triggers. Constructed before the chain engine
  // so it can be handed in; disposable so its listeners and poll timer are cleared.
  const idleMonitor = new IdleMonitor();
  context.subscriptions.push(idleMonitor);

  // Chain engine (recipe chaining + special events + run-on-idle): listens for
  // shortcut completions, system events (build / publish emitted by a marked shortcut,
  // gitCommit / gitPush from the repo watcher below), and idle crossings, and auto-
  // runs the shortcuts triggered by each. Disposable so every bus subscription is
  // released on deactivation.
  context.subscriptions.push(new ChainRunner(store, idleMonitor));

  // Git event watcher: fires gitCommit / gitPush on the system-event bus by watching
  // the repo's .git logs (no `git` process spawned). Feeds the chain engine's
  // event triggers. Disposable so its file watchers and debounce timers are cleared.
  context.subscriptions.push(new GitEventWatcher());

  // Toolchain heartbeat (#61): a setting-gated background sampler that appends to
  // reports/process-trend.csv and toasts only when a tool crosses a RAM / helper
  // ceiling. Off by default; it self-arms from its own setting. Disposable so its
  // timer is cleared on deactivation.
  context.subscriptions.push(new Heartbeat());

  // Background process registry: kill any still-running background runs on
  // deactivation so they do not outlive the extension.
  context.subscriptions.push(processRegistry);

  // Live metric badges (#24): dispose the engine on deactivation so its per-shortcut
  // file watchers are released (a leaked FileSystemWatcher would survive a reload). The
  // tree provider arms/reconciles the watchers; this only owns their teardown.
  context.subscriptions.push(metricBadges);

  // Smart shortcut suggestions: count file opens on-device and offer to add a shortcut
  // to a file the user opens often (gated once per file). No-op when disabled by setting.
  context.subscriptions.push(new SuggestionTracker(context, store));

  // Long-pinned-tab suggestions: when a native editor tab has stayed pinned past
  // the threshold and is not already a Saropa shortcut, offer to promote it. The
  // instance is held so the Restore command can clear its permanent dismissals.
  const tabPinSuggester = new TabPinSuggester(context, store);
  context.subscriptions.push(
    tabPinSuggester,
    vscode.commands.registerCommand(
      "saropaWorkspace.restoreTabSuggestions",
      async () => {
        const cleared = await tabPinSuggester.restoreDismissed();
        vscode.window.showInformationMessage(
          l10n("tabSuggest.restored", { count: cleared })
        );
      }
    )
  );
  return scheduler;
}

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
