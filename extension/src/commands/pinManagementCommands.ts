import * as vscode from "vscode";
import { PinStore } from "../model/pinStore";
import { PinFolderItem } from "../views/pinTreeItem";
import {
  detectFavoritesFiles,
  detectSettingsFavoritesCount,
  detectSabitovvtFavoritesCount,
  importAllDetected,
  detectSiblingFavorites,
  importSiblingFavorites,
  SiblingFavorites,
} from "../import/favoritesImport";
import { l10n } from "../i18n/l10n";
import {
  asPin,
  scopeFromAddGroupArg,
  editorTargetUri,
  targetUri,
  pinUri,
  pinToLine,
  removePinForUri,
  addAnnotation,
} from "./pinSelection";

// The second half of the pin command registrations: pin groups, the add/remove and
// pin-active-file gestures, recipe/auto-pin restore, and favorites import. Split out
// of pinCommands.ts so that file (which registers the run / open / config / file-op
// commands) stays under the size cap; registerPinCommands calls this at the end.
export function registerPinManagementCommands(
  context: vscode.ExtensionContext,
  store: PinStore
): void {
  const reg = (id: string, handler: (...args: any[]) => any) =>
    context.subscriptions.push(vscode.commands.registerCommand(id, handler));

  // Create a group in the project or global scope (see scopeFromAddGroupArg for
  // how the scope is resolved). Pins are dragged into it afterward.
  reg("saropaWorkspace.addGroup", async (arg: unknown) => {
    const scope = scopeFromAddGroupArg(arg);
    const label = await vscode.window.showInputBox({
      prompt: l10n("group.addPrompt"),
      placeHolder: l10n("group.addPlaceholder"),
      validateInput: (value) =>
        value.trim().length === 0 ? l10n("group.nameEmpty") : undefined,
    });
    if (label === undefined) {
      return;
    }
    const id = await store.createGroup(scope, label);
    if (id) {
      vscode.window.showInformationMessage(
        l10n("group.added", { name: label.trim() })
      );
    } else {
      // The only failure path for a non-empty label is a project group with no
      // workspace folder open; name that so the user knows why nothing changed.
      vscode.window.showWarningMessage(l10n("group.noWorkspace"));
    }
  });

  // Add a comment label or a visual separator to divide a long pin list. Invoked
  // from the view title (appends to the project scope) or a pin's context menu
  // (inserts right after that pin). Rename uses the shared renamePin command;
  // remove uses unpin — both already operate on any stored pin.
  reg("saropaWorkspace.addComment", (arg: unknown) =>
    void addAnnotation(store, "comment", arg)
  );
  reg("saropaWorkspace.addSeparator", (arg: unknown) =>
    void addAnnotation(store, "separator", arg)
  );

  reg("saropaWorkspace.renameGroup", async (arg: unknown) => {
    if (!(arg instanceof PinFolderItem)) {
      return;
    }
    const label = await vscode.window.showInputBox({
      prompt: l10n("group.renamePrompt", { name: arg.pinGroup.label }),
      value: arg.pinGroup.label,
      validateInput: (value) =>
        value.trim().length === 0 ? l10n("group.nameEmpty") : undefined,
    });
    if (label !== undefined) {
      await store.renameGroup(arg.pinGroup, arg.scope, label);
    }
  });

  reg("saropaWorkspace.deleteGroup", async (arg: unknown) => {
    if (!(arg instanceof PinFolderItem)) {
      return;
    }
    const name = arg.pinGroup.label;
    // Modal confirm: deletion is destructive to the grouping (not the pins,
    // which move to the top level), so it should be a deliberate choice.
    const confirm = l10n("group.deleteConfirmAction");
    const choice = await vscode.window.showWarningMessage(
      l10n("group.deleteConfirm", { name }),
      { modal: true },
      confirm
    );
    if (choice !== confirm) {
      return;
    }
    const reparented = await store.deleteGroup(arg.pinGroup, arg.scope);
    vscode.window.showInformationMessage(
      l10n("group.deleted", { name, count: reparented })
    );
  });

  reg("saropaWorkspace.pinActiveFile", (arg: unknown) => {
    const uri = editorTargetUri(arg);
    if (!uri) {
      vscode.window.showWarningMessage(l10n("pin.noActiveFile"));
      return;
    }
    void pinUri(store, uri, "project");
  });

  // Pin the active file at the cursor line; opening the pin jumps back to it (#22).
  reg("saropaWorkspace.pinToLine", () => void pinToLine(store));

  reg("saropaWorkspace.pinActiveFileGlobal", (arg: unknown) => {
    const uri = editorTargetUri(arg);
    if (!uri) {
      vscode.window.showWarningMessage(l10n("pin.noActiveFile"));
      return;
    }
    void pinUri(store, uri, "global");
  });

  // Explorer context: VS Code passes (clickedUri, selectedUris[]).
  reg("saropaWorkspace.pinFile", (uri: vscode.Uri) => {
    if (uri) {
      void pinUri(store, uri, "project");
    }
  });

  reg("saropaWorkspace.pinFileGlobal", (uri: vscode.Uri) => {
    if (uri) {
      void pinUri(store, uri, "global");
    }
  });

  // Add/remove a file to/from each scope. One set of four commands backs the
  // Explorer "Workspace Pin" submenu, the Pins view row submenu, and the Project
  // Files inline toggle. The target file is resolved from whatever the surface
  // passes (a Uri, a pin row, or a file row) — see targetUri. The submenu hides
  // the invalid action per file via `resourcePath in/not in` context keys (synced
  // in extension.ts), but each command still validates at click time so a
  // command-palette / keybinding invocation (no resource gating) stays correct.
  reg("saropaWorkspace.addProjectPin", (arg: unknown) => {
    const uri = targetUri(store, arg);
    if (uri) {
      void pinUri(store, uri, "project");
    }
  });

  reg("saropaWorkspace.removeProjectPin", async (arg: unknown) => {
    const uri = targetUri(store, arg);
    if (uri) {
      await removePinForUri(store, uri, "project");
    }
  });

  reg("saropaWorkspace.addGlobalPin", (arg: unknown) => {
    const uri = targetUri(store, arg);
    if (uri) {
      void pinUri(store, uri, "global");
    }
  });

  reg("saropaWorkspace.removeGlobalPin", async (arg: unknown) => {
    const uri = targetUri(store, arg);
    if (uri) {
      await removePinForUri(store, uri, "global");
    }
  });

  // Convert a detected recipe into a stored, fully-editable pin (and suppress the
  // detected one so it does not duplicate).
  reg("saropaWorkspace.promoteRecipe", async (arg: unknown) => {
    const pin = asPin(arg);
    if (!pin) {
      return;
    }
    const name = pin.label ?? (pin.path.split("/").pop() ?? pin.path);
    const promoted = await store.promoteRecipe(pin);
    if (promoted) {
      vscode.window.showInformationMessage(l10n("recipe.promoted", { name }));
    }
  });

  reg("saropaWorkspace.restoreRecipes", async () => {
    const count = await store.restoreRecipes();
    vscode.window.showInformationMessage(
      count > 0
        ? l10n("recipe.restored", { count })
        : l10n("recipe.noneRemoved")
    );
  });

  reg("saropaWorkspace.restoreAutoPins", async () => {
    const count = await store.restoreAutoPins();
    vscode.window.showInformationMessage(
      count > 0
        ? l10n("pin.autoRestored", { count })
        : l10n("pin.autoNoneRemoved")
    );
  });

  reg("saropaWorkspace.importFavorites", async () => {
    const detected = await detectFavoritesFiles();
    const settingsCount = detectSettingsFavoritesCount();
    const sabitovvtCount = detectSabitovvtFavoritesCount();
    if (detected.length === 0 && settingsCount === 0 && sabitovvtCount === 0) {
      vscode.window.showInformationMessage(l10n("import.none"));
      return;
    }
    const result = await importAllDetected(store);
    // Name every source the import drew from (files plus the settings keys) so the
    // toast tells the user exactly where the pins came from.
    const sources = [
      ...detected.map((d) => d.fileName),
      ...(settingsCount > 0 ? ["favorites.resources"] : []),
      ...(sabitovvtCount > 0 ? ["favoritesPanel.commands"] : []),
    ];
    const fileList = sources.join(", ");
    if (result.added === 0) {
      vscode.window.showInformationMessage(l10n("import.nothingNew", { file: fileList }));
      return;
    }
    // Skipped entries (unsupported or malformed) are detailed in the output
    // channel; offer a one-click jump to it rather than burying the count.
    if (result.skipped > 0) {
      const showOutput = l10n("run.showOutput");
      const choice = await vscode.window.showInformationMessage(
        l10n("import.doneWithSkips", {
          count: result.added,
          file: fileList,
          skipped: result.skipped,
        }),
        showOutput
      );
      if (choice === showOutput) {
        void vscode.commands.executeCommand("saropaWorkspace.showOutput");
      }
      return;
    }
    vscode.window.showInformationMessage(
      l10n("import.done", { count: result.added, file: fileList })
    );
  });

  // Scan immediate sibling projects (one directory level up) for favorites files
  // and import the user's selection as GLOBAL pins. Explicit and user-invoked, so
  // cross-project disk reads only happen on demand.
  reg("saropaWorkspace.scanSiblingFavorites", async () => {
    const found = await detectSiblingFavorites();
    if (found.length === 0) {
      vscode.window.showInformationMessage(l10n("import.sibling.none"));
      return;
    }

    // Pre-checked multi-select: the user confirms which siblings to pull in.
    type SiblingItem = vscode.QuickPickItem & { sibling: SiblingFavorites };
    const items: SiblingItem[] = found.map((s) => ({
      label: s.siblingName,
      description: s.fileLabel,
      detail: s.fileUri.fsPath,
      picked: true,
      sibling: s,
    }));
    const picks = await vscode.window.showQuickPick(items, {
      canPickMany: true,
      placeHolder: l10n("import.sibling.placeholder"),
    });
    if (!picks || picks.length === 0) {
      return;
    }

    let total = 0;
    for (const pick of picks) {
      total += await importSiblingFavorites(pick.sibling, store);
    }
    vscode.window.showInformationMessage(
      total > 0
        ? l10n("import.sibling.done", { count: total })
        : l10n("import.sibling.nothingNew")
    );
  });
}
