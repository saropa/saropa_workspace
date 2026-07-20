import * as vscode from "vscode";
import { ShortcutStore } from "../model/shortcutStore";
import { FolderWatchStore } from "../model/folderWatch";
import { RecipesTreeProvider } from "../views/recipesTreeProvider";
import { ProjectFilesTreeProvider } from "../views/projectFilesProvider";
import { ScriptsTreeProvider, ScriptTreeItem } from "../views/scriptsTreeProvider";
import { LauncherViewProvider } from "../views/launcherView";
import { syncShortcutPathContext } from "./activationHelpers";
import { runLibraryScript, buildScriptShortcut } from "../exec/scriptRunner";
import { SetParamsPanel } from "../views/setParamsPanel";

// Activation wiring block split out of extension.ts (and, before that, out of
// wiring.ts once that file itself grew past the project's line-count cap) so
// activate() stays a short, readable sequence of named steps.

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

  // Bundled scripts from the extension's library.json manifest — ready-to-run developer
  // tools shipped with the extension. Read-only, grouped by tag, with an inline Run
  // button per script. The Run command synthesizes a Shortcut and routes through the
  // existing run pipeline so interpreter resolution, token expansion, and terminal
  // routing all work unchanged.
  const scripts = new ScriptsTreeProvider(context.extensionPath);
  const scriptsView = vscode.window.createTreeView("saropaWorkspace.scripts", {
    treeDataProvider: scripts,
    showCollapseAll: true,
  });
  context.subscriptions.push(scriptsView);
  const syncScriptsCount = (count: number): void => {
    scriptsView.description = count > 0 ? String(count) : undefined;
  };
  context.subscriptions.push(
    scripts.onDidChangeCount((count) => syncScriptsCount(count))
  );
  syncScriptsCount(scripts.count);

  context.subscriptions.push(
    vscode.commands.registerCommand("saropaWorkspace.refreshScripts", () =>
      scripts.refresh()
    )
  );
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "saropaWorkspace.runScript",
      (item?: ScriptTreeItem) => {
        // Guard: a keybinding or API call with no argument would pass undefined.
        if (!item?.script) {
          return;
        }
        const script = scripts.findScript(item.script.id);
        if (!script) {
          return;
        }
        return runLibraryScript(script, context.extensionPath);
      }
    )
  );
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "saropaWorkspace.setScriptParams",
      (item?: ScriptTreeItem) => {
        if (!item?.script) {
          return;
        }
        const script = scripts.findScript(item.script.id);
        if (!script) {
          return;
        }
        SetParamsPanel.show(buildScriptShortcut(script, context.extensionPath));
      }
    )
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
    scripts,
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
