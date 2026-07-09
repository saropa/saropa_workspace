import * as vscode from "vscode";
import { ShortcutStore } from "../model/shortcutStore";
import { isAnnotationShortcut } from "../model/shortcut";
import { ShortcutsTreeProvider } from "../views/shortcutsTreeProvider";
import {
  ShortcutFilterState,
  countHidden,
  filterMessage,
  isFilesChipOn,
  isScriptsChipOn,
} from "../views/shortcutFilter";
import { ShortcutFolderItem, RecentRootItem } from "../views/shortcutTreeItem";
import { runStatusRegistry } from "../exec/runStatus";
import { telemetry } from "../exec/telemetry";
import { BranchTracker } from "../exec/gitBranch";
import { l10n } from "../i18n/l10n";

// Persists the "show shortcuts from all branches" escape hatch (WOW #3) per-workspace,
// so a window reload keeps the chosen branch scope (filtering by current branch vs.
// showing every branch-linked shortcut). Read by activate to seed the tree, and
// written by the branch-scope toggle commands wired here.
export const SHOW_ALL_BRANCHES_KEY = "saropaWorkspace.showAllBranches";

// Gate flag (global, not per-workspace) so the one-time "single-click opens,
// double-click runs" tip shows at most once ever — the first time the user has a
// real shortcut. It teaches the core gesture to users who add a shortcut from the
// editor / Explorer menu and so never see the empty-view welcome that states it (UI
// plan, Phase 3). Once shown, the gesture still lives in every shortcut's hover.
const GESTURE_TIP_SHOWN_KEY = "saropaWorkspace.gestureTipShown";

