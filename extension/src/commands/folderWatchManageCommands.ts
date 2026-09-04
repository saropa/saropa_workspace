import * as vscode from "vscode";
import {
  FolderWatch,
  FolderWatchStore,
  isGlobalWatch,
  watchAlertsIn,
  watchKind,
  watchDisplayName,
} from "../model/folderWatch";
import { l10n } from "../i18n/l10n";
import { currentFolderPaths, notifyWatchChange } from "./folderWatchCommands";
import { applyAlertHere, applyMakeGlobal } from "./folderWatchRowCommands";
import { editGitHubRepoWatch } from "./githubWatchCommands";

// The "Manage Watches" review hub: list every watch with its state, then act on the
// chosen one (toggle enabled, change reach, remove).

interface WatchItem extends vscode.QuickPickItem {
  watch: FolderWatch;
}

// Review hub: list every watch with its state, then act on the chosen one (toggle
// enabled, or remove). Loops so several edits can be made in one sitting; Esc closes.
export async function manageWatches(store: FolderWatchStore): Promise<void> {
  for (;;) {
    const watches = store.list();
    if (watches.length === 0) {
      notifyWatchChange(l10n("folderWatch.none"));
      return;
    }
    const items: WatchItem[] = watches.map((w) => ({
      watch: w,
      label: watchDisplayName(w),
      description: describeWatch(w),
      detail: w.target,
      // Disabled/global state wins over kind, matching the tree row's precedence:
      // eye-closed first (paused), globe second (global), then kind-specific icon
      // (github for repo, eye for folder).
      iconPath: new vscode.ThemeIcon(
        !w.enabled
          ? "eye-closed"
          : isGlobalWatch(w)
          ? "globe"
          : watchKind(w) === "repo"
          ? "github"
          : "eye"
      ),
    }));
    const pick = await vscode.window.showQuickPick(items, {
      title: l10n("folderWatch.manageTitle"),
      placeHolder: l10n("folderWatch.managePlaceholder"),
    });
    if (!pick) {
      return;
    }
    const acted = await actOnWatch(store, pick.watch);
    if (acted === "removed-last") {
      return;
    }
  }
}

// One-line state summary for a manage-hub row: kind, mode, enabled/paused, and the
// global marker when the watch alerts in every project (so reach is legible here too).
function describeWatch(watch: FolderWatch): string {
  const kind =
    watchKind(watch) === "repo"
      ? l10n("github.kindRepo")
      : watch.isFile
      ? l10n("folderWatch.kindFile")
      : l10n("folderWatch.kindFolder");
  const mode =
    watchKind(watch) === "repo"
      ? l10n("github.modeNewItems")
      : watch.mode === "changed"
      ? l10n("folderWatch.modeChanged")
      : l10n("folderWatch.modeNew");
  const state = watch.enabled
    ? l10n("folderWatch.stateOn")
    : l10n("folderWatch.stateOff");
  const base = l10n("folderWatch.rowDescription", { kind, mode, state });
  return isGlobalWatch(watch)
    ? l10n("folderWatch.rowDescriptionGlobal", { base })
    : base;
}

// Action sheet for a single watch. Returns "removed-last" so the hub closes when
// the final watch is deleted (its empty-list branch would otherwise re-toast).
async function actOnWatch(
  store: FolderWatchStore,
  watch: FolderWatch
): Promise<"continue" | "removed-last"> {
  const toggle = watch.enabled
    ? l10n("folderWatch.disable")
    : l10n("folderWatch.enable");
  // Global watches alert everywhere; local watches alert only where owned/opted-in.
  // The sheet offers the opposite of the watch's current reach.
  const global = isGlobalWatch(watch);
  const makeGlobal = global
    ? l10n("folderWatch.makeLocal")
    : l10n("folderWatch.makeGlobal");
  // Whether the project(s) open in this window currently receive this watch's
  // alerts, so the action sheet offers the opposite (opt in vs opt out). A global
  // watch already alerts here, so opt-in/out is irrelevant and omitted for it.
  const alertsHere = watchAlertsIn(watch, currentFolderPaths());
  const alertHere = alertsHere
    ? l10n("folderWatch.muteHere")
    : l10n("folderWatch.alertHere");
  // Only a repo watch's target is editable in place — a folder/file watch's target
  // is a filesystem path, and changing that out from under an armed
  // FileSystemWatcher is a remove-and-re-add in every way that matters, so the
  // existing remove + re-add flow already covers it.
  const isRepo = watchKind(watch) === "repo";
  const editRepo = isRepo ? l10n("github.editRepo") : undefined;
  const remove = l10n("folderWatch.remove");
  const actions = [
    toggle,
    makeGlobal,
    ...(global ? [] : [alertHere]),
    ...(editRepo ? [editRepo] : []),
    remove,
  ];
  const choice = await vscode.window.showQuickPick(actions, {
    title: watchDisplayName(watch),
    placeHolder: l10n("folderWatch.actionPlaceholder"),
  });
  if (!choice) {
    return "continue";
  }
  if (choice === toggle) {
    await store.update(watch.id, { enabled: !watch.enabled });
    return "continue";
  }
  if (choice === makeGlobal) {
    await applyMakeGlobal(store, watch, !global);
    return "continue";
  }
  if (choice === alertHere) {
    await applyAlertHere(store, watch, !alertsHere);
    return "continue";
  }
  if (choice === editRepo) {
    await editGitHubRepoWatch(store, watch);
    return "continue";
  }
  await store.remove(watch.id);
  notifyWatchChange(
    l10n("folderWatch.removed", { name: watchDisplayName(watch) })
  );
  return store.list().length === 0 ? "removed-last" : "continue";
}
