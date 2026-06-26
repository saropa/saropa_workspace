import * as vscode from "vscode";
import { Pin, PinGroup, PinScope, pinKind } from "../model/pin";
import { MoveTarget, PinStore } from "../model/pinStore";
import { processRegistry } from "../exec/processRegistry";
import { runStatusRegistry } from "../exec/runStatus";
import { pinBadges } from "../exec/pinBadges";
import { metricBadges, MetricTarget } from "../exec/metricBadges";
import { dependencyState } from "../exec/dependencies";
import { telemetry, RunRecord } from "../exec/telemetry";
import { BranchTracker } from "../exec/gitBranch";
import { l10n } from "../i18n/l10n";
import { PinFilterState, pinMatchesFilter } from "./pinFilter";
import { PinFolderItem, PinGroupItem, PinTreeItem, RecentRootItem } from "./pinTreeItem";

// Custom drag-and-drop MIME for moving pins within the view. A custom type (vs
// the auto-generated tree MIME) keeps the contract explicit and decoupled from
// the view id; the payload is the JSON array of dragged pin ids, resolved back
// to live pins through the store on drop.
const PIN_MIME = "application/vnd.saropa.workspace.pins";

// Standard MIME for files dragged from the Explorer (or the OS). Accepting it lets a
// file be dropped onto a script pin to run that pin against the file (WOW #8).
const URI_LIST_MIME = "text/uri-list";

