import * as vscode from "vscode";
import { ShortcutStore } from "../model/shortcutStore";
import { ShortcutFolderItem } from "../views/shortcutTreeItem";
import { l10n } from "../i18n/l10n";
import {
  scopeFromAddGroupArg,
  editorTargetUri,
  targetUri,
  shortcutUri,
  shortcutToLine,
  removeShortcutForUri,
  addAnnotation,
} from "./shortcutSelection";
import { shortcutCommandRegistrar } from "./registerHelpers";
import { registerFavoritesImportCommands } from "./favoritesImportCommands";
import { configureGroupAppearance } from "./configureAppearance";

// The second half of the shortcut command registrations: shortcut groups, the add/remove
// and add-active-file gestures, and recipe/auto-shortcut restore. Split out of
// pinCommands.ts so that file (which registers the run / open / config / file-op commands)
// stays under the size cap; registerShortcutCommands calls this at the end. The favorites-import
// commands are split further into favoritesImportCommands.
export function registerPinManagementCommands(
  context: vscode.ExtensionContext,
  store: ShortcutStore
): void {
  // Thin orchestrator: the registrations are grouped by concern into the helpers below so
  // no single function breaches the length cap. Order is irrelevant — each command is
  // independent — but kept groups → file shortcuts → recipes → favorites for readability.
  registerGroupCreateCommands(context, store);
  registerGroupEditCommands(context, store);
  registerPinFileCommands(context, store);
  registerRecipeRestoreCommands(context, store);
  registerFavoritesImportCommands(context, store);
}

// Group creation and the comment/separator annotations that divide a long list.
function registerGroupCreateCommands(
  context: vscode.ExtensionContext,
  store: ShortcutStore
): void {
  const { reg } = shortcutCommandRegistrar(context);

  // Create a group in the project or global scope (see scopeFromAddGroupArg for
  // how the scope is resolved). Shortcuts are dragged into it afterward.
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

  // Add a comment label or a visual separator to divide a long shortcut list. Invoked
  // from the view title (appends to the project scope) or a shortcut's context menu
  // (inserts right after that shortcut). Rename uses the shared renamePin command;
  // remove uses unpin — both already operate on any stored shortcut.
  reg("saropaWorkspace.addComment", (arg: unknown) =>
    void addAnnotation(store, "comment", arg)
  );
  reg("saropaWorkspace.addSeparator", (arg: unknown) =>
    void addAnnotation(store, "separator", arg)
  );
}

// Editing an existing user group: rename, icon/color appearance, and delete.
function registerGroupEditCommands(
  context: vscode.ExtensionContext,
  store: ShortcutStore
): void {
  const { reg } = shortcutCommandRegistrar(context);

  reg("saropaWorkspace.renameGroup", async (arg: unknown) => {
    if (!(arg instanceof ShortcutFolderItem)) {
      return;
    }
    const label = await vscode.window.showInputBox({
      prompt: l10n("group.renamePrompt", { name: arg.shortcutGroup.label }),
      value: arg.shortcutGroup.label,
      validateInput: (value) =>
        value.trim().length === 0 ? l10n("group.nameEmpty") : undefined,
    });
    if (label !== undefined) {
      await store.renameGroup(arg.shortcutGroup, arg.scope, label);
    }
  });

  // Edit a user group's tree icon + color. Same two-step picker as the per-shortcut
  // appearance command; gated to user groups in the manifest (the synthetic recipe
  // groups are not stored anywhere editable).
  reg("saropaWorkspace.configureGroupAppearance", async (arg: unknown) => {
    if (!(arg instanceof ShortcutFolderItem)) {
      return;
    }
    await configureGroupAppearance(store, arg.shortcutGroup, arg.scope);
  });

  reg("saropaWorkspace.deleteGroup", async (arg: unknown) => {
    if (!(arg instanceof ShortcutFolderItem)) {
      return;
    }
    const name = arg.shortcutGroup.label;
    // Modal confirm: deletion is destructive to the grouping (not the shortcuts,
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
    const reparented = await store.deleteGroup(arg.shortcutGroup, arg.scope);
    vscode.window.showInformationMessage(
      l10n("group.deleted", { name, count: reparented })
    );
  });
}

