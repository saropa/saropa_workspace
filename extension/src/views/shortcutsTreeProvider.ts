import * as vscode from "vscode";
import { Shortcut, ShortcutGroup, ShortcutScope } from "../model/shortcut";
import { ShortcutStore } from "../model/shortcutStore";
import { processRegistry } from "../exec/processRegistry";
import { runStatusRegistry } from "../exec/runStatus";
import { shortcutBadges } from "../exec/shortcutBadges";
import { metricBadges } from "../exec/metricBadges";
import { telemetry } from "../exec/telemetry";
import { tappedShortcuts } from "../model/tappedShortcuts";
import { BranchTracker } from "../exec/gitBranch";
import { l10n } from "../i18n/l10n";
import { ShortcutFilterState, shortcutMatchesFilter } from "./shortcutFilter";
import {
  ShortcutFolderItem,
  ShortcutGroupItem,
  ShortcutTreeItem,
  RecentRootItem,
} from "./shortcutTreeItem";
import {
  SHORTCUT_MIME,
  URI_LIST_MIME,
  buildShortcutDragData,
  parseShortcutIds,
  resolveDropTarget,
  handleExternalFileDrop,
} from "./shortcutTreeDragDrop";
import {
  buildShortcutItem,
  buildRecentItem,
  recentEntries,
  syncMetrics,
} from "./shortcutTreeNodes";

