import * as vscode from "vscode";
import { PinStore } from "./model/pinStore";
import { Pin, pinKind, isAnnotationPin } from "./model/pin";
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
import {
  registerTerminalCleanup,
  isRunnable,
  setRoutineHooks,
  getOutputChannel,
  runBlockReason,
  blockReasonLabel,
} from "./exec/runner";
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
import { detectFavoritesFiles, importAllDetected } from "./import/favoritesImport";
import { decodeSharedPin, describeSharedPin } from "./import/shareLink";
import { l10n } from "./i18n/l10n";

// Gate flag so the one-time "import existing favorites" prompt does not reappear
// once the user has answered (imported or dismissed) for this workspace.
const IMPORT_PROMPT_KEY = "saropaWorkspace.favoritesImportOffered";

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

  // Dedicated "Recipes" view: the auto-detected shortcuts (open on GitHub, run
  // scripts, Saropa Suite tools), grouped by category. Kept as its own section so
  // detected recipes never bury the user's own pins in the Pins view. Read-only and
  // not arrangeable, so it is a plain provider (no drag-and-drop controller).
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
  // Repaint the project-files rows whenever pins change, so the pinned indicator
  // and the pin/unpin toggle reflect the current state immediately.
  context.subscriptions.push(store.onDidChange(() => projectFiles.refresh()));

  // Keep the "Workspace Pin" submenu showing only the valid action (Add when not
  // pinned, Remove when pinned) for the exact file right-clicked. Each scope's
  // pinned files are published as a when-clause context-key object; the submenu
  // items gate on `resourcePath in/not in` it. This is per-resource accurate in
  // every surface (Explorer, editor body, editor tab, sidebar row) because the `in`
  // operator tests the acted-on resource, not the active editor. Synced on every
  // pin change (init fires onDidChange too, so the keys are set before first paint).
  context.subscriptions.push(
    store.onDidChange(() => syncPinnedPathContext(store))
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

  registerTerminalCleanup(context);
  registerSimulationPreview(context);
  registerRunAnalytics(context);
  registerRunOutputDiff(context);
  registerPinCommands(context, store, dispatcher);

  // Named pin sets (multiple-favorite-sets roadmap): switch / create / rename /
  // delete / duplicate. The active set's project pins are the tree's project pins,
  // so switching simply swaps which set is live; global pins stay shared. The
  // status-bar switcher below is the discoverable entry point.
  registerSetCommands(context, store);

  // Branch-aware pin sets (roadmap 3.2): bind a git branch to a pin set so the
  // active set follows the current branch on checkout. Built on the existing branch
  // tracker + named-set API; gated by saropaWorkspace.branchAware.enabled (off by
  // default, so single-set / non-git users see no change). Constructed before
  // branchTracker.init() below so it catches the initial branch read and aligns the
  // set to the current branch on open. Disposable so its tracker subscription is
  // released on deactivation.
  const branchSetBinder = new BranchSetBinder(context, store, branchTracker);
  context.subscriptions.push(branchSetBinder);
  registerBranchSetCommands(context, store, branchSetBinder);

  // Inject the routine engine's resolve + run hooks now that the store exists (the
  // runner cannot import the store/command layer without a cycle). A routine pin's
  // members are resolved and run through the same single-pin path the tree uses.
  setRoutineHooks(createRoutineHooks(store));

  // Handle vscode://saropa.saropa-workspace/import?data=... links (WOW #4 import), so
  // a shared pin link opens VS Code, confirms, and adds the pin. Registered as a
  // disposable so the handler is torn down on deactivation.
  context.subscriptions.push(
    vscode.window.registerUriHandler({
      handleUri: (uri) => void handlePinImportUri(uri, store),
    })
  );
  // Helper commands invoked by "command" recipes (set up .env, open config files,
  // copy version, run nearest script).
  registerRecipeCommands(context);

  // Saropa Dashboard (roadmap 3.4): the openDashboard command (three tabs —
  // Processes / Analytics / Trends), the openProcessMonitor alias (#60) that opens
  // the Processes tab, and the grouped-snapshot command (#62). The store backs the
  // Analytics tab's pin-name resolution.
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

  // Status-bar item for the soonest upcoming scheduled run; clicking it reveals
  // the pin in the tree. The reveal command lives here because it needs the tree
  // view handle created above.
  const scheduleStatusBar = new ScheduleStatusBar(store);
  context.subscriptions.push(scheduleStatusBar);

  // Status-bar pin-set switcher: shows the active set's name and opens the switcher
  // QuickPick on click. Hidden while the workspace is on the lone default set, so
  // single-set users see no new chrome until they create a second set. Disposable
  // so its status-bar item and store subscription are released on deactivation.
  context.subscriptions.push(new SetStatusBar(store));
  context.subscriptions.push(
    vscode.commands.registerCommand("saropaWorkspace.revealNextScheduled", async () => {
      const id = scheduleStatusBar.getCurrentPinId();
      const pin = id ? store.findPin(id) : undefined;
      if (!pin) {
        return;
      }
      await treeView.reveal(tree.revealItem(pin), {
        select: true,
        focus: true,
        expand: true,
      });
    })
  );

  // Keyboard peek: peek the file pin currently selected in the Pins view. A
  // keybinding cannot receive the focused tree item as an argument, so the command
  // reads the view's selection here (where the tree view handle lives) and delegates
  // to the shared peekPin command. No-op when nothing (or a non-pin row) is selected.
  context.subscriptions.push(
    vscode.commands.registerCommand("saropaWorkspace.peekFocusedPin", () => {
      const selected = treeView.selection.find(
        (item) => item instanceof PinTreeItem
      );
      if (selected instanceof PinTreeItem) {
        void vscode.commands.executeCommand("saropaWorkspace.peekPin", selected.pin);
      }
    })
  );

  // In-process scheduler for pins with a schedule. Registered as a disposable so
  // every timer is cleared on deactivation (no orphaned timers leak).
  const scheduler = new Scheduler(store);
  context.subscriptions.push(scheduler);

  // Editor-idle detector (WOW #18): tracks time since the last VS Code interaction and
  // feeds the chain engine's run-on-idle triggers. Constructed before the chain engine
  // so it can be handed in; disposable so its listeners and poll timer are cleared.
  const idleMonitor = new IdleMonitor();
  context.subscriptions.push(idleMonitor);

  // Chain engine (recipe chaining + special events + run-on-idle): listens for pin
  // completions, system events (build / publish emitted by a marked pin, gitCommit /
  // gitPush from the repo watcher below), and idle crossings, and auto-runs the pins
  // triggered by each. Disposable so every bus subscription is released on deactivation.
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

  // Live metric badges (#24): dispose the engine on deactivation so its per-pin file
  // watchers are released (a leaked FileSystemWatcher would survive a reload). The
  // tree provider arms/reconciles the watchers; this only owns their teardown.
  context.subscriptions.push(metricBadges);

  // Smart pin suggestions: count file opens on-device and offer to pin a file
  // the user opens often (gated once per file). No-op when disabled by setting.
  context.subscriptions.push(new SuggestionTracker(context, store));

  // Long-pinned-tab suggestions: when a native editor tab has stayed pinned past
  // the threshold and is not already a Saropa pin, offer to promote it. The
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

  // Re-seed auto-pins and refresh when folders change or the auto-pin patterns
  // setting is edited.
  context.subscriptions.push(
    // Folder set or auto-pin/recipe settings changed: the set of files that match
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

  // Run-on-save: when a file is saved, run any runnable file pin that targets it
  // and has opted in (exec.runOnSave). Registered as a disposable so the listener
  // is torn down on deactivation; a leaked listener would double-fire after a
  // reload.
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((doc) =>
      runPinsOnSave(store, doc.uri)
    )
  );

  // Live refresh on a hand-edited pins config: watch every folder's
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
  // without being nagged on every launch.
  void maybeOfferFavoritesImport(context, store);

  // Offer to run the workspace boot sequence once this session, only when it is
  // enabled and non-empty (no prompt otherwise). Runs after the pin set is loaded
  // so the member pins resolve; the confirm is the "no silent execution" gate.
  void maybeRunBootSequenceOnOpen(store);

  // Re-establish the focus-mode context key from its persisted flag, so a window
  // reloaded while focus is active shows "Exit Focus" rather than "Focus" (the
  // written files.exclude survives the reload, so the toggle state must too).
  void initFocusMode(context);
}

