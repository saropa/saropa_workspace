import * as vscode from "vscode";

// In-process completion bus for pin runs (the load-bearing primitive for recipe
// chaining). The runner fires one event when a run finishes (or, for an untracked
// run, when it is dispatched); the ChainRunner subscribes and fans out to the
// dependent pins. Deliberately tiny and VS-Code-only-by-EventEmitter so it has no
// store or runner import — both of those import IT, not the other way around, which
// keeps the dependency arrows one-directional (runner -> bus <- chainRunner).
//
// "dispatched" is the outcome for a run VS Code cannot follow to an exit code (an
// integrated-terminal, external-window, url, command, or macro run). The chain
// engine treats it as a success for triggering purposes, because there is no failure
// signal to gate on; only a tracked BACKGROUND/report run yields a real
// success/failure. This is documented where triggers are configured.
export type PinRunOutcome = "success" | "failure" | "dispatched";

export interface PinCompletion {
  pinId: string;
  outcome: PinRunOutcome;
}

class PinEventBus {
  private readonly _onDidComplete = new vscode.EventEmitter<PinCompletion>();

  // Fires after any pin run reaches a terminal state (real exit or dispatch).
  readonly onDidComplete = this._onDidComplete.event;

  fireComplete(pinId: string, outcome: PinRunOutcome): void {
    this._onDidComplete.fire({ pinId, outcome });
  }
}

// Module-level singleton: the runner records completions, the ChainRunner reads them.
export const pinEvents = new PinEventBus();