// Wire all the live tree-view state that reacts to filter, store, branch, and
// expansion changes: the filter message + chip context keys, the one-time gesture
// tip, the branch-scope affordances and their two toggle commands, and group/recent
// collapse persistence. Extracted from
// activate() so activation reads as a sequence of wiring calls rather than a wall of
// closures.
export function wireTreeViewState(
  context: vscode.ExtensionContext,
  store: ShortcutStore,
  tree: ShortcutsTreeProvider,
  treeView: vscode.TreeView<vscode.TreeItem>,
  filterState: ShortcutFilterState,
  branchTracker: BranchTracker
): void {
  // Keep the filter affordances in sync: the chip context keys (which drive the
  // title-bar button visibility/icon) and the always-visible "filter active — N
  // hidden — clear" message. Re-run on any filter change AND on any store change,
  // since adding/removing a shortcut changes the hidden count while a filter is on.
  // This is the never-silently-empty guarantee: while filtering, the message is
  // always present, so a tree that collapsed to nothing never reads as data loss.
  const syncFilterView = (): void => {
    const filter = filterState.get();
    const active = filterState.isActive();
    void vscode.commands.executeCommand(
      "setContext",
      "saropaWorkspace.filterActive",
      active
    );
    void vscode.commands.executeCommand(
      "setContext",
      "saropaWorkspace.filterScripts",
      isScriptsChipOn(filter)
    );
    void vscode.commands.executeCommand(
      "setContext",
      "saropaWorkspace.filterFiles",
      isFilesChipOn(filter)
    );
    void vscode.commands.executeCommand(
      "setContext",
      "saropaWorkspace.filterFailed",
      filter.failedOnly === true
    );
    if (active) {
      const all = [
        ...store.getProjectShortcuts().filter((p) => !p.isRecipe),
        ...store.getGlobalShortcuts(),
      ];
      const hidden = countHidden(
        all,
        filter,
        (id) => runStatusRegistry.get(id)?.outcome === "failure"
      );
      treeView.message = filterMessage(filter, hidden);
    } else {
      treeView.message = undefined;
    }
  };
  context.subscriptions.push(
    filterState.onDidChange(() => syncFilterView()),
    store.onDidChange(() => syncFilterView())
  );
  // Paint the initial state now (a persisted filter must show its message on
  // open, before any change event fires).
  syncFilterView();

  // No activity-bar count badge. An "untapped" counter was tried repeatedly and removed:
  // clicking the activity-bar icon opens the view but does not "tap" any shortcut, so the
  // number never cleared on the gesture users expected ("I clicked it, it should go") and
  // the bare count did not say what it referred to. Each patch to the counting logic left
  // the same mismatch, so the counter is gone entirely rather than re-fixed. The per-row
  // "untapped" dot still marks shortcuts never opened or run; it needs no aggregate count.

  // One-time gesture tip (UI plan, Phase 3): the first time the user has a real,
  // actionable shortcut, name the single/double-click model once. The empty-view
  // welcome already states it, but a user who adds a shortcut from the editor/Explorer
  // menu lands straight on a populated tree and never sees that copy. Gated on a global
  // flag so it shows at most once ever; annotation shortcuts (comment/separator) are
  // inert and do not count, so the tip waits for a shortcut a gesture actually applies
  // to.
  const maybeShowGestureTip = (): void => {
    if (context.globalState.get<boolean>(GESTURE_TIP_SHOWN_KEY, false)) {
      return;
    }
    const actionable = [
      ...store.getProjectShortcuts().filter((p) => !p.isRecipe),
      ...store.getGlobalShortcuts(),
    ].some((p) => !isAnnotationShortcut(p));
    if (!actionable) {
      return;
    }
    void context.globalState.update(GESTURE_TIP_SHOWN_KEY, true);
    void vscode.window.showInformationMessage(l10n("pin.gestureToast"));
  };
  context.subscriptions.push(store.onDidChange(() => maybeShowGestureTip()));
  maybeShowGestureTip();

  // Branch-linked shortcuts (WOW #3): keep the title-bar affordances in sync. The
  // "branchShowAll" key flips between the two toggle buttons (show-all vs filter-by-
  // branch); "branchHasHidden" reveals the "Show shortcuts from all branches" button
  // only when branch filtering is actually hiding something, so it never appears as a
  // dead control. Re-run on a store change (shortcuts added/linked) and on a checkout.
  const syncBranchView = (): void => {
    void vscode.commands.executeCommand(
      "setContext",
      "saropaWorkspace.branchShowAll",
      tree.isShowingAllBranches()
    );
    void vscode.commands.executeCommand(
      "setContext",
      "saropaWorkspace.branchHasHidden",
      tree.hasBranchHiddenShortcuts()
    );
  };
  context.subscriptions.push(
    store.onDidChange(() => syncBranchView()),
    branchTracker.onDidChangeBranch(() => syncBranchView())
  );
  syncBranchView();

  // The two branch-scope toggle commands (title-bar): one suspends branch filtering
  // (the deleted-branch escape hatch), the other resumes it. Both persist the choice
  // per-workspace and re-sync the affordances. Separate commands so each shows its
  // own label/icon gated by the branchShowAll context key.
  const setBranchScope = (showAll: boolean): void => {
    tree.setShowAllBranches(showAll);
    void context.workspaceState.update(SHOW_ALL_BRANCHES_KEY, showAll);
    syncBranchView();
  };
  context.subscriptions.push(
    vscode.commands.registerCommand("saropaWorkspace.showAllBranches", () =>
      setBranchScope(true)
    ),
    vscode.commands.registerCommand("saropaWorkspace.filterByBranch", () =>
      setBranchScope(false)
    )
  );

  // Persist a group's open/closed posture so a folder stays the way the user
  // left it across sessions.
  context.subscriptions.push(
    treeView.onDidCollapseElement((e) => {
      if (e.element instanceof ShortcutFolderItem) {
        void store.setGroupCollapsed(e.element.shortcutGroup, e.element.scope, true);
      } else if (e.element instanceof RecentRootItem) {
        void telemetry.setRecentExpanded(false);
      }
    }),
    treeView.onDidExpandElement((e) => {
      if (e.element instanceof ShortcutFolderItem) {
        void store.setGroupCollapsed(e.element.shortcutGroup, e.element.scope, false);
      } else if (e.element instanceof RecentRootItem) {
        void telemetry.setRecentExpanded(true);
      }
    })
  );
}