// Import a pin from a shared "Copy as Saropa Link" URI. Decodes the payload, shows a
// modal confirm naming what the pin does (a shared shell command must be a visible,
// deliberate choice — importing never runs it), then adds it. Targets the project
// scope when a workspace folder is open, else global. A malformed/expired link
// degrades to a single warning, never a crash.
async function handlePinImportUri(
  uri: vscode.Uri,
  store: PinStore
): Promise<void> {
  if (uri.path !== "/import") {
    return;
  }
  const data = new URLSearchParams(uri.query).get("data");
  const shared = decodeSharedPin(data);
  if (!shared) {
    vscode.window.showWarningMessage(l10n("share.import.invalid"));
    return;
  }
  const name = shared.label ?? shared.path ?? l10n("share.import.fallbackName");
  const importAction = l10n("share.import.action");
  const choice = await vscode.window.showInformationMessage(
    l10n("share.import.confirm", { name }),
    { modal: true, detail: describeSharedPin(shared) },
    importAction
  );
  if (choice !== importAction) {
    return;
  }
  const scope = (vscode.workspace.workspaceFolders?.length ?? 0) > 0
    ? "project"
    : "global";
  const added = await store.importPin(shared, scope);
  vscode.window.showInformationMessage(
    added
      ? l10n("share.import.done", { name })
      : l10n("share.import.noFolder")
  );
}

