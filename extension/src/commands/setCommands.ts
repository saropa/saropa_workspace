import * as vscode from "vscode";
import { ShortcutStore } from "../model/shortcutStore";
import { l10n } from "../i18n/l10n";

// Multiple-favorite-sets roadmap — commands that switch and manage named shortcut sets.
// The hub command (switchShortcutSet) opens a QuickPick listing the sets plus the
// manage actions; the status-bar item and the view-title menu both route here. The
// individual new/rename/delete/duplicate commands are also exposed directly (view
// title + palette). Every action names the set it acted on in its toast, and a
// switch / create repaints the tree (the store fires onDidChange).
//
// All management actions target the ACTIVE set: "rename" renames the current set,
// "delete" deletes it (then switches to a fallback), "duplicate" copies it. This
// matches the mental model of the switcher — you manage the set you are looking at.

// Case-insensitive name match, mirroring the store's own duplicate rule, so the
// input validators can flag a clash before the box is dismissed.
function sameName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function hasWorkspaceFolder(): boolean {
  return (vscode.workspace.workspaceFolders?.length ?? 0) > 0;
}

// Wire the switcher hub command plus the new/rename/delete/duplicate commands so
// each is also reachable directly (view title + command palette), not only through
// the hub's QuickPick.
export function registerSetCommands(
  context: vscode.ExtensionContext,
  store: ShortcutStore
): void {
  const reg = (id: string, handler: () => unknown): void => {
    context.subscriptions.push(vscode.commands.registerCommand(id, handler));
  };

  reg("saropaWorkspace.switchPinSet", () => switchShortcutSet(store));
  reg("saropaWorkspace.newPinSet", () => newShortcutSet(store));
  reg("saropaWorkspace.renamePinSet", () => renameShortcutSet(store));
  reg("saropaWorkspace.deletePinSet", () => deleteShortcutSet(store));
  reg("saropaWorkspace.duplicatePinSet", () => duplicateShortcutSet(store));
}

// QuickPick item carrying which action the row performs and, for a set row, the
// set it switches to.
interface SetPickItem extends vscode.QuickPickItem {
  action: "switch" | "new" | "rename" | "delete" | "duplicate";
  setName?: string;
}

// The switcher hub: pick a set to switch to, or a manage action. Opened by the
// status-bar item and the "Switch Shortcut Set..." view-title command.
async function switchShortcutSet(store: ShortcutStore): Promise<void> {
  if (!hasWorkspaceFolder()) {
    vscode.window.showWarningMessage(l10n("pinSet.noWorkspace"));
    return;
  }
  const active = store.getActiveSetName();
  const names = store.getSetNames();

  const items: SetPickItem[] = [];
  items.push({
    label: l10n("pinSet.switch.setsSeparator"),
    kind: vscode.QuickPickItemKind.Separator,
    action: "switch",
  });
  for (const name of names) {
    const isActive = name === active;
    items.push({
      label: isActive ? `$(check) ${name}` : `$(layers) ${name}`,
      description: isActive ? l10n("pinSet.switch.activeTag") : undefined,
      action: "switch",
      setName: name,
    });
  }
  items.push({
    label: l10n("pinSet.switch.actionsSeparator"),
    kind: vscode.QuickPickItemKind.Separator,
    action: "switch",
  });
  items.push({ label: l10n("pinSet.switch.new"), action: "new" });
  items.push({
    label: l10n("pinSet.switch.rename", { name: active }),
    action: "rename",
  });
  items.push({
    label: l10n("pinSet.switch.duplicate", { name: active }),
    action: "duplicate",
  });
  items.push({
    label: l10n("pinSet.switch.delete", { name: active }),
    action: "delete",
  });

  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: l10n("pinSet.switch.placeholder"),
  });
  if (!picked) {
    return;
  }
  switch (picked.action) {
    case "switch":
      // Switching to the already-active set is a no-op; only act on a real change.
      if (picked.setName && picked.setName !== active) {
        await store.switchSet(picked.setName);
        vscode.window.showInformationMessage(
          l10n("pinSet.switched", { name: picked.setName })
        );
      }
      return;
    case "new":
      await newShortcutSet(store);
      return;
    case "rename":
      await renameShortcutSet(store);
      return;
    case "delete":
      await deleteShortcutSet(store);
      return;
    case "duplicate":
      await duplicateShortcutSet(store);
      return;
  }
}