// Tree: scope roots (Project / Global) -> user groups + top-level pins -> pins.
// Also the drag-and-drop controller, so a pin can be reordered and moved between
// groups by dragging it (handleDrag/handleDrop below).
export class PinsTreeProvider
  implements
    vscode.TreeDataProvider<vscode.TreeItem>,
    vscode.TreeDragAndDropController<vscode.TreeItem>
{
  readonly dropMimeTypes = [PIN_MIME, URI_LIST_MIME];
  readonly dragMimeTypes = [PIN_MIME];

  private readonly _onDidChangeTreeData = new vscode.EventEmitter<
    vscode.TreeItem | undefined | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  // When true, branch filtering is suspended and every branch-linked pin is shown
  // regardless of the current branch — the escape hatch for a pin scoped to a
  // deleted/unreachable branch (WOW #3). Persisted by the caller in workspaceState;
  // the initial value is passed in so a reload keeps the chosen scope.
  private showAllBranches: boolean;

  constructor(
    private readonly store: PinStore,
    private readonly filter: PinFilterState,
    private readonly branches: BranchTracker,
    showAllBranches: boolean
  ) {
    this.showAllBranches = showAllBranches;
    // Repaint whenever the store recomputes its cached pins, when a background
    // process starts/stops (running indicator + Stop action), or when a run
    // finishes (success/failure badge). A store change can also add/remove a
    // metric'd pin, so reconcile the metric engine's watchers off the same event.
    store.onDidChange(() => {
      this.syncMetrics();
      this._onDidChangeTreeData.fire();
    });
    // A re-measured metric (#24) updates only a pin's inline value, so repaint.
    metricBadges.onDidChange(() => this._onDidChangeTreeData.fire());
    processRegistry.onDidChange(() => this._onDidChangeTreeData.fire());
    runStatusRegistry.onDidChange(() => this._onDidChangeTreeData.fire());
    // A new lint/test sweep badge (severity counts / test tally) repaints the row.
    pinBadges.onDidChange(() => this._onDidChangeTreeData.fire());
    // A recorded run (or a reset) changes the Recent group's contents.
    telemetry.onDidChange(() => this._onDidChangeTreeData.fire());
    // The text/chip filter (WOW #28) changes which rows and groups are visible.
    this.filter.onDidChange(() => this._onDidChangeTreeData.fire());
    // A branch checkout (WOW #3) changes which branch-linked pins are visible, so
    // repaint the tree to re-filter against the new current branch.
    this.branches.onDidChangeBranch(() => this._onDidChangeTreeData.fire());
  }

  // Suspend or resume branch filtering (the "Show pins from all branches" toggle).
  // Fires a repaint so the change is immediately visible; persistence is the
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

  // True when at least one branch-linked pin is currently hidden by branch filtering,
  // so the caller can reveal the "Show pins from all branches" affordance only when
  // it would actually surface something (never silently unreachable). Always false
  // while showing all branches (nothing is hidden then). Excludes recipe pins, which
  // never carry a branch.
  hasBranchHiddenPins(): boolean {
    if (this.showAllBranches) {
      return false;
    }
    const all = [
      ...this.store.getProjectPins().filter((p) => !p.isRecipe),
      ...this.store.getGlobalPins(),
    ];
    return all.some((p) => p.branch !== undefined && !this.branchMatches(p));
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: vscode.TreeItem): vscode.TreeItem[] {
    const active = this.filter.isActive();
    if (!element) {
      // Roots: an optional Recent group (last-called pins, local telemetry) above
      // the two scope roots. With no filter, both scopes are always shown so the
      // user can see where a new pin will land even when one is empty; Recent
      // appears only when there is history. While a filter IS active, a scope with
      // no matching pin is hidden (showing an empty Project header during a search
      // is noise) — the always-visible filter message names what was hidden, so a
      // collapsed-away scope never reads as lost data.
      const roots: vscode.TreeItem[] = [];
      const recent = this.recentEntries().filter((e) => this.matches(e.pin));
      if (recent.length > 0) {
        roots.push(new RecentRootItem(recent.length, telemetry.recentExpanded()));
      }
      for (const scope of ["project", "global"] as const) {
        const label =
          scope === "project"
            ? l10n("pin.group.project")
            : l10n("pin.group.global");
        const all = this.scopePins(scope);
        const visible = all.filter((p) => this.matches(p));
        // While filtering, hide a scope with no matching pin (an empty header during
        // a search is noise; the filter banner names what was hidden). Unfiltered,
        // Project always shows — it is the primary surface and the landing spot for a
        // first pin — but Global shows only when it actually holds pins: an always-on
        // "Global Pins 0" is pure clutter, since a global pin is created by command
        // ("Pin (Global)") rather than by needing a visible empty header to aim at.
        const show = active
          ? visible.length > 0
          : scope === "project" || all.length > 0;
        if (!show) {
          continue;
        }
        // Count reflects what the header's subtree actually shows: the matching
        // count while filtering, the full (recipe-excluded) count otherwise.
        const count = active ? visible.length : all.length;
        roots.push(new PinGroupItem(label, scope, count));
      }
      return roots;
    }

    if (element instanceof RecentRootItem) {
      return this.recentEntries()
        .filter((e) => this.matches(e.pin))
        .map((e) => this.toRecentItem(e.pin, e.record));
    }

    if (element instanceof PinGroupItem) {
      const scope = element.group;
      // Groups first (sorted by the store), then the scope's top-level pins
      // (those with no groupId). Auto-pins are never grouped, so they fall here.
      // While filtering, a group with no matching child is hidden (hide-empty-
      // groups) and each header's count is the matching count.
      const groups = this.store
        .getGroups(scope)
        .map((group) => {
          const members = this.scopePins(scope).filter(
            (p) => p.groupId === group.id
          );
          const visible = members.filter((p) => this.matches(p));
          return { group, members, visible };
        })
        .filter((g) => !active || g.visible.length > 0)
        .map(
          (g) =>
            new PinFolderItem(
              g.group,
              scope,
              active ? g.visible.length : g.members.length
            )
        );
      const topLevel = this.scopePins(scope)
        .filter((p) => !p.groupId && this.matches(p))
        .map((pin) => this.toPinItem(pin));
      return [...groups, ...topLevel];
    }

    if (element instanceof PinFolderItem) {
      return this.scopePins(element.scope)
        .filter((p) => p.groupId === element.pinGroup.id && this.matches(p))
        .map((pin) => this.toPinItem(pin));
    }

    return [];
  }

  // Required for TreeView.reveal: walk a node up to its scope root. Parents are
  // rebuilt from the element's own fields (matched back by their stable ids), so
  // no parent cache is needed.
  getParent(element: vscode.TreeItem): vscode.TreeItem | undefined {
    if (element instanceof PinTreeItem) {
      // A Recent entry's parent is the Recent root, not the pin's home scope.
      if (element.isRecent) {
        return new RecentRootItem(
          this.recentEntries().length,
          telemetry.recentExpanded()
        );
      }
      const pin = element.pin;
      // Recipe pins are served by the separate Recipes view, so they never appear
      // in this tree; only user/auto pins reach here.
      if (pin.groupId) {
        const group = this.store
          .getGroups(pin.scope)
          .find((g) => g.id === pin.groupId);
        if (group) {
          return this.makeFolderItem(group, pin.scope);
        }
      }
      return this.makeScopeRoot(pin.scope);
    }
    if (element instanceof PinFolderItem) {
      return this.makeScopeRoot(element.scope);
    }
    return undefined;
  }

  // Build the tree item for a pin so the status bar can reveal it. Matched by its
  // stable id even though the tree recreates items on every render.
  revealItem(pin: Pin): PinTreeItem {
    return this.toPinItem(pin);
  }

  // --- drag and drop -----------------------------------------------------

  handleDrag(
    source: readonly vscode.TreeItem[],
    dataTransfer: vscode.DataTransfer
  ): void {
    // Only real pins are draggable; groups, scope roots, and read-only Recent
    // entries stay put (a recent entry mirrors a pin reordered from its home).
    const ids = source
      .filter(
        (item): item is PinTreeItem =>
          item instanceof PinTreeItem && !item.isRecent
      )
      .map((item) => item.pin.id);
    if (ids.length === 0) {
      return;
    }
    dataTransfer.set(PIN_MIME, new vscode.DataTransferItem(JSON.stringify(ids)));
  }

  async handleDrop(
    target: vscode.TreeItem | undefined,
    dataTransfer: vscode.DataTransfer
  ): Promise<void> {
    const transferItem = dataTransfer.get(PIN_MIME);
    if (!transferItem) {
      // No internal pin payload: this is an external file drag (Explorer / OS).
      // Dropping a file onto a script pin runs that pin against the file.
      await this.handleExternalFileDrop(target, dataTransfer);
      return;
    }
    const ids = this.parseIds(await transferItem.asString());
    const pins = ids
      .map((id) => this.store.findPin(id))
      .filter((p): p is Pin => p !== undefined);
    if (pins.length === 0) {
      return;
    }

    const moveTarget = this.resolveDropTarget(target, pins);
    if (!moveTarget) {
      return;
    }
    await this.store.movePins(pins, moveTarget);
  }

  // Handle a file dragged from the Explorer (or OS) and dropped onto a pin: run that
  // pin against the file via $droppedFile (WOW #8). Only a pin row is a valid target
  // (a group/scope header has no command to run); the command handler rejects a
  // non-runnable pin with a message. Only the first dropped file is used.
  private async handleExternalFileDrop(
    target: vscode.TreeItem | undefined,
    dataTransfer: vscode.DataTransfer
  ): Promise<void> {
    if (!(target instanceof PinTreeItem) || target.isRecent) {
      return;
    }
    const uriItem = dataTransfer.get(URI_LIST_MIME);
    if (!uriItem) {
      return;
    }
    // text/uri-list is CRLF-separated; comment lines start with '#'. Take the first
    // real URI.
    const first = (await uriItem.asString())
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0 && !line.startsWith("#"));
    if (!first) {
      return;
    }
    let fsPath: string;
    try {
      fsPath = vscode.Uri.parse(first).fsPath;
    } catch {
      return;
    }
    await vscode.commands.executeCommand(
      "saropaWorkspace.runPinOnFile",
      target.pin,
      fsPath
    );
  }

  // Map the dropped-on node to a concrete move destination. Dropping on a scope
  // root moves to that scope's top level; on a group, into that group; on a pin,
  // ahead of that pin in its group. Dropping on empty space keeps the dragged
  // pins in their own scope at top level.
  private resolveDropTarget(
    target: vscode.TreeItem | undefined,
    pins: Pin[]
  ): MoveTarget | undefined {
    // The Recent group is read-only: dropping onto it or one of its entries is a
    // no-op (those entries are not a real location a pin can move into).
    if (target instanceof RecentRootItem) {
      return undefined;
    }
    if (target instanceof PinTreeItem && target.isRecent) {
      return undefined;
    }
    if (target instanceof PinGroupItem) {
      return { scope: target.group, groupId: undefined };
    }
    if (target instanceof PinFolderItem) {
      return { scope: target.scope, groupId: target.pinGroup.id };
    }
    if (target instanceof PinTreeItem) {
      return {
        scope: target.pin.scope,
        groupId: target.pin.groupId,
        beforePinId: target.pin.id,
      };
    }
    // Empty space: top level of the dragged pins' scope (skip if mixed scopes).
    const scope = pins[0].scope;
    if (pins.some((p) => p.scope !== scope)) {
      return undefined;
    }
    return { scope, groupId: undefined };
  }

  private parseIds(raw: string | undefined): string[] {
    if (!raw) {
      return [];
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed)
        ? parsed.filter((v): v is string => typeof v === "string")
        : [];
    } catch {
      return [];
    }
  }

  // --- helpers -----------------------------------------------------------

  private pinsInScope(scope: PinScope): Pin[] {
    return scope === "global"
      ? this.store.getGlobalPins()
      : this.store.getProjectPins();
  }

  // The pins this view actually renders for a scope: the project list carries
  // recipe pins (served by the separate Recipes view), so they are excluded here,
  // and branch-linked pins not on the current branch are dropped (WOW #3). Used by
  // the filter visibility/count logic so a "0 hidden" count and a hidden scope agree
  // on the same population the headers show. Branch filtering composes with — does
  // not duplicate — the text/chip/tag filter (that runs separately via matches()):
  // branch filtering is always-on context, the text filter is a user-chosen facet.
  private scopePins(scope: PinScope): Pin[] {
    const all = this.pinsInScope(scope);
    const visible = scope === "project" ? all.filter((p) => !p.isRecipe) : all;
    return visible.filter((p) => this.branchMatches(p));
  }

  // Whether a pin passes branch filtering (WOW #3). An unlinked pin (the default)
  // always shows. A linked pin shows only while its owning folder is on the linked
  // branch — a project pin against its own folder, a global pin against the first
  // workspace folder. The safety invariant mirrors the time-bomb sweep: when the
  // folder or its branch cannot be read, the pin is SHOWN, never hidden, so an
  // unreadable / detached / worktree repo never makes a pin vanish. The show-all
  // toggle short-circuits to true (the deleted-branch escape hatch).
  private branchMatches(pin: Pin): boolean {
    if (this.showAllBranches || !pin.branch) {
      return true;
    }
    const folder =
      pin.scope === "global"
        ? vscode.workspace.workspaceFolders?.[0]
        : this.store.folderOf(pin);
    if (!folder) {
      return true;
    }
    const current = this.branches.branchOf(folder);
    if (current === undefined) {
      return true;
    }
    return pin.branch === current;
  }

  // Whether a pin passes the active filter (WOW #28). Always true when no filter
  // is set, so the unfiltered tree is unchanged. The last-run-failed state is read
  // from the session run-status registry and handed to the pure predicate.
  private matches(pin: Pin): boolean {
    const filter = this.filter.get();
    if (!this.filter.isActive()) {
      return true;
    }
    const failed = runStatusRegistry.get(pin.id)?.outcome === "failure";
    return pinMatchesFilter(pin, filter, failed);
  }

  private toPinItem(pin: Pin): PinTreeItem {
    return new PinTreeItem(
      pin,
      this.store.resolveUri(pin),
      processRegistry.isRunning(pin.id),
      runStatusRegistry.get(pin.id),
      processRegistry.isStopping(pin.id),
      undefined,
      this.store.isMissing(pin.id),
      this.runCount(pin.id),
      this.lockedBy(pin),
      pinBadges.get(pin.id),
      metricBadges.get(pin.id)
    );
  }

  // Reconcile the metric engine's file watchers (#24) against the current set of
  // metric'd file pins across both scopes. Only a file pin that carries a metric and
  // resolves to a concrete URI is watched, so a workspace with no metric'd pins arms
  // no watchers at all. Cheap and idempotent: the engine keeps an unchanged target's
  // live watcher untouched, so calling this on every store change costs nothing in
  // the steady state.
  private syncMetrics(): void {
    const targets: MetricTarget[] = [];
    for (const pin of [...this.store.getProjectPins(), ...this.store.getGlobalPins()]) {
      if (!pin.metric || pinKind(pin) !== "file") {
        continue;
      }
      const uri = this.store.resolveUri(pin);
      if (!uri) {
        continue;
      }
      targets.push({
        pinId: pin.id,
        name: pin.label ?? (pin.path.split("/").pop() ?? pin.path),
        uri,
        metric: pin.metric,
      });
    }
    metricBadges.track(targets);
  }

  // The display name of a pin's unmet run prerequisite (WOW #13), or undefined when
  // the pin is cleared to run. The provider repaints on runStatusRegistry changes, so
  // a pin unlocks the moment its prerequisite succeeds.
  private lockedBy(pin: Pin): string | undefined {
    const { pendingDependencyId } = dependencyState(pin, (id) =>
      this.store.findPin(id)
    );
    if (!pendingDependencyId) {
      return undefined;
    }
    const dep = this.store.findPin(pendingDependencyId);
    return dep
      ? dep.label ?? (dep.path.split("/").pop() ?? dep.path)
      : pendingDependencyId;
  }

  // A Recent-group entry: the same pin node, tagged with when/how it last ran.
  private toRecentItem(pin: Pin, record: RunRecord): PinTreeItem {
    return new PinTreeItem(
      pin,
      this.store.resolveUri(pin),
      processRegistry.isRunning(pin.id),
      runStatusRegistry.get(pin.id),
      processRegistry.isStopping(pin.id),
      { at: record.at, source: record.source },
      this.store.isMissing(pin.id),
      this.runCount(pin.id)
    );
  }

  // The lifetime run count to surface in a pin's tooltip — zero when telemetry is
  // disabled, so a turned-off user sees no count (the data is left in place until
  // they reset it, but it is not displayed).
  private runCount(pinId: string): number {
    return telemetry.enabled() ? telemetry.count(pinId) : 0;
  }

  // The recent run records that still resolve to a live pin (an unpinned/deleted
  // pin is skipped, matching the palette). Empty when telemetry is disabled.
  private recentEntries(): { pin: Pin; record: RunRecord }[] {
    if (!telemetry.enabled()) {
      return [];
    }
    return telemetry
      .recent()
      .map((record) => {
        const pin = this.store.findPin(record.pinId);
        return pin ? { pin, record } : undefined;
      })
      .filter((e): e is { pin: Pin; record: RunRecord } => e !== undefined);
  }

  private makeScopeRoot(scope: PinScope): PinGroupItem {
    const label =
      scope === "global"
        ? l10n("pin.group.global")
        : l10n("pin.group.project");
    // The count reflects the rendered population — recipe pins (served by the
    // Recipes view) and branch-hidden pins are already excluded by scopePins, so the
    // reveal-built header agrees with the live one.
    const count = this.scopePins(scope).length;
    return new PinGroupItem(label, scope, count);
  }

  private makeFolderItem(group: PinGroup, scope: PinScope): PinFolderItem {
    const count = this.scopePins(scope).filter(
      (p) => p.groupId === group.id
    ).length;
    return new PinFolderItem(group, scope, count);
  }
}
