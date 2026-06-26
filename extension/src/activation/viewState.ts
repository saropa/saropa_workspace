import * as vscode from "vscode";
import { PinStore } from "../model/pinStore";
import { isAnnotationPin } from "../model/pin";
import { PinsTreeProvider } from "../views/pinsTreeProvider";
import {
  PinFilterState,
  countHidden,
  filterMessage,
  isFilesChipOn,
  isScriptsChipOn,
} from "../views/pinFilter";
import { PinFolderItem, RecentRootItem } from "../views/pinTreeItem";
import { runStatusRegistry } from "../exec/runStatus";
import { tappedPins } from "../model/tappedPins";
import { telemetry } from "../exec/telemetry";
import { BranchTracker } from "../exec/gitBranch";
import { l10n } from "../i18n/l10n";

// Persists the "show pins from all branches" escape hatch (WOW #3) per-workspace, so
// a window reload keeps the chosen branch scope (filtering by current branch vs.
// showing every branch-linked pin). Read by activate to seed the tree, and written
// by the branch-scope toggle commands wired here.
export const SHOW_ALL_BRANCHES_KEY = "saropaWorkspace.showAllBranches";

// Gate flag (global, not per-workspace) so the one-time "single-click opens,
// double-click runs" tip shows at most once ever — the first time the user has a
// real pin. It teaches the core gesture to users who add a pin from the editor /
// Explorer menu and so never see the empty-view welcome that states it (UI plan,
// Phase 3). Once shown, the gesture still lives in every pin's hover.
const GESTURE_TIP_SHOWN_KEY = "saropaWorkspace.gestureTipShown";

// Wire all the live tree-view state that reacts to filter, store, branch, and
// expansion changes: the filter message + chip context keys, the activity-bar
// untapped badge, the one-time gesture tip, the branch-scope affordances and their
// two toggle commands, and group/recent collapse persistence. Extracted from
// activate() so activation reads as a sequence of wiring calls rather than a wall of
// closures. Returns refreshUntappedBadge so activate can repaint the badge once more
// after the pin set finishes loading.
export function wireTreeViewState(
  context: vscode.ExtensionContext,
  store: PinStore,
  tree: PinsTreeProvider,
  treeView: vscode.TreeView<vscode.TreeItem>,
  filterState: PinFilterState,
  branchTracker: BranchTracker
): { refreshUntappedBadge: () => void } {
  // Keep the filter affordances in sync: the chip context keys (which drive the
  // title-bar button visibility/icon) and the always-visible "filter active — N
  // hidden — clear" message. Re-run on any filter change AND on any store change,
  // since adding/removing a pin changes the hidden count while a filter is on.
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
        ...store.getProjectPins().filter((p) => !p.isRecipe),
        ...store.getGlobalPins(),
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

  // Activity-bar badge: the number of Pins-view pins the user has not yet opened
  // or run ("untapped"), as a discovery cue for pins added but never used. Recipe
  // pins live in their own Recipes view and are excluded so detected shortcuts
  // never inflate the count. Zero shows no badge (VS Code hides an undefined
  // badge) — the "don't show a zero" requirement. Recomputed on every store change
  // (a new pin bumps it) and on every tap (using a pin clears it).
  const refreshUntappedBadge = (): void => {
    const pins = [
      ...store.getProjectPins().filter((p) => !p.isRecipe),
      ...store.getGlobalPins(),
    ];
    const untapped = pins.filter((p) => !tappedPins.has(p.id)).length;
    treeView.badge =
      untapped > 0
        ? { value: untapped, tooltip: l10n("badge.untapped", { count: untapped }) }
        : undefined;
  };
  context.subscriptions.push(
    store.onDidChange(() => refreshUntappedBadge()),
    tappedPins.onDidChange(() => refreshUntappedBadge())
  );

  // One-time gesture tip (UI plan, Phase 3): the first time the user has a real,
  // actionable pin, name the single/double-click model once. The empty-view welcome
  // already states it, but a user who pins from the editor/Explorer menu lands
  // straight on a populated tree and never sees that copy. Gated on a global flag so
  // it shows at most once ever; annotation pins (comment/separator) are inert and do
  // not count, so the tip waits for a pin a gesture actually applies to.
  const maybeShowGestureTip = (): void => {
    if (context.globalState.get<boolean>(GESTURE_TIP_SHOWN_KEY, false)) {
      return;
    }
    const actionable = [
      ...store.getProjectPins().filter((p) => !p.isRecipe),
      ...store.getGlobalPins(),
    ].some((p) => !isAnnotationPin(p));
    if (!actionable) {
      return;
    }
    void context.globalState.update(GESTURE_TIP_SHOWN_KEY, true);
    void vscode.window.showInformationMessage(l10n("pin.gestureToast"));
  };
  context.subscriptions.push(store.onDidChange(() => maybeShowGestureTip()));
  maybeShowGestureTip();

  // Branch-linked pins (WOW #3): keep the title-bar affordances in sync. The
  // "branchShowAll" key flips between the two toggle buttons (show-all vs filter-by-
  // branch); "branchHasHidden" reveals the "Show pins from all branches" button only
  // when branch filtering is actually hiding something, so it never appears as a dead
  // control. Re-run on a store change (pins added/linked) and on a checkout.
  const syncBranchView = (): void => {
    void vscode.commands.executeCommand(
      "setContext",
      "saropaWorkspace.branchShowAll",
      tree.isShowingAllBranches()
    );
    void vscode.commands.executeCommand(
      "setContext",
      "saropaWorkspace.branchHasHidden",
      tree.hasBranchHiddenPins()
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
      if (e.element instanceof PinFolderItem) {
        void store.setGroupCollapsed(e.element.pinGroup, e.element.scope, true);
      } else if (e.element instanceof RecentRootItem) {
        void telemetry.setRecentExpanded(false);
      }
    }),
    treeView.onDidExpandElement((e) => {
      if (e.element instanceof PinFolderItem) {
        void store.setGroupCollapsed(e.element.pinGroup, e.element.scope, false);
      } else if (e.element instanceof RecentRootItem) {
        void telemetry.setRecentExpanded(true);
      }
    })
  );

  return { refreshUntappedBadge };
}