async function newShortcutSet(store: ShortcutStore): Promise<void> {
  if (!hasWorkspaceFolder()) {
    vscode.window.showWarningMessage(l10n("pinSet.noWorkspace"));
    return;
  }
  const existing = store.getSetNames();
  const name = await vscode.window.showInputBox({
    prompt: l10n("pinSet.new.prompt"),
    placeHolder: l10n("pinSet.new.placeholder"),
    validateInput: (value) => validateName(value, existing),
  });
  if (name === undefined) {
    return;
  }
  const result = await store.createSet(name);
  const trimmed = name.trim();
  if (result === "exists") {
    vscode.window.showWarningMessage(
      l10n("pinSet.nameExists", { name: trimmed })
    );
  } else if (result === "noFolder") {
    vscode.window.showWarningMessage(l10n("pinSet.noWorkspace"));
  } else {
    vscode.window.showInformationMessage(
      l10n("pinSet.created", { name: trimmed })
    );
  }
}

async function renameShortcutSet(store: ShortcutStore): Promise<void> {
  if (!hasWorkspaceFolder()) {
    vscode.window.showWarningMessage(l10n("pinSet.noWorkspace"));
    return;
  }
  const from = store.getActiveSetName();
  // The current name is excluded from the clash check so a pure case change passes.
  const others = store.getSetNames().filter((n) => !sameName(n, from));
  const to = await vscode.window.showInputBox({
    prompt: l10n("pinSet.rename.prompt", { name: from }),
    value: from,
    validateInput: (value) => validateName(value, others),
  });
  if (to === undefined) {
    return;
  }
  const result = await store.renameSet(from, to);
  const trimmed = to.trim();
  if (result === "exists") {
    vscode.window.showWarningMessage(
      l10n("pinSet.nameExists", { name: trimmed })
    );
  } else if (result === "renamed") {
    vscode.window.showInformationMessage(
      l10n("pinSet.renamed", { from, to: trimmed })
    );
  }
}

async function deleteShortcutSet(store: ShortcutStore): Promise<void> {
  if (!hasWorkspaceFolder()) {
    vscode.window.showWarningMessage(l10n("pinSet.noWorkspace"));
    return;
  }
  const name = store.getActiveSetName();
  // Block (with a clear reason) before the confirm when this is the only set.
  if (store.getSetNames().length <= 1) {
    vscode.window.showWarningMessage(l10n("pinSet.delete.lastOne", { name }));
    return;
  }
  // Modal confirm: deleting a set removes its project shortcuts (data loss), unlike
  // deleting a group (which only re-parents). Global shortcuts are untouched.
  const confirm = l10n("pinSet.delete.confirmAction");
  const choice = await vscode.window.showWarningMessage(
    l10n("pinSet.delete.confirm", { name }),
    { modal: true },
    confirm
  );
  if (choice !== confirm) {
    return;
  }
  const { outcome, active } = await store.deleteSet(name);
  if (outcome === "lastOne") {
    vscode.window.showWarningMessage(l10n("pinSet.delete.lastOne", { name }));
  } else if (outcome === "deleted") {
    vscode.window.showInformationMessage(
      l10n("pinSet.deleted", { name, active })
    );
  }
}

async function duplicateShortcutSet(store: ShortcutStore): Promise<void> {
  if (!hasWorkspaceFolder()) {
    vscode.window.showWarningMessage(l10n("pinSet.noWorkspace"));
    return;
  }
  const source = store.getActiveSetName();
  const existing = store.getSetNames();
  const to = await vscode.window.showInputBox({
    prompt: l10n("pinSet.duplicate.prompt", { name: source }),
    value: l10n("pinSet.duplicate.suffix", { name: source }),
    validateInput: (value) => validateName(value, existing),
  });
  if (to === undefined) {
    return;
  }
  const result = await store.duplicateSet(source, to);
  const trimmed = to.trim();
  if (result === "exists") {
    vscode.window.showWarningMessage(
      l10n("pinSet.nameExists", { name: trimmed })
    );
  } else if (result === "noFolder") {
    vscode.window.showWarningMessage(l10n("pinSet.noWorkspace"));
  } else {
    vscode.window.showInformationMessage(
      l10n("pinSet.duplicated", { source, name: trimmed })
    );
  }
}

// Shared input validation: a name must be non-blank and not clash (case-
// insensitively) with one already taken. Returns the localized error or undefined
// when valid (the contract VS Code's validateInput expects).
function validateName(value: string, taken: string[]): string | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return l10n("pinSet.nameEmpty");
  }
  if (taken.some((n) => sameName(n, trimmed))) {
    return l10n("pinSet.nameExists", { name: trimmed });
  }
  return undefined;
}
