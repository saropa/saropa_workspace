import * as vscode from "vscode";
import { ShortcutStore } from "./model/shortcutStore";
import { ShortcutsTreeProvider } from "./views/shortcutsTreeProvider";
import { ShortcutFilterState } from "./views/shortcutFilter";
import { registerFilterCommands } from "./commands/filterCommands";
import { DoubleClickDispatcher } from "./exec/doubleClick";
import { registerShortcutCommands, createRoutineHooks } from "./commands/shortcutCommands";
import { registerSetCommands } from "./commands/setCommands";
import { registerBranchSetCommands } from "./commands/branchSetCommands";
import { registerSimulationPreview } from "./commands/simulateRun";
import { registerRunAnalytics } from "./commands/runAnalytics";
import { bootSequence, maybeRunBootSequenceOnOpen } from "./commands/bootSequence";
import { initFocusMode } from "./commands/focusMode";
import { registerRunOutputDiff } from "./commands/diffRuns";
import { registerTerminalCleanup, setRoutineHooks } from "./exec/runner";
import { Scheduler } from "./exec/scheduler";
import { ChainRunner } from "./exec/chainRunner";
import { GitEventWatcher } from "./exec/systemEvents";
import { BranchTracker } from "./exec/gitBranch";
import { BranchSetBinder } from "./exec/branchSets";
import { IdleMonitor } from "./exec/idleMonitor";
import { ShortcutExpiry } from "./exec/shortcutExpiry";
import { Heartbeat } from "./exec/heartbeat";
import { registerProcessMonitorCommands } from "./exec/processMonitorCommands";
import { PlannerPanel } from "./views/plannerPanel";
import { registerHygieneCommands } from "./exec/hygieneCommands";
import { registerBloatCommands } from "./exec/bloatCommands";
import { registerProjectStatsCommand } from "./exec/projectStats";
import { processRegistry } from "./exec/processRegistry";
import { metricBadges } from "./exec/metricBadges";
import { runStatusRegistry } from "./exec/runStatus";
import { telemetry } from "./exec/telemetry";
import { promptMemory } from "./exec/promptMemory";
import { tappedShortcuts } from "./model/tappedShortcuts";
import { registerRecipeCommands } from "./recipes/recipeCommands";
import { l10n } from "./i18n/l10n";
import {
  maybeOfferFavoritesImport,
  registerFavoritesImportWatchers,
  syncShortcutPathContext,
  wireRecentEditorTracking,
} from "./activation/activationHelpers";
import { setupSecondaryViews } from "./activation/wiringViews";
import { registerCommandModules } from "./activation/wiringCommands";
import { setupStatusBars } from "./activation/wiringStatusBars";
import { wireBackgroundEngines } from "./activation/wiringEngines";
import { wireWatchers, wireFolderWatches } from "./activation/wiringWatchers";
import { wireTreeViewState, SHOW_ALL_BRANCHES_KEY } from "./activation/viewState";

// Bind the on-device stores (telemetry, tapped-shortcut tracker, prompt memory,
// boot sequence) to this context before anything reads them. Split out of activate()
// so the store list can grow without pushing the caller past the line-count cap.
function initCoreStores(context: vscode.ExtensionContext): void {
  // Bind the local run-telemetry store to this context so the runner can record
  // every run (manual + scheduled) and the Recent group + "Run Shortcut..." palette
  // can read them. On-device only — nothing is transmitted (see the principle).
  telemetry.init(context);

  // Bind the tapped-shortcut tracker (opened/run shortcuts) used for the activity-bar
  // badge.
  tappedShortcuts.init(context);

  // Bind the interactive run-parameter memory (last ${prompt}/${pick} choice per
  // shortcut) so a parameterized run defaults to the previous value. Stored in
  // workspaceState (on-device, per-workspace, not synced).
  promptMemory.init(context);

  // Bind the workspace boot-sequence store (the ordered shortcut set offered on open).
  // workspaceState too — a boot sequence is about this workspace's files/tasks.
  bootSequence.init(context);
}

