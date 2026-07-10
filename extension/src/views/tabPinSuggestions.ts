import * as vscode from "vscode";
import * as path from "path";
import { ShortcutStore } from "../model/shortcutStore";
import { l10n } from "../i18n/l10n";

// Suggest promoting a long-lived native VS Code tab pin into a Saropa workspace shortcut.
//
// A manually pinned editor tab is a strong "this file matters" signal. When the
// user has kept one pinned past a threshold (default 2h) and it is not already a
// Saropa shortcut, offer a one-tap "Add to workspace / globally" toast.
//
// Two constraints shape the design:
//   1. VS Code's tab API exposes `tab.isPinned` but NO timestamp — there is no
//      "pinned at". So the elapsed time is tracked here: the first time a tab is
//      seen pinned, its epoch-ms is stored in globalState keyed by fsPath, cleared
//      when the tab is unpinned. It survives reloads because VS Code restores
//      pinned tabs, so the stored stamp stays valid across sessions.
//   2. On startup a tab may already be pinned with no stored stamp (it was pinned
//      before this extension watched, or the stamp was never written). Those are
//      snapshotted at activation: stamped with `now`, so a pre-existing pinned tab
//      starts its clock at snapshot time rather than firing immediately on data we
//      cannot date — the safe direction (never prompt on an unknown age).
//
// Once the user dismisses a file ("Don't ask again"), it is recorded permanently
// in `dismissed` and never offered again, surviving unpin/re-pin and reloads. The
// Restore command (restoreTabSuggestions) clears that list so a no is reversible.
// State lives in globalState and is never transmitted (no telemetry — see the
// roadmap Principles).

const STATE_KEY = "saropaWorkspace.tabPinSuggest.state";

// How often the elapsed-time check runs. The threshold is in hours, so a coarse
// poll is enough; a tab pin/unpin also triggers an immediate reconcile via the
// tab-change listener. 15 minutes keeps the worst-case prompt latency well under
// the (hour-scale) threshold without a busy timer.
const CHECK_INTERVAL_MS = 15 * 60 * 1000;

// Cap the dismissed list so it cannot grow without bound across a long-lived
// profile; the oldest dismissals fall off (re-offering them much later is
// acceptable — the user can dismiss again, and the Restore command exists).
const MAX_DISMISSED = 500;

// The persisted globalState record for this suggester: the pinned-since stamps
// (constraint 1 above) and the permanent dismiss list (constraint described in the
// file header).
export interface TabPinState {
  // fsPath -> epoch-ms when the tab was first seen pinned (and still is).
  firstPinnedAt: Record<string, number>;
  // fsPaths the user permanently dismissed; never offered again while present.
  dismissed: string[];
}

// The output of reconcileTabPins(): the next state to persist, whether it differs
// from the input (so callers can skip a redundant write), and the files that just
// crossed the threshold and are ready to prompt.
export interface TabPinReconcileResult {
  // The next persisted state after stamping new sightings and dropping stale ones.
  state: TabPinState;
  // True when `state` differs from the input (so the caller can skip a redundant write).
  changed: boolean;
  // fsPaths that have sat pinned past the threshold and are eligible to offer
  // (not dismissed, not already a Saropa shortcut). The caller applies its own
  // per-session de-dup before actually prompting.
  toOffer: string[];
}

