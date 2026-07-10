import * as vscode from "vscode";
import * as path from "path";
import {
  FolderWatch,
  FolderWatchStore,
  isGlobalWatch,
  watchAlertsIn,
} from "../model/folderWatch";
import { l10n } from "../i18n/l10n";
import { currentFolderPaths, notifyWatchChange } from "./folderWatchCommands";
import { applyAlertHere, applyMakeGlobal } from "./folderWatchRowCommands";

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
      label: w.label ?? path.basename(w.target),
      description: describeWatch(w),
      detail: w.target,
      // Globe marks a global watch; otherwise eye (enabled) / eye-closed (paused),
      // matching the Watches view glyphs so reach reads the same in both places.
      iconPath: new vscode.ThemeIcon(
        !w.enabled ? "eye-closed" : isGlobalWatch(w) ? "globe" : "eye"
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
  const kind = watch.isFile
    ? l10n("folderWatch.kindFile")
    : l10n("folderWatch.kindFolder");
  const mode =
    watch.mode === "changed"
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
  const remove = l10n("folderWatch.remove");
  const actions = global
    ? [toggle, makeGlobal, remove]
    : [toggle, makeGlobal, alertHere, remove];
  const choice = await vscode.window.showQuickPick(actions, {
    title: watch.label ?? path.basename(watch.target),
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
  await store.remove(watch.id);
  notifyWatchChange(
    l10n("folderWatch.removed", { name: watch.label ?? path.basename(watch.target) })
  );
  return store.list().length === 0 ? "removed-last" : "continue";
}