// Click dispatcher: single click opens, double click runs. It carries only the
// shortcut id, so callbacks look the shortcut back up from the store's current cache.
function createShortcutDispatcher(store: ShortcutStore): DoubleClickDispatcher {
  return new DoubleClickDispatcher(
    (id) => {
      const shortcut = store.findShortcut(id);
      if (shortcut) {
        void vscode.commands.executeCommand("saropaWorkspace.openPin", shortcut);
      }
    },
    (id) => {
      const shortcut = store.findShortcut(id);
      if (shortcut) {
        void vscode.commands.executeCommand("saropaWorkspace.runPin", shortcut);
      }
    }
  );
}

interface TreeViewParts {
  readonly tree: ShortcutsTreeProvider;
  readonly treeView: vscode.TreeView<vscode.TreeItem>;
  readonly branchTracker: BranchTracker;
}

// createTreeView (not registerTreeDataProvider) so the provider can serve as
// the drag-and-drop controller too — shortcuts are reordered and moved between
// groups by dragging. canSelectMany lets a multi-select drag move several shortcuts
// at once.
function createTreeView(
  context: vscode.ExtensionContext,
  store: ShortcutStore
): TreeViewParts {
  // The Shortcuts-view text/chip filter (WOW #28). Persisted per-workspace; the
  // provider reads it to decide which rows and groups are visible, and the find
  // bar (registered below) mutates it.
  const filterState = new ShortcutFilterState(context);

  // Branch-linked shortcuts (WOW #3): the tracker reads each folder's current branch
  // and fires on a checkout so the tree re-filters live. The "show all branches" escape
  // hatch (for a shortcut scoped to a deleted branch) is persisted per-workspace so a
  // reload keeps the chosen scope. Disposable so its .git/HEAD watchers are released.
  const branchTracker = new BranchTracker();
  context.subscriptions.push(branchTracker);
  const showAllBranches = context.workspaceState.get<boolean>(
    SHOW_ALL_BRANCHES_KEY,
    false
  );

  const tree = new ShortcutsTreeProvider(
    store,
    filterState,
    branchTracker,
    showAllBranches
  );
  const treeView = vscode.window.createTreeView("saropaWorkspace.pins", {
    treeDataProvider: tree,
    dragAndDropController: tree,
    canSelectMany: true,
    showCollapseAll: true,
  });
  context.subscriptions.push(treeView);

  registerFilterCommands(context, filterState, store);

  // Wire all the live tree-view state (filter message + chip keys, one-time gesture
  // tip, branch-scope affordances + toggle commands, and group collapse persistence).
  wireTreeViewState(context, store, tree, treeView, filterState, branchTracker);

  return { tree, treeView, branchTracker };
}

