import * as vscode from "vscode";

// Tracks the LAST completed result of a background run per pin so the tree can
// show a success / failure badge and duration (roadmap 7.2). Deliberately
// in-memory and per-session: it is never persisted to disk and never leaves the
// machine (no telemetry). It clears on reload, which is the intended behavior —
// a run result is only meaningful for the session that produced it.
//
// Only BACKGROUND runs are tracked: they spawn a child process whose exit code
// and lifetime we observe directly. Integrated-terminal runs are interactive and
// owned by the terminal; at this extension's minimum VS Code version there is no
// shell-integration API to read their exit code, so they do not update status.

export type RunOutcome = "success" | "failure";

export interface RunResult {
  outcome: RunOutcome;
  // Process exit code; null when the process was terminated by a signal or never
  // produced a code (e.g. a spawn error).
  exitCode: number | null;
  durationMs: number;
  endedAt: number;
}

class RunStatusRegistry {
  private readonly last = new Map<string, RunResult>();
  private readonly _onDidChange = new vscode.EventEmitter<void>();

  // Fires when a result is recorded or cleared, so the tree can repaint.
  readonly onDidChange = this._onDidChange.event;

  record(pinId: string, result: RunResult): void {
    this.last.set(pinId, result);
    this._onDidChange.fire();
  }

  get(pinId: string): RunResult | undefined {
    return this.last.get(pinId);
  }

  // Snapshot of every recorded result this session, keyed by pin id. Read by the
  // run-analytics summary to show the session's success / failure split. Returns a
  // copied array so a caller cannot mutate the registry's backing map.
  entries(): Array<[string, RunResult]> {
    return [...this.last.entries()];
  }

  // Drop a pin's result, e.g. when the pin is removed so a stale badge does not
  // outlive it.
  clear(pinId: string): void {
    if (this.last.delete(pinId)) {
      this._onDidChange.fire();
    }
  }
}

// Module-level singleton: the runner records results, the tree reads them.
export const runStatusRegistry = new RunStatusRegistry();

// Compact, human-readable duration for the tree badge and the output log. Sub-
// second runs read in ms; under a minute as one decimal of seconds; longer runs
// as minutes and zero-padded seconds.
export function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  const seconds = ms / 1000;
  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`;
  }
  const wholeMinutes = Math.floor(seconds / 60);
  const remSeconds = Math.round(seconds % 60);
  return `${wholeMinutes}m ${String(remSeconds).padStart(2, "0")}s`;
}
