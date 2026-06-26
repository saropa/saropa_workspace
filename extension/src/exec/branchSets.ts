import * as vscode from "vscode";
import { PinStore } from "../model/pinStore";
import { BranchTracker } from "./gitBranch";
import { getOutputChannel } from "./runner";
import { l10n } from "../i18n/l10n";

// Branch-aware pin sets (roadmap 3.2). Binds a git branch name to a named pin set
// so that, when the feature is enabled, the active set follows the current branch:
// a checkout switches the tree to that branch's set (and can run one designated
// pin, e.g. "refresh dependencies"). Built ENTIRELY on top of the existing
// primitives — the named-pin-set API on PinStore and the .git/HEAD branch tracker
// (BranchTracker) — so there is no second git layer and no new set machinery.
//
// Gated by saropaWorkspace.branchAware.enabled (default OFF): with it off the
// binder observes branch changes but never switches, so behavior is identical to
// plain pin sets. Outside a git repo the tracker reports no branch, so the binder
// is inert and raises no errors (graceful degradation).
//
// The branch -> binding map is per-workspace (workspaceState), mirroring the
// "show all branches" scope flag: a branch binding is a personal workflow choice
// for this checkout, not data shared via the repo. It is keyed by the PRIMARY
// folder's branch name; pin sets are coordinated across a multi-root workspace by
// name (see PinStore), so a single map keyed by the primary branch stays coherent
// with the rest of the set machinery.
const BRANCH_SETS_KEY = "saropaWorkspace.branchSets";

// One branch's binding: the set to activate, and an optional pin id to run after
// the switch. The pin is resolved AFTER the switch (so a project pin living in the
// now-active set is found); a deleted pin fails safe — logged and skipped, never
// thrown.
export interface BranchSetBinding {
  set: string;
  runPinId?: string;
}

export class BranchSetBinder implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];

  // The branch the active set was last aligned to. Guards against re-switching on a
  // tracker fire that is NOT a checkout: BranchTracker.onDidChangeBranch also fires
  // on init and on a workspace-folder change. Without this guard, such a fire would
  // undo a set the user manually switched to while staying on the same branch. Only
  // an actual branch change re-aligns.
  private lastBranch: string | undefined;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly store: PinStore,
    private readonly tracker: BranchTracker
  ) {
    // React to checkouts. The tracker debounces a checkout's HEAD-write burst into a
    // single fire; init/folder-change fires are absorbed by the lastBranch guard.
    this.disposables.push(
      this.tracker.onDidChangeBranch(() => void this.onBranchSignal())
    );
  }

  isEnabled(): boolean {
    return vscode.workspace
      .getConfiguration("saropaWorkspace")
      .get<boolean>("branchAware.enabled", false);
  }

  // The primary folder's current branch, or undefined outside a readable repo. The
  // link/unlink commands need it to know which branch they are binding.
  currentBranch(): string | undefined {
    return this.tracker.primaryBranch();
  }

  // The whole branch -> binding map for this workspace.
  bindings(): Record<string, BranchSetBinding> {
    return this.context.workspaceState.get<Record<string, BranchSetBinding>>(
      BRANCH_SETS_KEY,
      {}
    );
  }

  getBinding(branch: string): BranchSetBinding | undefined {
    return this.bindings()[branch];
  }

  async setBinding(branch: string, binding: BranchSetBinding): Promise<void> {
    const next = { ...this.bindings(), [branch]: binding };
    await this.context.workspaceState.update(BRANCH_SETS_KEY, next);
  }

  async clearBinding(branch: string): Promise<void> {
    const next = { ...this.bindings() };
    delete next[branch];
    await this.context.workspaceState.update(BRANCH_SETS_KEY, next);
  }

  // Force a re-evaluation against the current branch, ignoring lastBranch. Called
  // when the feature is toggled on, so enabling it immediately aligns the active set
  // to the current branch's binding instead of waiting for the next checkout.
  async applyNow(): Promise<void> {
    this.lastBranch = undefined;
    await this.onBranchSignal();
  }

  // Core: when enabled and the branch actually changed, switch to the branch's bound
  // set and optionally run its on-switch pin. Every early return leaves the active
  // set untouched, so the feature is a no-op when off, outside git, or unbound.
  private async onBranchSignal(): Promise<void> {
    if (!this.isEnabled()) {
      return;
    }
    const branch = this.currentBranch();
    // No readable branch (no repo / detached-unreadable / not yet read): stay inert.
    if (branch === undefined) {
      return;
    }
    // Only a real branch change re-aligns; an unrelated tracker fire (folder change)
    // must not undo a set the user manually switched to on this same branch.
    if (branch === this.lastBranch) {
      return;
    }
    this.lastBranch = branch;
    const binding = this.bindings()[branch];
    if (!binding) {
      return;
    }
    // Already on the bound set: nothing to switch, no toast.
    if (binding.set === this.store.getActiveSetName()) {
      return;
    }
    await this.store.switchSet(binding.set);
    if (binding.runPinId) {
      this.runOnSwitchPin(binding.runPinId, binding.set, branch);
    } else {
      void vscode.window.showInformationMessage(
        l10n("branchSet.switched", { set: binding.set, branch })
      );
    }
  }

  // Run the binding's on-switch pin through the normal Run command, so the run is
  // visible (no silent execution) and reuses token resolution / telemetry. Resolved
  // AFTER the switch, so a project pin that lives in the now-active set is found; a
  // deleted pin is logged and skipped (the switch still stands).
  private runOnSwitchPin(pinId: string, set: string, branch: string): void {
    const pin = this.store.findPin(pinId);
    if (!pin) {
      getOutputChannel().appendLine(l10n("branchSet.pinMissing", { branch, set }));
      void vscode.window.showInformationMessage(
        l10n("branchSet.switched", { set, branch })
      );
      return;
    }
    const name = pin.label ?? pin.path.split("/").pop() ?? pin.path;
    void vscode.window.showInformationMessage(
      l10n("branchSet.switchedAndRan", { set, branch, name })
    );
    void vscode.commands.executeCommand("saropaWorkspace.runPin", pin);
  }

  dispose(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}
