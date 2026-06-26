import * as vscode from "vscode";
import { Shortcut, isAnnotationShortcut } from "../model/shortcut";
import { ShortcutStore } from "../model/shortcutStore";
import { BranchSetBinder } from "../exec/branchSets";
import { l10n } from "../i18n/l10n";

// Branch-aware shortcut sets (roadmap 3.2) — the user-facing link/unlink commands.
// "Link Current Branch to Shortcut Set" stores a branch -> set binding (with an optional
// on-switch shortcut); "Unlink Current Branch" removes it. The BranchSetBinder performs
// the actual switching on checkout when the feature is enabled — these commands only
// edit the binding map. Both need a current git branch and degrade to a clear
// warning outside a repo.

export function registerBranchSetCommands(
  context: vscode.ExtensionContext,
  store: ShortcutStore,
  binder: BranchSetBinder
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("saropaWorkspace.linkBranchToSet", () =>
      linkBranchToSet(store, binder)
    ),
    vscode.commands.registerCommand("saropaWorkspace.unlinkBranch", () =>
      unlinkBranch(binder)
    )
  );
}

// A shortcut's display name for the on-switch picker: its label, else the file basename,
// else the raw path (shell/url shortcuts carry a label and an empty path).
function shortcutDisplayName(shortcut: Shortcut): string {
  return shortcut.label ?? shortcut.path.split("/").pop() ?? shortcut.path;
}

// The set-row description: tag the currently active set and the set this branch is
// already bound to, so the picker shows the current state at a glance.
function setRowDescription(
  name: string,
  active: string,
  bound: string | undefined
): string | undefined {
  const tags: string[] = [];
  if (name === active) {
    tags.push(l10n("pinSet.switch.activeTag"));
  }
  if (bound !== undefined && name === bound) {
    tags.push(l10n("branchSet.link.currentTag"));
  }
  return tags.length > 0 ? tags.join(" · ") : undefined;
}

async function linkBranchToSet(
  store: ShortcutStore,
  binder: BranchSetBinder
): Promise<void> {
  if ((vscode.workspace.workspaceFolders?.length ?? 0) === 0) {
    vscode.window.showWarningMessage(l10n("pinSet.noWorkspace"));
    return;
  }
  const branch = binder.currentBranch();
  if (branch === undefined) {
    vscode.window.showWarningMessage(l10n("branchSet.noBranch"));
    return;
  }

  // Step 1: pick the set this branch should activate.
  const active = store.getActiveSetName();
  const existing = binder.getBinding(branch);
  const setItems: vscode.QuickPickItem[] = store.getSetNames().map((name) => ({
    label: name,
    description: setRowDescription(name, active, existing?.set),
  }));
  const pickedSet = await vscode.window.showQuickPick(setItems, {
    placeHolder: l10n("branchSet.link.setPlaceholder", { branch }),
  });
  if (!pickedSet) {
    return;
  }
  const set = pickedSet.label;

  // Step 2: optionally pick a shortcut to run on the switch. Candidates are the target
  // set's stored project shortcuts (read without switching) plus the shared global shortcuts;
  // annotation shortcuts (comment/separator) are excluded since they never run. A "None"
  // row keeps the on-switch shortcut optional, and Escape cancels the whole flow.
  interface ShortcutPick extends vscode.QuickPickItem {
    pinId?: string;
  }
  const candidates = [
    ...(await store.getSetShortcuts(set)),
    ...store.getGlobalShortcuts(),
  ].filter((p) => !isAnnotationShortcut(p));
  const shortcutItems: ShortcutPick[] = [
    { label: l10n("branchSet.link.noPin") },
    ...candidates.map((p) => ({
      label: shortcutDisplayName(p),
      description: p.path.length > 0 ? p.path : undefined,
      pinId: p.id,
    })),
  ];
  const pickedShortcut = await vscode.window.showQuickPick(shortcutItems, {
    placeHolder: l10n("branchSet.link.pinPlaceholder", { set }),
  });
  if (!pickedShortcut) {
    return;
  }
  const runPinId = pickedShortcut.pinId;

  await binder.setBinding(branch, {
    set,
    ...(runPinId ? { runPinId } : {}),
  });

  // Confirm, and when the feature is off offer to turn it on (otherwise the binding
  // is stored but never applied) — a one-tap next step rather than a silent no-op.
  if (binder.isEnabled()) {
    vscode.window.showInformationMessage(l10n("branchSet.linked", { set, branch }));
    return;
  }
  const enable = l10n("branchSet.enableAction");
  const choice = await vscode.window.showInformationMessage(
    l10n("branchSet.linkedDisabled", { set, branch }),
    enable
  );
  if (choice === enable) {
    await vscode.workspace
      .getConfiguration("saropaWorkspace")
      .update("branchAware.enabled", true, vscode.ConfigurationTarget.Workspace);
  }
}

async function unlinkBranch(binder: BranchSetBinder): Promise<void> {
  const branch = binder.currentBranch();
  if (branch === undefined) {
    vscode.window.showWarningMessage(l10n("branchSet.noBranch"));
    return;
  }
  const existing = binder.getBinding(branch);
  if (!existing) {
    vscode.window.showInformationMessage(l10n("branchSet.unlink.none", { branch }));
    return;
  }
  await binder.clearBinding(branch);
  vscode.window.showInformationMessage(
    l10n("branchSet.unlinked", { set: existing.set, branch })
  );
}
