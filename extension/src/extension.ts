import * as vscode from "vscode";
import { PinStore } from "./model/pinStore";
import { isAnnotationPin } from "./model/pin";
import { PinsTreeProvider } from "./views/pinsTreeProvider";
import {
  PinFilterState,
  countHidden,
  filterMessage,
  isFilesChipOn,
  isScriptsChipOn,
} from "./views/pinFilter";
import { registerFilterCommands } from "./commands/filterCommands";
import { RecipesTreeProvider } from "./views/recipesTreeProvider";
import { ProjectFilesTreeProvider } from "./views/projectFilesProvider";
import { PinFolderItem, PinTreeItem, RecentRootItem } from "./views/pinTreeItem";
import { SuggestionTracker } from "./views/suggestions";
import { TabPinSuggester } from "./views/tabPinSuggestions";
import { ScheduleStatusBar } from "./views/scheduleStatusBar";
import { SetStatusBar } from "./views/setStatusBar";
import { DoubleClickDispatcher } from "./exec/doubleClick";
import { registerPinCommands, createRoutineHooks } from "./commands/pinCommands";
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
import { PinExpiry } from "./exec/pinExpiry";
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
import { tappedPins } from "./model/tappedPins";
import { registerRecipeCommands } from "./recipes/recipeCommands";
import { l10n } from "./i18n/l10n";
import {
  maybeOfferFavoritesImport,
  registerFavoritesImportWatchers,
  syncPinnedPathContext,
} from "./activation/activationHelpers";
import {
  setupSecondaryViews,
  registerCommandModules,
  setupStatusBars,
  wireBackgroundEngines,
  wireWatchers,
} from "./activation/wiring";

// Persists the "show pins from all branches" escape hatch (WOW #3) per-workspace, so
// a window reload keeps the chosen branch scope (filtering by current branch vs.
// showing every branch-linked pin).
const SHOW_ALL_BRANCHES_KEY = "saropaWorkspace.showAllBranches";