// Coalesce rapid calls into one trailing call after `delayMs` of quiet. Used by
// the pins-config watcher so the store's write-then-notify burst (and a flurry of
// editor saves) triggers a single refresh, not one per filesystem event.
function makeDebounced(fn: () => void, delayMs: number): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return () => {
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(fn, delayMs);
  };
}

// Run every runnable file pin whose target is the just-saved file and which has
// opted into run-on-save (exec.runOnSave). The same file can be pinned more than
// once, so all matches fire. Runs through the normal Run command so the run reuses
// token resolution, telemetry, and the per-run toast — and a non-runnable file pin
// is filtered out (it would only "open" the file the user is already editing).
function runPinsOnSave(store: PinStore, savedUri: vscode.Uri): void {
  const saved = savedUri.fsPath;
  const pins = [...store.getProjectPins(), ...store.getGlobalPins()];
  for (const pin of pins) {
    // A paused pin does not run on save — run-on-save is an unattended runner, so
    // pausing suspends it like the scheduler and chain triggers.
    if (pin.paused || pin.exec?.runOnSave !== true || pinKind(pin) !== "file") {
      continue;
    }
    const uri = store.resolveUri(pin);
    if (!uri || uri.fsPath !== saved || !isRunnable(pin, uri.fsPath)) {
      continue;
    }
    // Single-instance guard: skip the save-triggered run when one is already in
    // flight (or the cross-process lock is held) rather than stacking a second on
    // every save. Quiet beyond a channel line — repeated saves must not spam toasts;
    // the manual-run path is where the user gets the interactive "already running"
    // choice. Checked here so an unattended save never reaches the manual toast.
    const block = runBlockReason(pin);
    if (block) {
      const name = pin.label ?? (pin.path.split("/").pop() ?? pin.path);
      getOutputChannel().appendLine(
        l10n("save.skipped", { name, reason: blockReasonLabel(block) })
      );
      continue;
    }
    void vscode.commands.executeCommand("saropaWorkspace.runPin", pin);
  }
}

async function maybeOfferFavoritesImport(
  context: vscode.ExtensionContext,
  store: PinStore
): Promise<void> {
  if (context.workspaceState.get<boolean>(IMPORT_PROMPT_KEY, false)) {
    return;
  }
  const detected = await detectFavoritesFiles();
  if (detected.length === 0) {
    return;
  }
  // Record that the offer was made before awaiting the user's answer, so a
  // dismissal (or window reload mid-prompt) does not re-trigger it.
  await context.workspaceState.update(IMPORT_PROMPT_KEY, true);

  const first = detected[0];
  const action = l10n("import.promptAction");
  const choice = await vscode.window.showInformationMessage(
    l10n("import.prompt", { file: first.fileName, count: detected.length }),
    action
  );
  if (choice === action) {
    const result = await importAllDetected(store);
    vscode.window.showInformationMessage(
      l10n("import.done", {
        count: result.added,
        file: detected.map((d) => d.fileName).join(", "),
      })
    );
  }
}

// Publish the set of absolute paths pinned in each scope as when-clause context
// objects, so the "Workspace Pin" submenu can hide the invalid action per file.
// Both the OS path (uri.fsPath, e.g. "d:\\src\\a.ts") and the URI path (uri.path,
// e.g. "/d:/src/a.ts") are registered for every pin because VS Code's resourcePath
// context key uses one form or the other depending on platform; the `in` operator
// only checks key existence, so registering both matches whichever VS Code supplies.
// Non-file recipe pins have no on-disk path and are skipped.
function syncPinnedPathContext(store: PinStore): void {
  const collect = (pins: Pin[]): Record<string, true> => {
    const set: Record<string, true> = {};
    for (const pin of pins) {
      if (pinKind(pin) !== "file") {
        continue;
      }
      const uri = store.resolveUri(pin);
      if (!uri) {
        continue;
      }
      set[uri.fsPath] = true;
      set[uri.path] = true;
    }
    return set;
  };
  void vscode.commands.executeCommand(
    "setContext",
    "saropaWorkspace.projectPinnedPaths",
    collect(store.getProjectPins())
  );
  void vscode.commands.executeCommand(
    "setContext",
    "saropaWorkspace.globalPinnedPaths",
    collect(store.getGlobalPins())
  );
}

export function deactivate(): void {
  // Subscriptions (tree, commands, terminal cleanup, dispatcher) are disposed by
  // VS Code via context.subscriptions; nothing extra to tear down in Phase 1.
}
