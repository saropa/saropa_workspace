import * as vscode from "vscode";

// Recency / frequency tracking for adb catalog runs (MOBILE_REMOTE_CONTROL_PLAN section
// 3, "recently/frequently used commands surface first"). Deliberately the SAME shape as
// exec/telemetry.ts — a most-recent-first, de-duplicated, bounded list plus a lifetime
// per-id count, persisted in globalState and never transmitted — so the two read and
// behave identically to a user and to a maintainer.
//
// It is a SEPARATE store rather than a second kind of record inside telemetry.ts for one
// concrete reason: every consumer of telemetry keys its records back to a live Shortcut
// (the Recent tree group resolves store.findShortcut and drops what it cannot find; the
// analytics summary renders an unresolvable id as "Unknown shortcut"). A catalog entry id
// is not a shortcut id and never resolves, so folding adb runs into that store would both
// push real shortcuts out of a 20-entry Recent list and print "Unknown shortcut" rows in
// the analytics report. Pinning a command to the Shortcuts tree (which DOES create a real
// shortcut) is the supported bridge between the two.
//
// Keyed by AdbCommandEntry.id, which the catalog documents as an API: renaming an entry
// resets its ranking, exactly as renaming it orphans a user's pin.
//
// Honors the same saropaWorkspace.telemetry.enabled opt-out as shortcut telemetry — a
// user who turned run history off gets no adb history either, and the panel then shows
// the catalog in its declared order with no Recent group.

const KEY = "saropaWorkspace.adbRunHistory";
const MAX_RECENT = 12;

/** One recorded adb catalog run. `at` is epoch ms. */
export interface AdbRunRecord {
  commandId: string;
  at: number;
}

interface AdbHistoryData {
  // Most-recent-first, de-duplicated by commandId.
  recent: AdbRunRecord[];
  // Lifetime run count per commandId; survives eviction from `recent`, so "frequent"
  // is a true total rather than "within the last dozen runs".
  counts: Record<string, number>;
}

class AdbRunHistory {
  // Set by activate(); until then every method is an inert no-op, so importing the
  // singleton at module load is safe before activation (same contract as telemetry).
  private context: vscode.ExtensionContext | undefined;

  private readonly _onDidChange = new vscode.EventEmitter<void>();
  /** Fires when a run is recorded or the history is reset, so an open panel can repaint. */
  readonly onDidChange = this._onDidChange.event;

  init(context: vscode.ExtensionContext): void {
    this.context = context;
  }

  enabled(): boolean {
    return vscode.workspace
      .getConfiguration("saropaWorkspace")
      .get<boolean>("telemetry.enabled", true);
  }

  /** Catalog entry ids, most-recently-run first. Empty when collection is off. */
  recent(): string[] {
    return this.enabled() ? this.read().recent.map((r) => r.commandId) : [];
  }

  /** A copy of the lifetime run counts, keyed by catalog entry id. */
  counts(): Record<string, number> {
    return this.enabled() ? { ...this.read().counts } : {};
  }

  /** Lifetime run count for one catalog entry (0 when never run or collection is off). */
  count(commandId: string): number {
    return this.counts()[commandId] ?? 0;
  }

  /** Record a run: move the entry to the front of recents and bump its lifetime count. */
  async record(commandId: string): Promise<void> {
    if (!this.context || !this.enabled()) {
      return;
    }
    const data = this.read();
    data.recent = [
      { commandId, at: Date.now() },
      ...data.recent.filter((r) => r.commandId !== commandId),
    ].slice(0, MAX_RECENT);
    data.counts[commandId] = (data.counts[commandId] ?? 0) + 1;
    await this.write(data);
    this._onDidChange.fire();
  }

  /** Clear the whole adb run history. */
  async reset(): Promise<void> {
    if (!this.context) {
      return;
    }
    await this.write({ recent: [], counts: {} });
    this._onDidChange.fire();
  }

  private read(): AdbHistoryData {
    const data = this.context?.globalState.get<AdbHistoryData>(KEY);
    return {
      recent: Array.isArray(data?.recent) ? data.recent : [],
      counts: data?.counts && typeof data.counts === "object" ? data.counts : {},
    };
  }

  private async write(data: AdbHistoryData): Promise<void> {
    await this.context?.globalState.update(KEY, data);
  }
}

/** Module-level singleton: the panel's run action records, its payload builder reads. */
export const adbRunHistory = new AdbRunHistory();
