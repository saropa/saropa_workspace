import * as vscode from "vscode";
import { PinStore } from "../model/pinStore";
import { PinFolderItem } from "../views/pinTreeItem";
import { l10n } from "../i18n/l10n";
import {
  scopeFromAddGroupArg,
  editorTargetUri,
  targetUri,
  pinUri,
  pinToLine,
  removePinForUri,
  addAnnotation,
} from "./pinSelection";
import { pinCommandRegistrar } from "./registerHelpers";
import { registerFavoritesImportCommands } from "./favoritesImportCommands";

// The second half of the pin command registrations: pin groups, the add/remove and
// pin-active-file gestures, and recipe/auto-pin restore. Split out of pinCommands.ts
// so that file (which registers the run / open / config / file-op commands) stays
// under the size cap; registerPinCommands calls this at the end. The favorites-import
// commands are split further into favoritesImportCommands.
export function registerPinManagementCommands(
  context: vscode.ExtensionContext,
  store: PinStore
): void {
  const { reg, regPin } = pinCommandRegistrar(context);

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

  // Explorer context: VS Code passes (clickedUri, selectedUris[]). Narrow the
  // boundary argument to a Uri rather than assuming it (the no-any rule).
  reg("saropaWorkspace.pinFile", (arg: unknown) => {
    if (arg instanceof vscode.Uri) {
      void pinUri(store, arg, "project");
    }
  });

  reg("saropaWorkspace.pinFileGlobal", (arg: unknown) => {
    if (arg instanceof vscode.Uri) {
      void pinUri(store, arg, "global");
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
  regPin("saropaWorkspace.promoteRecipe", async (pin) => {
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

  registerFavoritesImportCommands(context, store);
}