// Pure reconcile core, extracted so the threshold / snapshot / dismiss logic is
// unit-testable without the VS Code host. Given the live pinned-tab set and the
// stored state, it returns the next state plus the files eligible to offer:
//   - a tab no longer pinned has its stamp dropped (clock resets on unpin/close);
//   - a dismissed file is never stamped or offered;
//   - a file already a Saropa shortcut has any stamp cleared and is not offered;
//   - a first sighting is stamped with `now` (this is also the activation-snapshot
//     path — a pre-existing pinned tab starts its clock now, never offered on undatable age);
//   - a stamped file older than the threshold is eligible to offer.
// The input state is not mutated; a fresh state object is returned.
export function reconcileTabPins(
  state: TabPinState,
  pinned: ReadonlySet<string>,
  isAlreadyShortcut: (fsPath: string) => boolean,
  now: number,
  thresholdMs: number
): TabPinReconcileResult {
  const firstPinnedAt: Record<string, number> = { ...state.firstPinnedAt };
  let changed = false;
  const toOffer: string[] = [];

  // Reset the clock for any tab no longer pinned, so a later re-pin starts fresh.
  for (const fsPath of Object.keys(firstPinnedAt)) {
    if (!pinned.has(fsPath)) {
      delete firstPinnedAt[fsPath];
      changed = true;
    }
  }

  for (const fsPath of pinned) {
    if (state.dismissed.includes(fsPath)) {
      continue;
    }
    if (isAlreadyShortcut(fsPath)) {
      if (firstPinnedAt[fsPath] !== undefined) {
        delete firstPinnedAt[fsPath];
        changed = true;
      }
      continue;
    }
    const since = firstPinnedAt[fsPath];
    if (since === undefined) {
      firstPinnedAt[fsPath] = now;
      changed = true;
      continue;
    }
    if (now - since >= thresholdMs) {
      toOffer.push(fsPath);
    }
  }

  return { state: { firstPinnedAt, dismissed: state.dismissed }, changed, toOffer };
}

// Path fragments never worth suggesting: VCS internals, dependency trees, and the
// extension's own shortcut/favorites files (mirrors the open-frequency suggester).
const NOISE = [
  `${path.sep}node_modules${path.sep}`,
  `${path.sep}.git${path.sep}`,
  `${path.sep}.vscode${path.sep}saropa-workspace.json`,
  `.favorites.json`,
];

