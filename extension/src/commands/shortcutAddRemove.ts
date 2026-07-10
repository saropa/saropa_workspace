import * as vscode from "vscode";
import { ShortcutStore } from "../model/shortcutStore";
import { ShortcutScope } from "../model/shortcut";
import { defaultGroupLabel } from "../model/shortcutStoreShared";
import { runStatusRegistry } from "../exec/runStatus";
import { detectRunTargets, RunTarget } from "../exec/runTargets";
import { l10n } from "../i18n/l10n";

// Add/remove commands that turn a file into a shortcut (or back): the line-shortcut
// gesture, the plain add/remove-by-uri commands, and the post-add run-target offer.
// Split out of shortcutSelection.ts; the argument-resolution helpers these commands
// build on live in shortcutArgResolution.ts.

// Add the active editor's file at the current cursor line as a "line shortcut" (WOW #22):
// opening it later jumps straight to this line and flashes it. Project scope when the
// file is inside a workspace folder, else global (a project shortcut must be folder-
// relative). The label carries the line so several line shortcuts to one file are
// distinguishable in the tree.
export async function shortcutToLine(store: ShortcutStore): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage(l10n("pin.noActiveFile"));
    return;
  }
  const uri = editor.document.uri;
  const line = editor.selection.active.line + 1; // store 1-based
  const base = uri.path.split("/").pop() ?? uri.fsPath;
  const label = l10n("linePin.label", { name: base, line });
  // Project scope only when the file lives in a workspace folder (its path must be
  // folder-relative); otherwise global, so an external file still gets a line shortcut.
  const scope: ShortcutScope = vscode.workspace.getWorkspaceFolder(uri)
    ? "project"
    : "global";
  await store.addLineShortcut(uri, scope, line, label);
  vscode.window.showInformationMessage(l10n("linePin.added", { name: base, line }));
}

export async function shortcutUri(store: ShortcutStore, uri: vscode.Uri, scope: ShortcutScope): Promise<void> {
  const name = uri.path.split("/").pop() ?? uri.fsPath;
  const added = await store.addShortcut(uri, scope);
  if (added) {
    // Name the default group the file was auto-sorted into (e.g. "Added publish.sh to
    // Deploy"), so the user sees where it landed rather than guessing. The shortcut is
    // in the store cache after addShortcut's refresh; a file that matched no rule (or a
    // global add, where default groups do not apply) has no default group and shows the
    // plain confirmation.
    const group = defaultGroupLabel(store.findShortcutByUri(uri, scope)?.groupId);
    vscode.window.showInformationMessage(
      group ? l10n("pin.addedToGroup", { name, group }) : l10n("pin.added", { name })
    );
    // Offer inferred run targets (npm scripts, Make targets, a shebang) so the
    // shortcut runs the right thing without the user typing a command (7.5).
    await offerRunTarget(store, uri, scope, name);
  } else {
    vscode.window.showInformationMessage(l10n("pin.alreadyPinned", { name }));
  }
}

// After a file is added, detect run targets within it and, if any exist, let the
// user pick one to write as the shortcut's run config. Esc/dismiss leaves the shortcut
// with no run config (today's interpreter-default behavior) — the offer never blocks.
async function offerRunTarget(
  store: ShortcutStore,
  uri: vscode.Uri,
  scope: ShortcutScope,
  name: string
): Promise<void> {
  const targets = await detectRunTargets(uri);
  if (targets.length === 0) {
    return;
  }
  type TargetItem = vscode.QuickPickItem & { target: RunTarget };
  const items: TargetItem[] = targets.map((t) => ({
    label: t.label,
    detail: t.detail,
    target: t,
  }));
  const pick = await vscode.window.showQuickPick(items, {
    title: l10n("runTarget.title", { name }),
    placeHolder: l10n("runTarget.placeholder"),
  });
  if (!pick) {
    return;
  }
  const shortcut = store.findShortcutByUri(uri, scope);
  if (!shortcut) {
    return;
  }
  await store.updateShortcutExec(shortcut, pick.target.exec);
  vscode.window.showInformationMessage(
    l10n("runTarget.applied", { name, target: pick.label.replace(/^\$\([^)]*\)\s*/, "") })
  );
}

// Remove the shortcut in a given scope that resolves to a file, naming it in the
// toast. A no-op-with-feedback when the file is not actually a shortcut in that scope
// (the "Remove from ... Shortcuts" submenu item is static, so it can be invoked on a
// file that is not a shortcut there).
export async function removeShortcutForUri(
  store: ShortcutStore,
  uri: vscode.Uri,
  scope: ShortcutScope
): Promise<void> {
  const fileName = uri.path.split("/").pop() ?? uri.fsPath;
  const shortcut = store.findShortcutByUri(uri, scope);
  if (!shortcut) {
    const where =
      scope === "global"
        ? l10n("pin.group.global")
        : l10n("pin.group.project");
    vscode.window.showInformationMessage(
      l10n("pin.notPinned", { name: fileName, scope: where })
    );
    return;
  }
  const name = shortcut.label ?? fileName;
  await store.removeShortcut(shortcut);
  // Drop any last-run badge so it does not outlive the shortcut.
  runStatusRegistry.clear(shortcut.id);
  vscode.window.showInformationMessage(l10n("pin.removed", { name }));
}
