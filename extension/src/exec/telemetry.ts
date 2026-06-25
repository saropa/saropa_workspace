import * as vscode from "vscode";

// Local, on-device run telemetry (roadmap 3.3). Records every pin run — manual or
// scheduled — so the sidebar's Recent group can list last-called items and the
// "Run Pin..." palette can surface frequent runs first.
//
// ON-DEVICE ONLY: stored in extension globalState (rides VS Code Settings Sync
// like the global pins), NEVER transmitted — see the "No remote telemetry"
// principle. Collection can be turned off (saropaWorkspace.telemetry.enabled) and
// the whole history reset (the "Reset Run History" command). When disabled,
// record() is a no-op and the Recent group is hidden; existing data is left in
// place until the user resets it.

export type RunSource = "manual" | "scheduled";

// One recorded run. `at` is epoch ms; `source` distinguishes a user-triggered run
// from an unattended scheduled fire (shown as a hint in the Recent group).
export interface RunRecord {
  pinId: string;
  at: number;
  source: RunSource;
}

interface TelemetryData {
  // Most-recent-first, de-duplicated by pinId (a re-run moves the pin to the
  // front and refreshes its timestamp). Bounded so it cannot grow without limit.
  recent: RunRecord[];
  // Per-pin lifetime run count, keyed by pin id. Survives recent-list eviction,
  // so the count is a true total, not just "within the last N runs".
  counts: Record<string, number>;
}

const KEY = "saropaWorkspace.telemetry";
// Pre-telemetry key: a bare ordered id list used by the palette. Folded into the
// richer store on first run so a dev install's recents are not lost.
const LEGACY_RECENT_KEY = "saropaWorkspace.recentRuns";
const RECENT_EXPANDED_KEY = "saropaWorkspace.recentGroupExpanded";
const MAX_RECENT = 20;

class Telemetry {
  // Set by activate(); until then every method is an inert no-op, so importing the
  // singleton at module load (e.g. in the runner) is safe before activation.
  private context: vscode.ExtensionContext | undefined;

  private readonly _onDidChange = new vscode.EventEmitter<void>();
  // Fires when a run is recorded or the history is reset, so the tree repaints.
  readonly onDidChange = this._onDidChange.event;

  init(context: vscode.ExtensionContext): void {
    this.context = context;
    this.migrateLegacy();
  }

  // Whether collection is on. Default true; the feature is opt-out, not opt-in,
  // because everything stays on the machine (no remote telemetry to consent to).
  enabled(): boolean {
    return vscode.workspace
      .getConfiguration("saropaWorkspace")
      .get<boolean>("telemetry.enabled", true);
  }

  // Ordered, de-duplicated pin ids, most-recent first. Used by the "Run Pin..."
  // palette to list recents above the full set.
  list(): string[] {
    return this.read().recent.map((r) => r.pinId);
  }

  // The recent run records (with timestamps and source) for the Recent group.
  recent(): RunRecord[] {
    return this.read().recent;
  }

  // Lifetime run count for a pin (0 if never run / after a reset).
  count(pinId: string): number {
    return this.read().counts[pinId] ?? 0;
  }

  // A copy of the lifetime per-pin run counts, keyed by pin id. Read by the run-
  // analytics summary to rank most-run pins and total runs. Copied so a caller
  // cannot mutate the stored data through the returned object.
  counts(): Record<string, number> {
    return { ...this.read().counts };
  }

  // Record a run. Gated on enabled() so a disabled user collects nothing. Moves
  // the pin to the front of recents, refreshes its timestamp, and increments its
  // lifetime count.
  async record(pinId: string, source: RunSource): Promise<void> {
    if (!this.context || !this.enabled()) {
      return;
    }
    const data = this.read();
    const at = Date.now();
    data.recent = [
      { pinId, at, source },
      ...data.recent.filter((r) => r.pinId !== pinId),
    ].slice(0, MAX_RECENT);
    data.counts[pinId] = (data.counts[pinId] ?? 0) + 1;
    await this.write(data);
    this._onDidChange.fire();
  }

  // Clear the entire local history (recents and counts). The user-facing reset.
  async reset(): Promise<void> {
    if (!this.context) {
      return;
    }
    await this.write({ recent: [], counts: {} });
    this._onDidChange.fire();
  }

  // Recent group open/closed posture, persisted so it stays the way the user left
  // it. Default expanded — quick access to last-run items is the point of it.
  recentExpanded(): boolean {
    return this.context?.globalState.get<boolean>(RECENT_EXPANDED_KEY, true) ?? true;
  }

  async setRecentExpanded(expanded: boolean): Promise<void> {
    await this.context?.globalState.update(RECENT_EXPANDED_KEY, expanded);
  }

  private read(): TelemetryData {
    const data = this.context?.globalState.get<TelemetryData>(KEY);
    return {
      recent: Array.isArray(data?.recent) ? data.recent : [],
      counts: data?.counts && typeof data.counts === "object" ? data.counts : {},
    };
  }

  private async write(data: TelemetryData): Promise<void> {
    await this.context?.globalState.update(KEY, data);
  }

  // One-time fold of the old bare-id recents list into the richer store. Synthetic
  // descending timestamps preserve the prior order; the legacy key is then dropped
  // so this runs at most once.
  private migrateLegacy(): void {
    const ctx = this.context;
    if (!ctx) {
      return;
    }
    const legacy = ctx.globalState.get<string[]>(LEGACY_RECENT_KEY);
    if (!Array.isArray(legacy) || legacy.length === 0) {
      return;
    }
    const existing = this.read();
    if (existing.recent.length === 0) {
      const now = Date.now();
      const counts: Record<string, number> = { ...existing.counts };
      const recent: RunRecord[] = legacy.slice(0, MAX_RECENT).map((pinId, i) => {
        counts[pinId] = (counts[pinId] ?? 0) + 1;
        return { pinId, at: now - i * 1000, source: "manual" as const };
      });
      void this.write({ recent, counts });
    }
    void ctx.globalState.update(LEGACY_RECENT_KEY, undefined);
  }
}

// Module-level singleton: the runner records, the palette and Recent group read.
export const telemetry = new Telemetry();