// Wires the tab-change listener and the coarse poll timer, and owns the
// per-session offer gate on top of the pure reconcileTabPins() core. One instance
// lives for the extension's lifetime; dispose() clears the timer and listeners on deactivate.
export class TabPinSuggester {
  private readonly disposables: vscode.Disposable[] = [];
  private readonly timer: ReturnType<typeof setInterval>;
  // Per-session gate: a file offered (and not yet added/dismissed) is not
  // re-toasted on the next timer tick or tab change. Closing the toast without
  // choosing leaves the file eligible again on the NEXT session (it is not added
  // to the persistent `dismissed` list), matching "only a No is permanent".
  private readonly offeredThisSession = new Set<string>();

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly store: ShortcutStore
  ) {
    // A pin/unpin (or any tab open/close) reconciles stamps immediately, so an
    // unpinned tab's clock resets at once and a newly pinned tab is stamped.
    this.disposables.push(
      vscode.window.tabGroups.onDidChangeTabs(() => void this.tick())
    );
    // Coarse timer for the elapsed-time crossing (a tab can sit pinned for hours
    // with no tab event to wake the check).
    this.timer = setInterval(() => void this.tick(), CHECK_INTERVAL_MS);
    // Initial pass: snapshot pre-existing pins and catch any that already crossed
    // the threshold in a previous session (cross-session is the main case here).
    void this.tick();
  }

  dispose(): void {
    clearInterval(this.timer);
    for (const d of this.disposables) {
      d.dispose();
    }
  }

  // Clear the permanent dismissals so dismissed files can be offered again — the
  // Restore command's backing. Returns how many were cleared so the caller reports.
  async restoreDismissed(): Promise<number> {
    const state = this.readState();
    const cleared = state.dismissed.length;
    if (cleared > 0) {
      state.dismissed = [];
      await this.writeState(state);
    }
    this.offeredThisSession.clear();
    return cleared;
  }

  private enabled(): boolean {
    return vscode.workspace
      .getConfiguration("saropaWorkspace")
      .get<boolean>("suggestPinnedTab.enabled", true);
  }

  private afterHours(): number {
    return vscode.workspace
      .getConfiguration("saropaWorkspace")
      .get<number>("suggestPinnedTab.afterHours", 2);
  }

  // The distinct file-backed pinned tabs across every editor group, keyed by
  // fsPath (the same file pinned in two split groups collapses to one entry).
  // Non-file tabs (diffs, previews of non-text, webviews, notebooks) carry no
  // single text uri and are excluded; noise paths are filtered here too.
  private pinnedFileTabs(): Map<string, vscode.Uri> {
    const result = new Map<string, vscode.Uri>();
    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        if (!tab.isPinned) {
          continue;
        }
        const input = tab.input;
        if (!(input instanceof vscode.TabInputText) || input.uri.scheme !== "file") {
          continue;
        }
        const fsPath = input.uri.fsPath;
        if (NOISE.some((fragment) => fsPath.includes(fragment))) {
          continue;
        }
        result.set(fsPath, input.uri);
      }
    }
    return result;
  }

  // Reconcile stamps against the live pinned-tab set, then offer any that have sat
  // pinned past the threshold and are neither already a Saropa shortcut nor dismissed.
  private async tick(): Promise<void> {
    if (!this.enabled()) {
      return;
    }
    const current = this.pinnedFileTabs();
    const thresholdMs = this.afterHours() * 60 * 60 * 1000;
    const { state, changed, toOffer } = reconcileTabPins(
      this.readState(),
      new Set(current.keys()),
      (fsPath) => {
        const uri = current.get(fsPath);
        return uri !== undefined && this.isShortcut(uri);
      },
      Date.now(),
      thresholdMs
    );

    if (changed) {
      await this.writeState(state);
    }
    // Offer outside reconcile; each offer re-reads/writes state so a dismissal/add
    // choice persists independently of this tick's stamp write. The per-session
    // gate suppresses a re-toast for a file already offered this session.
    for (const fsPath of toOffer) {
      if (this.offeredThisSession.has(fsPath)) {
        continue;
      }
      const uri = current.get(fsPath);
      if (!uri) {
        continue;
      }
      this.offeredThisSession.add(fsPath);
      await this.offer(uri);
    }
  }

  // Offer to promote the long-pinned tab. A file inside a workspace folder can go
  // to either scope (project = shareable via the repo, or global); a file outside
  // any folder can only be global. "Don't ask again" is the permanent No.
  private async offer(uri: vscode.Uri): Promise<void> {
    const name = path.basename(uri.fsPath);
    const hours = this.afterHours();
    const inWorkspace = vscode.workspace.getWorkspaceFolder(uri) !== undefined;

    const toWorkspace = l10n("tabSuggest.pinWorkspace");
    const toGlobal = l10n("tabSuggest.pinGlobal");
    const dismiss = l10n("tabSuggest.never");
    const actions = inWorkspace
      ? [toWorkspace, toGlobal, dismiss]
      : [toGlobal, dismiss];

    const choice = await vscode.window.showInformationMessage(
      l10n("tabSuggest.prompt", { name, hours }),
      ...actions
    );

    if (choice === dismiss) {
      const state = this.readState();
      delete state.firstPinnedAt[uri.fsPath];
      if (!state.dismissed.includes(uri.fsPath)) {
        state.dismissed.push(uri.fsPath);
        if (state.dismissed.length > MAX_DISMISSED) {
          state.dismissed = state.dismissed.slice(-MAX_DISMISSED);
        }
      }
      await this.writeState(state);
      return;
    }

    if (choice === toWorkspace || choice === toGlobal) {
      const scope = choice === toWorkspace ? "project" : "global";
      const added = await this.store.addShortcut(uri, scope);
      vscode.window.showInformationMessage(
        added ? l10n("pin.added", { name }) : l10n("pin.alreadyPinned", { name })
      );
      // Now a Saropa shortcut (or already was): drop the stamp so tick() does not
      // re-consider it. Not added to `dismissed` — adding is a yes, not a no.
      const state = this.readState();
      if (state.firstPinnedAt[uri.fsPath] !== undefined) {
        delete state.firstPinnedAt[uri.fsPath];
        await this.writeState(state);
      }
      return;
    }
    // Closed without choosing: the session gate (offeredThisSession) already
    // suppresses a re-toast this session; it stays eligible next session.
  }

  private isShortcut(uri: vscode.Uri): boolean {
    return (
      this.store.findShortcutByUri(uri, "project") !== undefined ||
      this.store.findShortcutByUri(uri, "global") !== undefined
    );
  }

  private readState(): TabPinState {
    const stored = this.context.globalState.get<TabPinState>(STATE_KEY);
    return {
      firstPinnedAt:
        stored?.firstPinnedAt && typeof stored.firstPinnedAt === "object"
          ? stored.firstPinnedAt
          : {},
      dismissed: Array.isArray(stored?.dismissed) ? stored.dismissed : [],
    };
  }

  private async writeState(state: TabPinState): Promise<void> {
    await this.context.globalState.update(STATE_KEY, state);
  }
}