// The post-load tail: everything that needs the shortcut set actually loaded
// (store.init()) before it can run, plus the deferred one-time offers that follow
// it. Kept together, and after the synchronous wiring in activate(), because each
// step here either depends on store data or is explicitly fire-and-forget so it
// never blocks activation.
async function runPostLoadTasks(
  context: vscode.ExtensionContext,
  store: ShortcutStore,
  branchTracker: BranchTracker,
  scheduler: Scheduler,
  folderWatchEngine: ReturnType<typeof wireFolderWatches>["engine"]
): Promise<void> {
  await store.init();
  // Set the initial pinned-path context keys explicitly in case the init-time
  // onDidChange fired before the subscription above was attached.
  syncShortcutPathContext(store);

  // Read each folder's current branch now that the shortcut set is loaded; on
  // completion it fires onDidChangeBranch, which repaints the tree with branch
  // filtering applied and re-syncs the branch affordances. Deferred (not awaited) so it
  // never blocks activation — until it resolves, every branch-linked shortcut shows
  // (the safe default).
  void branchTracker.init();

  // Arm timers now that the initial shortcut set is loaded. The scheduler also re-arms
  // itself on every subsequent store change via its onDidChange subscription.
  scheduler.start();

  // Fire any run-on-startup shortcuts once, deferred past activation and de-duped on a
  // reload so a window reload storm does not re-run them.
  scheduler.runStartupShortcuts();

  // Scan the folder/file watches against their cached baselines, so a file written
  // while the window was closed is surfaced now. The engine defers the scan past
  // activation on its own timer; it arms its live watchers once the scan finishes.
  folderWatchEngine.runStartupScan();

  // Time-bomb / ephemeral shortcuts (WOW #9): sweep self-removing shortcuts now (a
  // shortcut whose deadline passed while the window was closed clears on open) and arm
  // the low-frequency timer + per-folder .git/HEAD watchers. Constructed after the
  // shortcut set is loaded so its activation sweep sees the real shortcuts. Disposable
  // so its timer and watchers are cleared on deactivation (a leaked timer would keep
  // firing).
  context.subscriptions.push(new ShortcutExpiry(store));

  // Offer to import favorites from other extensions once per workspace, only
  // when such a file actually exists, so first-time users keep their old shortcuts
  // without being nagged on every launch. The watchers re-run the same gated
  // offer when a source file or settings key appears/changes later in the session.
  void maybeOfferFavoritesImport(context, store);
  registerFavoritesImportWatchers(context, store);

  // Offer to run the workspace boot sequence once this session, only when it is
  // enabled and non-empty (no prompt otherwise). Runs after the shortcut set is loaded
  // so the member shortcuts resolve; the confirm is the "no silent execution" gate.
  void maybeRunBootSequenceOnOpen(store);

  // Re-establish the focus-mode context key from its persisted flag, so a window
  // reloaded while focus is active shows "Exit Focus" rather than "Focus" (the
  // written files.exclude survives the reload, so the toggle state must too).
  void initFocusMode(context);
}

// Entry point: constructs the shortcut store, the on-device stores, the tree view,
// folder/file watches, all command modules, status bars, and the background engines
// (scheduler, chain runner, git/idle/expiry watchers), then runs the post-load tail
// once the shortcut set has finished loading.
export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const store = new ShortcutStore(context);

  initCoreStores(context);

  const dispatcher = createShortcutDispatcher(store);
  context.subscriptions.push({ dispose: () => dispatcher.dispose() });

  const { tree, treeView, branchTracker } = createTreeView(context, store);

  // Folder/file watches: register the add/manage commands and build the engine + store.
  // Constructed before setupSecondaryViews so the Saropa Launcher can be handed the watch
  // store and show a Watches pane from the same source the Watches tree reads. The engine's
  // startup scan is fired below, deferred past activation, so files written while the window
  // was closed are surfaced on open without doing file IO in activate().
  const { engine: folderWatchEngine, watchStore } = wireFolderWatches(context);

  setupSecondaryViews(context, store, watchStore);

  // Register the command-module subsystems; the returned binder is re-applied by
  // the config watcher when branch-awareness is toggled.
  const branchSetBinder = registerCommandModules(context, store, dispatcher, branchTracker);

  setupStatusBars(context, store, tree, treeView);

  // Background engines; the scheduler is started below once the shortcut set is loaded.
  const scheduler = wireBackgroundEngines(context, store);

  wireWatchers(context, store, branchSetBinder);

  // Track editor focus/close so a pinned file opened or closed by any means (not
  // just a shortcut click) lands in Recent and clears its per-row "untapped" dot.
  wireRecentEditorTracking(context, store);

  await runPostLoadTasks(context, store, branchTracker, scheduler, folderWatchEngine);
}

// No-op: every disposable this extension creates is pushed onto
// context.subscriptions, so VS Code tears them all down on its own; nothing here
// needs an explicit teardown step in Phase 1.
export function deactivate(): void {
  // Subscriptions (tree, commands, terminal cleanup, dispatcher) are disposed by
  // VS Code via context.subscriptions; nothing extra to tear down in Phase 1.
}