// Gate flag (global, not per-workspace) so the one-time "single-click opens,
// double-click runs" tip shows at most once ever — the first time the user has a
// real pin. It teaches the core gesture to users who add a pin from the editor /
// Explorer menu and so never see the empty-view welcome that states it (UI plan,
// Phase 3). Once shown, the gesture still lives in every pin's hover.
const GESTURE_TIP_SHOWN_KEY = "saropaWorkspace.gestureTipShown";

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const store = new PinStore(context);

  // Bind the local run-telemetry store to this context so the runner can record
  // every run (manual + scheduled) and the Recent group + "Run Pin..." palette can
  // read them. On-device only — nothing is transmitted (see the principle).
  telemetry.init(context);

  // Bind the tapped-pin tracker (opened/run pins) used for the activity-bar badge.
  tappedPins.init(context);

  // Bind the interactive run-parameter memory (last ${prompt}/${pick} choice per
  // pin) so a parameterized run defaults to the previous value. Stored in
  // workspaceState (on-device, per-workspace, not synced).
  promptMemory.init(context);

  // Bind the workspace boot-sequence store (the ordered pin set offered on open).
  // workspaceState too — a boot sequence is about this workspace's files/tasks.
  bootSequence.init(context);

  // Click dispatcher: single click opens, double click runs. It carries only the
  // pin id, so callbacks look the pin back up from the store's current cache.
  const dispatcher = new DoubleClickDispatcher(
    (id) => {
      const pin = store.findPin(id);
      if (pin) {
        void vscode.commands.executeCommand("saropaWorkspace.openPin", pin);
      }
    },
    (id) => {
      const pin = store.findPin(id);
      if (pin) {
        void vscode.commands.executeCommand("saropaWorkspace.runPin", pin);
      }
    }
  );
  context.subscriptions.push({ dispose: () => dispatcher.dispose() });

  // createTreeView (not registerTreeDataProvider) so the provider can serve as
  // the drag-and-drop controller too — pins are reordered and moved between
  // groups by dragging. canSelectMany lets a multi-select drag move several pins
  // at once.
  // The Pins-view text/chip filter (WOW #28). Persisted per-workspace; the
  // provider reads it to decide which rows and groups are visible, and the find
  // bar (registered below) mutates it.
  const filterState = new PinFilterState(context);

  // Branch-linked pins (WOW #3): the tracker reads each folder's current branch and
  // fires on a checkout so the tree re-filters live. The "show all branches" escape
  // hatch (for a pin scoped to a deleted branch) is persisted per-workspace so a
  // reload keeps the chosen scope. Disposable so its .git/HEAD watchers are released.
  const branchTracker = new BranchTracker();
  context.subscriptions.push(branchTracker);
  const showAllBranches = context.workspaceState.get<boolean>(
    SHOW_ALL_BRANCHES_KEY,
    false
  );

  const tree = new PinsTreeProvider(
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

  // Keep the filter affordances in sync: the chip context keys (which drive the
  // title-bar button visibility/icon) and the always-visible "filter active — N
  // hidden — clear" message. Re-run on any filter change AND on any store change,
  // since adding/removing a pin changes the hidden count while a filter is on.
  // This is the never-silently-empty guarantee: while filtering, the message is
  // always present, so a tree that collapsed to nothing never reads as data loss.
  const syncFilterView = (): void => {
    const filter = filterState.get();
    const active = filterState.isActive();
    void vscode.commands.executeCommand(
      "setContext",
      "saropaWorkspace.filterActive",
      active
    );
    void vscode.commands.executeCommand(
      "setContext",
      "saropaWorkspace.filterScripts",
      isScriptsChipOn(filter)
    );
    void vscode.commands.executeCommand(
      "setContext",
      "saropaWorkspace.filterFiles",
      isFilesChipOn(filter)
    );
    void vscode.commands.executeCommand(
      "setContext",
      "saropaWorkspace.filterFailed",
      filter.failedOnly === true
    );
    if (active) {
      const all = [
        ...store.getProjectPins().filter((p) => !p.isRecipe),
        ...store.getGlobalPins(),
      ];
      const hidden = countHidden(
        all,
        filter,
        (id) => runStatusRegistry.get(id)?.outcome === "failure"
      );
      treeView.message = filterMessage(filter, hidden);
    } else {
      treeView.message = undefined;
    }
  };
  context.subscriptions.push(
    filterState.onDidChange(() => syncFilterView()),
    store.onDidChange(() => syncFilterView())
  );
  // Paint the initial state now (a persisted filter must show its message on
  // open, before any change event fires).
  syncFilterView();

  // Activity-bar badge: the number of Pins-view pins the user has not yet opened
  // or run ("untapped"), as a discovery cue for pins added but never used. Recipe
  // pins live in their own Recipes view and are excluded so detected shortcuts
  // never inflate the count. Zero shows no badge (VS Code hides an undefined
  // badge) — the "don't show a zero" requirement. Recomputed on every store change
  // (a new pin bumps it) and on every tap (using a pin clears it).
  const refreshUntappedBadge = (): void => {
    const pins = [
      ...store.getProjectPins().filter((p) => !p.isRecipe),
      ...store.getGlobalPins(),
    ];
    const untapped = pins.filter((p) => !tappedPins.has(p.id)).length;
    treeView.badge =
      untapped > 0
        ? { value: untapped, tooltip: l10n("badge.untapped", { count: untapped }) }
        : undefined;
  };
  context.subscriptions.push(
    store.onDidChange(() => refreshUntappedBadge()),
    tappedPins.onDidChange(() => refreshUntappedBadge())
  );

  // One-time gesture tip (UI plan, Phase 3): the first time the user has a real,
  // actionable pin, name the single/double-click model once. The empty-view welcome
  // already states it, but a user who pins from the editor/Explorer menu lands
  // straight on a populated tree and never sees that copy. Gated on a global flag so
  // it shows at most once ever; annotation pins (comment/separator) are inert and do
  // not count, so the tip waits for a pin a gesture actually applies to.
  const maybeShowGestureTip = (): void => {
    if (context.globalState.get<boolean>(GESTURE_TIP_SHOWN_KEY, false)) {
      return;
    }
    const actionable = [
      ...store.getProjectPins().filter((p) => !p.isRecipe),
      ...store.getGlobalPins(),
    ].some((p) => !isAnnotationPin(p));
    if (!actionable) {
      return;
    }
    void context.globalState.update(GESTURE_TIP_SHOWN_KEY, true);
    void vscode.window.showInformationMessage(l10n("pin.gestureToast"));
  };
  context.subscriptions.push(store.onDidChange(() => maybeShowGestureTip()));
  maybeShowGestureTip();

  // Branch-linked pins (WOW #3): keep the title-bar affordances in sync. The
  // "branchShowAll" key flips between the two toggle buttons (show-all vs filter-by-
  // branch); "branchHasHidden" reveals the "Show pins from all branches" button only
  // when branch filtering is actually hiding something, so it never appears as a dead
  // control. Re-run on a store change (pins added/linked) and on a checkout.
  const syncBranchView = (): void => {
    void vscode.commands.executeCommand(
      "setContext",
      "saropaWorkspace.branchShowAll",
      tree.isShowingAllBranches()
    );
    void vscode.commands.executeCommand(
      "setContext",
      "saropaWorkspace.branchHasHidden",
      tree.hasBranchHiddenPins()
    );
  };
  context.subscriptions.push(
    store.onDidChange(() => syncBranchView()),
    branchTracker.onDidChangeBranch(() => syncBranchView())
  );
  syncBranchView();

  // The two branch-scope toggle commands (title-bar): one suspends branch filtering
  // (the deleted-branch escape hatch), the other resumes it. Both persist the choice
  // per-workspace and re-sync the affordances. Separate commands so each shows its
  // own label/icon gated by the branchShowAll context key.
  const setBranchScope = (showAll: boolean): void => {
    tree.setShowAllBranches(showAll);
    void context.workspaceState.update(SHOW_ALL_BRANCHES_KEY, showAll);
    syncBranchView();
  };
  context.subscriptions.push(
    vscode.commands.registerCommand("saropaWorkspace.showAllBranches", () =>
      setBranchScope(true)
    ),
    vscode.commands.registerCommand("saropaWorkspace.filterByBranch", () =>
      setBranchScope(false)
    )
  );

  // Persist a group's open/closed posture so a folder stays the way the user
  // left it across sessions.
  context.subscriptions.push(
    treeView.onDidCollapseElement((e) => {
      if (e.element instanceof PinFolderItem) {
        void store.setGroupCollapsed(e.element.pinGroup, e.element.scope, true);
      } else if (e.element instanceof RecentRootItem) {
        void telemetry.setRecentExpanded(false);
      }
    }),
    treeView.onDidExpandElement((e) => {
      if (e.element instanceof PinFolderItem) {
        void store.setGroupCollapsed(e.element.pinGroup, e.element.scope, false);
      } else if (e.element instanceof RecentRootItem) {
        void telemetry.setRecentExpanded(true);
      }
    })
  );

  setupSecondaryViews(context, store);

  // Register the command-module subsystems; the returned binder is re-applied by
  // the config watcher when branch-awareness is toggled.
  const branchSetBinder = registerCommandModules(context, store, dispatcher, branchTracker);

  setupStatusBars(context, store, tree, treeView);

  // Background engines; the scheduler is started below once the pin set is loaded.
  const scheduler = wireBackgroundEngines(context, store);

  wireWatchers(context, store, branchSetBinder);
  await store.init();
  // Set the initial pinned-path context keys explicitly in case the init-time
  // onDidChange fired before the subscription above was attached.
  syncPinnedPathContext(store);
  // Paint the initial untapped badge from the loaded pin set, for the same reason.
  refreshUntappedBadge();

  // Read each folder's current branch now that the pin set is loaded; on completion
  // it fires onDidChangeBranch, which repaints the tree with branch filtering applied
  // and re-syncs the branch affordances. Deferred (not awaited) so it never blocks
  // activation — until it resolves, every branch-linked pin shows (the safe default).
  void branchTracker.init();

  // Arm timers now that the initial pin set is loaded. The scheduler also re-arms
  // itself on every subsequent store change via its onDidChange subscription.
  scheduler.start();

  // Fire any run-on-startup pins once, deferred past activation and de-duped on a
  // reload so a window reload storm does not re-run them.
  scheduler.runStartupPins();

  // Time-bomb / ephemeral pins (WOW #9): sweep self-removing pins now (a pin whose
  // deadline passed while the window was closed clears on open) and arm the low-
  // frequency timer + per-folder .git/HEAD watchers. Constructed after the pin set
  // is loaded so its activation sweep sees the real pins. Disposable so its timer
  // and watchers are cleared on deactivation (a leaked timer would keep firing).
  context.subscriptions.push(new PinExpiry(store));

  // Offer to import favorites from other extensions once per workspace, only
  // when such a file actually exists, so first-time users keep their old pins
  // without being nagged on every launch. The watchers re-run the same gated
  // offer when a source file or settings key appears/changes later in the session.
  void maybeOfferFavoritesImport(context, store);
  registerFavoritesImportWatchers(context, store);

  // Offer to run the workspace boot sequence once this session, only when it is
  // enabled and non-empty (no prompt otherwise). Runs after the pin set is loaded
  // so the member pins resolve; the confirm is the "no silent execution" gate.
  void maybeRunBootSequenceOnOpen(store);

  // Re-establish the focus-mode context key from its persisted flag, so a window
  // reloaded while focus is active shows "Exit Focus" rather than "Focus" (the
  // written files.exclude survives the reload, so the toggle state must too).
  void initFocusMode(context);
}

export function deactivate(): void {
  // Subscriptions (tree, commands, terminal cleanup, dispatcher) are disposed by
  // VS Code via context.subscriptions; nothing extra to tear down in Phase 1.
}
