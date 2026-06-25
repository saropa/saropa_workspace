import * as vscode from "vscode";
import { PinStore } from "./model/pinStore";
import { PinsTreeProvider } from "./views/pinsTreeProvider";
import { ProjectFilesTreeProvider } from "./views/projectFilesProvider";
import { PinFolderItem, RecentRootItem } from "./views/pinTreeItem";
import { SuggestionTracker } from "./views/suggestions";
import { ScheduleStatusBar } from "./views/scheduleStatusBar";
import { DoubleClickDispatcher } from "./exec/doubleClick";
import { registerPinCommands } from "./commands/pinCommands";
import { registerTerminalCleanup } from "./exec/runner";
import { Scheduler } from "./exec/scheduler";
import { processRegistry } from "./exec/processRegistry";
import { telemetry } from "./exec/telemetry";
import { registerRecipeCommands } from "./recipes/recipeCommands";
import { detectFavoritesFiles, importAllDetected } from "./import/favoritesImport";
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

  // Second view in the container: a read-only list of interesting project files
  // (README, CHANGELOG, manifests) with each file's last-modified time and
  // declared version, so the user can see whether the changelog is current and
  // what version the project is up to without opening anything.
  const projectFiles = new ProjectFilesTreeProvider();
  const projectFilesView = vscode.window.createTreeView(
    "saropaWorkspace.projectFiles",
    { treeDataProvider: projectFiles }
  );
  context.subscriptions.push(projectFilesView);
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
  registerPinCommands(context, store, dispatcher);
  // Helper commands invoked by "command" recipes (set up .env, open config files,
  // copy version, run nearest script).
  registerRecipeCommands(context);

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

  // In-process scheduler for pins with a schedule. Registered as a disposable so
  // every timer is cleared on deactivation (no orphaned timers leak).
  const scheduler = new Scheduler(store);
  context.subscriptions.push(scheduler);

  // Background process registry: kill any still-running background runs on
  // deactivation so they do not outlive the extension.
  context.subscriptions.push(processRegistry);

  // Smart pin suggestions: count file opens on-device and offer to pin a file
  // the user opens often (gated once per file). No-op when disabled by setting.
  context.subscriptions.push(new SuggestionTracker(context, store));

  // Re-seed auto-pins and refresh when folders change or the auto-pin patterns
  // setting is edited.
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => void store.refresh()),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (
        e.affectsConfiguration("saropaWorkspace.autoPins.patterns") ||
        e.affectsConfiguration("saropaWorkspace.recipes.enabled") ||
        // Toggling telemetry shows/hides the Recent group; a refresh repaints.
        e.affectsConfiguration("saropaWorkspace.telemetry.enabled")
      ) {
        void store.refresh();
      }
    })
  );

  await store.init();

  // Arm timers now that the initial pin set is loaded. The scheduler also re-arms
  // itself on every subsequent store change via its onDidChange subscription.
  scheduler.start();

  // Offer to import favorites from other extensions once per workspace, only
  // when such a file actually exists, so first-time users keep their old pins
  // without being nagged on every launch.
  void maybeOfferFavoritesImport(context, store);
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
    const total = await importAllDetected(store);
    vscode.window.showInformationMessage(
      l10n("import.done", {
        count: total,
        file: detected.map((d) => d.fileName).join(", "),
      })
    );
  }
}

export function deactivate(): void {
  // Subscriptions (tree, commands, terminal cleanup, dispatcher) are disposed by
  // VS Code via context.subscriptions; nothing extra to tear down in Phase 1.
}
