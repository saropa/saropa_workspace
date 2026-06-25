import * as vscode from "vscode";
import { PinStore } from "./model/pinStore";
import { Pin, pinKind } from "./model/pin";
import { PinsTreeProvider } from "./views/pinsTreeProvider";
import { RecipesTreeProvider } from "./views/recipesTreeProvider";
import { ProjectFilesTreeProvider } from "./views/projectFilesProvider";
import { PinFolderItem, PinTreeItem, RecentRootItem } from "./views/pinTreeItem";
import { SuggestionTracker } from "./views/suggestions";
import { ScheduleStatusBar } from "./views/scheduleStatusBar";
import { DoubleClickDispatcher } from "./exec/doubleClick";
import { registerPinCommands } from "./commands/pinCommands";
import { registerSimulationPreview } from "./commands/simulateRun";
import { registerRunAnalytics } from "./commands/runAnalytics";
import { registerRunOutputDiff } from "./commands/diffRuns";
import { registerTerminalCleanup } from "./exec/runner";
import { Scheduler } from "./exec/scheduler";
import { Heartbeat } from "./exec/heartbeat";
import { registerProcessMonitorCommands } from "./exec/processMonitorCommands";
import { processRegistry } from "./exec/processRegistry";
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
  const tree = new PinsTreeProvider(store);
  const treeView = vscode.window.createTreeView("saropaWorkspace.pins", {
    treeDataProvider: tree,
    dragAndDropController: tree,
    canSelectMany: true,
    showCollapseAll: true,
  });
  context.subscriptions.push(treeView);

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

  // Developer process monitor (recipe book section G): the command that opens the
  // live Saropa Dashboard webview (#60) and the grouped-snapshot command (#62).
  registerProcessMonitorCommands(context);

  // Status-bar item for the soonest upcoming scheduled run; clicking it reveals
  // the pin in the tree. The reveal command lives here because it needs the tree
  // view handle created above.
  const scheduleStatusBar = new ScheduleStatusBar(store);
  context.subscriptions.push(scheduleStatusBar);
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

  // Toolchain heartbeat (#61): a setting-gated background sampler that appends to
  // reports/process-trend.csv and toasts only when a tool crosses a RAM / helper
  // ceiling. Off by default; it self-arms from its own setting. Disposable so its
  // timer is cleared on deactivation.
  context.subscriptions.push(new Heartbeat());

  // Background process registry: kill any still-running background runs on
  // deactivation so they do not outlive the extension.
  context.subscriptions.push(processRegistry);

  // Smart pin suggestions: count file opens on-device and offer to pin a file
  // the user opens often (gated once per file). No-op when disabled by setting.
  context.subscriptions.push(new SuggestionTracker(context, store));

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
      }
    })
  );

  await store.init();
  // Set the initial pinned-path context keys explicitly in case the init-time
  // onDidChange fired before the subscription above was attached.
  syncPinnedPathContext(store);
  // Paint the initial untapped badge from the loaded pin set, for the same reason.
  refreshUntappedBadge();

  // Arm timers now that the initial pin set is loaded. The scheduler also re-arms
  // itself on every subsequent store change via its onDidChange subscription.
  scheduler.start();

  // Offer to import favorites from other extensions once per workspace, only
  // when such a file actually exists, so first-time users keep their old pins
  // without being nagged on every launch.
  void maybeOfferFavoritesImport(context, store);
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
