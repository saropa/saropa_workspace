import * as vscode from "vscode";
import { ShortcutStore } from "../model/shortcutStore";
import { FolderWatchStore } from "../model/folderWatch";
import { RecipesTreeProvider } from "../views/recipesTreeProvider";
import { ProjectFilesTreeProvider } from "../views/projectFilesProvider";
import { ScriptsTreeProvider, ScriptTreeItem } from "../views/scriptsTreeProvider";
import { LauncherViewProvider } from "../views/launcherView";
import { syncShortcutPathContext } from "./activationHelpers";
import { runLibraryScript, buildScriptShortcut } from "../exec/scriptRunner";
import { checkScriptSync } from "../model/scriptLibrary";
import { l10n } from "../i18n/l10n";
import { SetParamsPanel } from "../views/setParamsPanel";
import { ShortcutDecorationProvider } from "../views/shortcutDecorations";
import { shortcutBadges } from "../exec/shortcutBadges";
import { makeDebounced } from "./activationHelpers";
import { NoteStore } from "../model/noteStore";
import { NotesTreeProvider } from "../views/notesProvider";
import { registerNoteCommands } from "../commands/noteCommands";

// Activation wiring block split out of extension.ts (and, before that, out of
// wiring.ts once that file itself grew past the project's line-count cap) so
// activate() stays a short, readable sequence of named steps.

/** Wires up all secondary sidebar views: Recipes, Project Files, Scripts, Notes, the Launcher panel, and shortcut file decorations. */
export function setupSecondaryViews(
  context: vscode.ExtensionContext,
  store: ShortcutStore,
  watchStore: FolderWatchStore
): void {
  setupRecipesView(context, store);
  const { projectFiles } = setupProjectFilesView(context, store);
  const scripts = setupScriptsView(context);
  const noteStore = setupNotesView(context);
  setupLauncherPanel(context, store, watchStore, noteStore, projectFiles, scripts);
  setupShortcutDecorations(context, store);

  // Repaint project-files rows whenever shortcuts change, so the shortcut
  // indicator and the add/remove toggle reflect the current state immediately.
  context.subscriptions.push(store.onDidChange(() => projectFiles.refresh()));

  // Keep the "Workspace Shortcut" submenu showing only the valid action for the
  // exact file right-clicked.
  context.subscriptions.push(
    store.onDidChange(() => syncShortcutPathContext(store))
  );
}

function setupRecipesView(
  context: vscode.ExtensionContext,
  store: ShortcutStore
): void {
  const recipes = new RecipesTreeProvider(store);
  const recipesView = vscode.window.createTreeView("saropaWorkspace.recipes", {
    treeDataProvider: recipes,
    showCollapseAll: true,
  });
  context.subscriptions.push(recipesView);
  const syncCount = (count: number): void => {
    recipesView.description = count > 0 ? String(count) : undefined;
  };
  context.subscriptions.push(
    recipes.onDidChangeCount((count) => syncCount(count))
  );
  syncCount(recipes.count);
}

function setupProjectFilesView(
  context: vscode.ExtensionContext,
  store: ShortcutStore
): { projectFiles: ProjectFilesTreeProvider } {
  const projectFiles = new ProjectFilesTreeProvider(store);
  const projectFilesView = vscode.window.createTreeView(
    "saropaWorkspace.projectFiles",
    { treeDataProvider: projectFiles }
  );
  context.subscriptions.push(projectFilesView);
  const syncCount = (count: number): void => {
    projectFilesView.description = count > 0 ? String(count) : undefined;
  };
  context.subscriptions.push(
    projectFiles.onDidChangeCount((count) => syncCount(count))
  );
  syncCount(projectFiles.count);

  context.subscriptions.push(
    vscode.commands.registerCommand("saropaWorkspace.refreshProjectFiles", () =>
      projectFiles.refresh()
    )
  );
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(() => projectFiles.refresh()),
    vscode.workspace.onDidChangeWorkspaceFolders(() => projectFiles.refresh()),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("saropaWorkspace.projectFiles")) {
        projectFiles.refresh();
      }
    })
  );

  return { projectFiles };
}

function setupScriptsView(
  context: vscode.ExtensionContext
): ScriptsTreeProvider {
  const scripts = new ScriptsTreeProvider(context.extensionPath);
  const scriptsView = vscode.window.createTreeView("saropaWorkspace.scripts", {
    treeDataProvider: scripts,
    showCollapseAll: true,
  });
  context.subscriptions.push(scriptsView);
  const syncCount = (count: number): void => {
    scriptsView.description = count > 0 ? String(count) : undefined;
  };
  context.subscriptions.push(
    scripts.onDidChangeCount((count) => syncCount(count))
  );
  syncCount(scripts.count);

  context.subscriptions.push(
    vscode.commands.registerCommand("saropaWorkspace.refreshScripts", () => {
      scripts.refresh();
      const drifted = checkScriptSync(
        context.extensionPath,
        scripts.scripts
      );
      if (drifted.length > 0) {
        const names = drifted.map((d) => d.script.label).join(", ");
        void vscode.window.showWarningMessage(
          l10n("scripts.syncDrift", { names, count: String(drifted.length) })
        );
      }
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "saropaWorkspace.runScript",
      (item?: ScriptTreeItem) => {
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

  return scripts;
}

function setupNotesView(context: vscode.ExtensionContext): NoteStore {
  const noteStore = new NoteStore(context);
  const notes = new NotesTreeProvider(noteStore);
  const notesView = vscode.window.createTreeView("saropaWorkspace.notes", {
    treeDataProvider: notes,
  });
  context.subscriptions.push(notesView);
  const syncCount = (count: number): void => {
    notesView.description = count > 0 ? String(count) : undefined;
  };
  context.subscriptions.push(
    notes.onDidChangeCount((count) => syncCount(count))
  );
  syncCount(notes.count);
  const debouncedNotesRefresh = makeDebounced(() => noteStore.fire(), 200);
  context.subscriptions.push(...noteStore.setupWatchers(debouncedNotesRefresh));
  registerNoteCommands(context, noteStore);
  return noteStore;
}

function setupLauncherPanel(
  context: vscode.ExtensionContext,
  store: ShortcutStore,
  watchStore: FolderWatchStore,
  noteStore: NoteStore,
  projectFiles: ProjectFilesTreeProvider,
  scripts: ScriptsTreeProvider
): void {
  const launcher = new LauncherViewProvider(
    store,
    watchStore,
    noteStore,
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
    ),
    vscode.commands.registerCommand("saropaWorkspace.showLauncher", () =>
      vscode.commands.executeCommand("saropaWorkspace.launcher.focus")
    )
  );
}

function setupShortcutDecorations(
  context: vscode.ExtensionContext,
  store: ShortcutStore
): void {
  const decorations = new ShortcutDecorationProvider(store);
  const debouncedRefresh = makeDebounced(() => decorations.refresh(), 200);
  context.subscriptions.push(
    decorations,
    vscode.window.registerFileDecorationProvider(decorations),
    shortcutBadges.onDidChange(debouncedRefresh),
    store.onDidChange(debouncedRefresh)
  );
}