// Add-file gestures across both scopes: the active editor file, a cursor-line shortcut, the
// Explorer "pin file" entries, and the add/remove toggles backing the submenus.
function registerPinFileCommands(
  context: vscode.ExtensionContext,
  store: ShortcutStore
): void {
  const { reg } = shortcutCommandRegistrar(context);

  reg("saropaWorkspace.pinActiveFile", (arg: unknown) => {
    const uri = editorTargetUri(arg);
    if (!uri) {
      vscode.window.showWarningMessage(l10n("pin.noActiveFile"));
      return;
    }
    void shortcutUri(store, uri, "project");
  });

  // Add the active file at the cursor line as a shortcut; opening it jumps back to it (#22).
  reg("saropaWorkspace.pinToLine", () => void shortcutToLine(store));

  reg("saropaWorkspace.pinActiveFileGlobal", (arg: unknown) => {
    const uri = editorTargetUri(arg);
    if (!uri) {
      vscode.window.showWarningMessage(l10n("pin.noActiveFile"));
      return;
    }
    void shortcutUri(store, uri, "global");
  });

  // Explorer context: VS Code passes (clickedUri, selectedUris[]). Narrow the
  // boundary argument to a Uri rather than assuming it (the no-any rule).
  reg("saropaWorkspace.pinFile", (arg: unknown) => {
    if (arg instanceof vscode.Uri) {
      void shortcutUri(store, arg, "project");
    }
  });

  reg("saropaWorkspace.pinFileGlobal", (arg: unknown) => {
    if (arg instanceof vscode.Uri) {
      void shortcutUri(store, arg, "global");
    }
  });

  // Add/remove a file to/from each scope. One set of four commands backs the
  // Explorer "Workspace Pin" submenu, the Shortcuts view row submenu, and the Project
  // Files inline toggle. The target file is resolved from whatever the surface
  // passes (a Uri, a shortcut row, or a file row) — see targetUri. The submenu hides
  // the invalid action per file via `resourcePath in/not in` context keys (synced
  // in extension.ts), but each command still validates at click time so a
  // command-palette / keybinding invocation (no resource gating) stays correct.
  reg("saropaWorkspace.addProjectPin", (arg: unknown) => {
    const uri = targetUri(store, arg);
    if (uri) {
      void shortcutUri(store, uri, "project");
    }
  });

  reg("saropaWorkspace.removeProjectPin", async (arg: unknown) => {
    const uri = targetUri(store, arg);
    if (uri) {
      await removeShortcutForUri(store, uri, "project");
    }
  });

  reg("saropaWorkspace.addGlobalPin", (arg: unknown) => {
    const uri = targetUri(store, arg);
    if (uri) {
      void shortcutUri(store, uri, "global");
    }
  });

  reg("saropaWorkspace.removeGlobalPin", async (arg: unknown) => {
    const uri = targetUri(store, arg);
    if (uri) {
      await removeShortcutForUri(store, uri, "global");
    }
  });
}

// Recipe / auto-shortcut lifecycle: promote a detected recipe to a stored shortcut, one-tap
// adopt a scheduled ritual, and restore previously-removed recipes / auto-shortcuts.
function registerRecipeRestoreCommands(
  context: vscode.ExtensionContext,
  store: ShortcutStore
): void {
  const { reg, regShortcut } = shortcutCommandRegistrar(context);

  // Convert a detected recipe into a stored, fully-editable shortcut (and suppress the
  // detected one so it does not duplicate).
  regShortcut("saropaWorkspace.promoteRecipe", async (shortcut) => {
    const name = shortcut.label ?? (shortcut.path.split("/").pop() ?? shortcut.path);
    const promoted = await store.promoteRecipe(shortcut);
    if (promoted) {
      vscode.window.showInformationMessage(l10n("recipe.promoted", { name }));
    }
  });

  // One-tap adoption for a recommended scheduled ritual: promote AND enable its schedule
  // in one click, then confirm the state change the user explicitly requested with a
  // single toast naming the ritual and its time. This is the one place a recommendation
  // surface shows a toast — it confirms an action, never nudges.
  regShortcut("saropaWorkspace.enableScheduledRecipe", async (shortcut) => {
    const name = shortcut.label ?? (shortcut.path.split("/").pop() ?? shortcut.path);
    const enabled = await store.enableScheduledRecipe(shortcut);
    if (enabled) {
      const time = shortcut.schedule?.atTime;
      vscode.window.showInformationMessage(
        time
          ? l10n("recipe.scheduleEnabledAt", { name, time })
          : l10n("recipe.scheduleEnabled", { name })
      );
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
    const count = await store.restoreAutoShortcuts();
    vscode.window.showInformationMessage(
      count > 0
        ? l10n("pin.autoRestored", { count })
        : l10n("pin.autoNoneRemoved")
    );
  });
}
