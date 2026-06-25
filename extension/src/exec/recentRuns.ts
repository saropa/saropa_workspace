import * as vscode from "vscode";

// Roadmap 4.1 — a bounded, persisted list of recently-run pin ids, most-recent
// first, so the "Run Pin..." palette can surface frequent runs at the top.
//
// On-device only: stored in extension globalState (rides Settings Sync like the
// global pins), never transmitted — no telemetry. Bounded so it cannot grow
// without limit; recording an id moves it to the front and de-duplicates.

const RECENT_KEY = "saropaWorkspace.recentRuns";
const MAX_RECENT = 12;

class RecentRuns {
  // Set by activate(); until then record/list are inert no-ops, so importing the
  // singleton at module load (e.g. in the runner) is safe before activation.
  private context: vscode.ExtensionContext | undefined;

  init(context: vscode.ExtensionContext): void {
    this.context = context;
  }

  // Most-recent-first list of pin ids. The caller filters out ids that no longer
  // resolve to a live pin (an unpinned or deleted file).
  list(): string[] {
    return this.context?.globalState.get<string[]>(RECENT_KEY, []) ?? [];
  }

  // Move a pin id to the front, de-duplicating, and cap the list length.
  async record(pinId: string): Promise<void> {
    if (!this.context) {
      return;
    }
    const next = [pinId, ...this.list().filter((id) => id !== pinId)].slice(
      0,
      MAX_RECENT
    );
    await this.context.globalState.update(RECENT_KEY, next);
  }
}

// Module-level singleton: the runner records, the palette reads.
export const recentRuns = new RecentRuns();