// Tree: scope roots (Project / Global) -> user groups + top-level shortcuts ->
// shortcuts. Also the drag-and-drop controller, so a shortcut can be reordered and
// moved between groups by dragging it (handleDrag/handleDrop below).
export class ShortcutsTreeProvider
  implements
    vscode.TreeDataProvider<vscode.TreeItem>,
    vscode.TreeDragAndDropController<vscode.TreeItem>
{
  readonly dropMimeTypes = [SHORTCUT_MIME, URI_LIST_MIME];
  readonly dragMimeTypes = [SHORTCUT_MIME];

  private readonly _onDidChangeTreeData = new vscode.EventEmitter<
    vscode.TreeItem | undefined | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  // When true, branch filtering is suspended and every branch-linked shortcut is shown
  // regardless of the current branch — the escape hatch for a shortcut scoped to a
  // deleted/unreachable branch (WOW #3). Persisted by the caller in workspaceState;
  // the initial value is passed in so a reload keeps the chosen scope.
  private showAllBranches: boolean;

  constructor(
    private readonly store: ShortcutStore,
    private readonly filter: ShortcutFilterState,
    private readonly branches: BranchTracker,
    showAllBranches: boolean
  ) {
    this.showAllBranches = showAllBranches;
    // Repaint whenever the store recomputes its cached shortcuts, when a background
    // process starts/stops (running indicator + Stop action), or when a run
    // finishes (success/failure badge). A store change can also add/remove a
    // metric'd shortcut, so reconcile the metric engine's watchers off the same event.
    store.onDidChange(() => {
      syncMetrics(this.store);
      this._onDidChangeTreeData.fire();
    });
    // A re-measured metric (#24) updates only a shortcut's inline value, so repaint.
    metricBadges.onDidChange(() => this._onDidChangeTreeData.fire());
    processRegistry.onDidChange(() => this._onDidChangeTreeData.fire());
    runStatusRegistry.onDidChange(() => this._onDidChangeTreeData.fire());
    // A new lint/test sweep badge (severity counts / test tally) repaints the row.
    shortcutBadges.onDidChange(() => this._onDidChangeTreeData.fire());
    // A recorded run (or a reset) changes the Recent group's contents.
    telemetry.onDidChange(() => this._onDidChangeTreeData.fire());
    // Tapping a shortcut (open/run/peek) clears its untapped dot; repaint so the dot
    // disappears in step with the activity-bar count badge, which recounts off the same
    // event. Without this the badge would drop but the dot would linger until the next
    // unrelated repaint.
    tappedShortcuts.onDidChange(() => this._onDidChangeTreeData.fire());
    // The text/chip filter (WOW #28) changes which rows and groups are visible.
    this.filter.onDidChange(() => this._onDidChangeTreeData.fire());
    // A branch checkout (WOW #3) changes which branch-linked shortcuts are visible, so
    // repaint the tree to re-filter against the new current branch.
    this.branches.onDidChangeBranch(() => this._onDidChangeTreeData.fire());
  }

  // Suspend or resume branch filtering (the "Show shortcuts from all branches"
  // toggle). Fires a repaint so the change is immediately visible; persistence is the
  // caller's (it owns the workspace-state key and the context-key sync).
  setShowAllBranches(value: boolean): void {
    if (this.showAllBranches === value) {
      return;
    }
    this.showAllBranches = value;
    this._onDidChangeTreeData.fire();
  }

  isShowingAllBranches(): boolean {
    return this.showAllBranches;
  }

  // True when at least one branch-linked shortcut is currently hidden by branch
  // filtering, so the caller can reveal the "Show shortcuts from all branches"
  // affordance only when it would actually surface something (never silently
  // unreachable). Always false while showing all branches (nothing is hidden then).
  // Excludes recipe shortcuts, which never carry a branch.
  hasBranchHiddenShortcuts(): boolean {
    if (this.showAllBranches) {
      return false;
    }
    const all = [
      ...this.store.getProjectShortcuts().filter((s) => !s.isRecipe),
      ...this.store.getGlobalShortcuts(),
    ];
    return all.some((s) => s.branch !== undefined && !this.branchMatches(s));
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: vscode.TreeItem): vscode.TreeItem[] {
    const active = this.filter.isActive();
    if (!element) {
      // Roots: an optional Recent group (last-called shortcuts, local telemetry) above
      // the two scope roots. With no filter, both scopes are always shown so the
      // user can see where a new shortcut will land even when one is empty; Recent
      // appears only when there is history. While a filter IS active, a scope with
      // no matching shortcut is hidden (showing an empty Project header during a search
      // is noise) — the always-visible filter message names what was hidden, so a
      // collapsed-away scope never reads as lost data.
      const roots: vscode.TreeItem[] = [];
      const recent = recentEntries(this.store).filter((e) =>
        this.matches(e.shortcut)
      );
      if (recent.length > 0) {
        roots.push(new RecentRootItem(recent.length, telemetry.recentExpanded()));
      }
      for (const scope of ["project", "global"] as const) {
        const label =
          scope === "project"
            ? l10n("pin.group.project")
            : l10n("pin.group.global");
        const all = this.scopeShortcuts(scope);
        const visible = all.filter((s) => this.matches(s));
        // While filtering, hide a scope with no matching shortcut (an empty header
        // during a search is noise; the filter banner names what was hidden).
        // Unfiltered, Project always shows — it is the primary surface and the landing
        // spot for a first shortcut — but Global shows only when it actually holds
        // shortcuts: an always-on "Global Shortcuts 0" is pure clutter, since a global
        // shortcut is created by command ("Add Shortcut (Global)") rather than by
        // needing a visible empty header to aim at.
        const show = active
          ? visible.length > 0
          : scope === "project" || all.length > 0;
        if (!show) {
          continue;
        }
        // Count reflects what the header's subtree actually shows: the matching
        // count while filtering, the full (recipe-excluded) count otherwise.
        const count = active ? visible.length : all.length;
        roots.push(new ShortcutGroupItem(label, scope, count));
      }
      return roots;
    }

    if (element instanceof RecentRootItem) {
      return recentEntries(this.store)
        .filter((e) => this.matches(e.shortcut))
        .map((e) => buildRecentItem(this.store, e.shortcut, e.record));
    }

    if (element instanceof ShortcutGroupItem) {
      const scope = element.group;
      // Groups first (sorted by the store), then the scope's top-level shortcuts
      // (those with no groupId). Auto-added shortcuts are never grouped, so they fall
      // here. While filtering, a group with no matching child is hidden (hide-empty-
      // groups) and each header's count is the matching count.
      const groups = this.store
        .getGroups(scope)
        .map((group) => {
          const members = this.scopeShortcuts(scope).filter(
            (s) => s.groupId === group.id
          );
          const visible = members.filter((s) => this.matches(s));
          return { group, members, visible };
        })
        .filter((g) => !active || g.visible.length > 0)
        .map(
          (g) =>
            new ShortcutFolderItem(
              g.group,
              scope,
              active ? g.visible.length : g.members.length
            )
        );
      // Top-level shortcuts are those with no group OR whose group no longer exists in
      // the store — e.g. a shortcut filed into a built-in default group after the user
      // turned default groups off. It keeps its stored groupId (so it returns to its
      // folder when the groups come back), but while that group is not rendered it must
      // float to the top level rather than vanish. A group hidden only by the active
      // text filter still EXISTS in getGroups, so its members are not pulled up here.
      const existingGroupIds = new Set(
        this.store.getGroups(scope).map((g) => g.id)
      );
      const topLevel = this.scopeShortcuts(scope)
        .filter(
          (s) =>
            (!s.groupId || !existingGroupIds.has(s.groupId)) && this.matches(s)
        )
        .map((shortcut) => buildShortcutItem(this.store, shortcut));
      return [...groups, ...topLevel];
    }

    if (element instanceof ShortcutFolderItem) {
      return this.scopeShortcuts(element.scope)
        .filter((s) => s.groupId === element.shortcutGroup.id && this.matches(s))
        .map((shortcut) => buildShortcutItem(this.store, shortcut));
    }

    return [];
  }

  // Required for TreeView.reveal: walk a node up to its scope root. Parents are
  // rebuilt from the element's own fields (matched back by their stable ids), so
  // no parent cache is needed.
  getParent(element: vscode.TreeItem): vscode.TreeItem | undefined {
    if (element instanceof ShortcutTreeItem) {
      // A Recent entry's parent is the Recent root, not the shortcut's home scope.
      if (element.isRecent) {
        return new RecentRootItem(
          recentEntries(this.store).length,
          telemetry.recentExpanded()
        );
      }
      const shortcut = element.shortcut;
      // Recipe shortcuts are served by the separate Recipes view, so they never appear
      // in this tree; only user/auto-added shortcuts reach here.
      if (shortcut.groupId) {
        const group = this.store
          .getGroups(shortcut.scope)
          .find((g) => g.id === shortcut.groupId);
        if (group) {
          return this.makeFolderItem(group, shortcut.scope);
        }
      }
      return this.makeScopeRoot(shortcut.scope);
    }
    if (element instanceof ShortcutFolderItem) {
      return this.makeScopeRoot(element.scope);
    }
    return undefined;
  }

  // Build the tree item for a shortcut so the status bar can reveal it. Matched by its
  // stable id even though the tree recreates items on every render.
  revealItem(shortcut: Shortcut): ShortcutTreeItem {
    return buildShortcutItem(this.store, shortcut);
  }

  // --- drag and drop -----------------------------------------------------

  handleDrag(
    source: readonly vscode.TreeItem[],
    dataTransfer: vscode.DataTransfer
  ): void {
    buildShortcutDragData(source, dataTransfer);
  }

  async handleDrop(
    target: vscode.TreeItem | undefined,
    dataTransfer: vscode.DataTransfer
  ): Promise<void> {
    const transferItem = dataTransfer.get(SHORTCUT_MIME);
    if (!transferItem) {
      // No internal shortcut payload: this is an external file drag (Explorer / OS).
      // Dropping a file onto a script shortcut runs that shortcut against the file.
      await handleExternalFileDrop(target, dataTransfer);
      return;
    }
    const ids = parseShortcutIds(await transferItem.asString());
    const shortcuts = ids
      .map((id) => this.store.findShortcut(id))
      .filter((s): s is Shortcut => s !== undefined);
    if (shortcuts.length === 0) {
      return;
    }

    const moveTarget = resolveDropTarget(target, shortcuts);
    if (!moveTarget) {
      return;
    }
    await this.store.moveShortcuts(shortcuts, moveTarget);
  }

  // --- helpers -----------------------------------------------------------

  private shortcutsInScope(scope: ShortcutScope): Shortcut[] {
    return scope === "global"
      ? this.store.getGlobalShortcuts()
      : this.store.getProjectShortcuts();
  }

  // The shortcuts this view actually renders for a scope: the project list carries
  // recipe shortcuts (served by the separate Recipes view), so they are excluded here,
  // and branch-linked shortcuts not on the current branch are dropped (WOW #3). Used by
  // the filter visibility/count logic so a "0 hidden" count and a hidden scope agree
  // on the same population the headers show. Branch filtering composes with — does
  // not duplicate — the text/chip/tag filter (that runs separately via matches()):
  // branch filtering is always-on context, the text filter is a user-chosen facet.
  private scopeShortcuts(scope: ShortcutScope): Shortcut[] {
    const all = this.shortcutsInScope(scope);
    const visible = scope === "project" ? all.filter((s) => !s.isRecipe) : all;
    return visible.filter((s) => this.branchMatches(s));
  }

  // Whether a shortcut passes branch filtering (WOW #3). An unlinked shortcut (the
  // default) always shows. A linked shortcut shows only while its owning folder is on
  // the linked branch — a project shortcut against its own folder, a global shortcut
  // against the first workspace folder. The safety invariant mirrors the time-bomb
  // sweep: when the folder or its branch cannot be read, the shortcut is SHOWN, never
  // hidden, so an unreadable / detached / worktree repo never makes a shortcut vanish.
  // The show-all toggle short-circuits to true (the deleted-branch escape hatch).
  private branchMatches(shortcut: Shortcut): boolean {
    if (this.showAllBranches || !shortcut.branch) {
      return true;
    }
    const folder =
      shortcut.scope === "global"
        ? vscode.workspace.workspaceFolders?.[0]
        : this.store.folderOf(shortcut);
    if (!folder) {
      return true;
    }
    const current = this.branches.branchOf(folder);
    if (current === undefined) {
      return true;
    }
    return shortcut.branch === current;
  }

  // Whether a shortcut passes the active filter (WOW #28). Always true when no filter
  // is set, so the unfiltered tree is unchanged. The last-run-failed state is read
  // from the session run-status registry and handed to the pure predicate.
  private matches(shortcut: Shortcut): boolean {
    const filter = this.filter.get();
    if (!this.filter.isActive()) {
      return true;
    }
    const failed = runStatusRegistry.get(shortcut.id)?.outcome === "failure";
    return shortcutMatchesFilter(shortcut, filter, failed);
  }

  private makeScopeRoot(scope: ShortcutScope): ShortcutGroupItem {
    const label =
      scope === "global"
        ? l10n("pin.group.global")
        : l10n("pin.group.project");
    // The count reflects the rendered population — recipe shortcuts (served by the
    // Recipes view) and branch-hidden shortcuts are already excluded by scopeShortcuts,
    // so the reveal-built header agrees with the live one.
    const count = this.scopeShortcuts(scope).length;
    return new ShortcutGroupItem(label, scope, count);
  }

  private makeFolderItem(
    group: ShortcutGroup,
    scope: ShortcutScope
  ): ShortcutFolderItem {
    const count = this.scopeShortcuts(scope).filter(
      (s) => s.groupId === group.id
    ).length;
    return new ShortcutFolderItem(group, scope, count);
  }
}
