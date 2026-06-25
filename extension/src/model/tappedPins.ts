import * as vscode from "vscode";

const KEY = "saropaWorkspace.tappedPins";

// Tracks which pins the user has interacted with — "tapped" means opened (single
// click) or run (double click / play). Drives the activity-bar badge, which shows
// the count of pins NOT yet tapped as a discovery cue for pins added but never
// used (see PinBadge wiring in extension.ts).
//
// Persisted in globalState (rides VS Code Settings Sync like the global pins), so
// a pin tapped in one session stays tapped in the next and the badge does not
// re-appear on every launch.
//
// Deliberately separate from `telemetry`: telemetry records RUNS only and is
// opt-out via saropaWorkspace.telemetry.enabled; the tapped set also counts plain
// opens and must keep working regardless of that toggle, because the badge is a
// navigation aid, not analytics.
class TappedPins {
  // Set by activate(); until then every method is an inert no-op, so importing the
  // singleton at module load (e.g. in pinCommands) is safe before activation.
  private context: vscode.ExtensionContext | undefined;

  private readonly _onDidChange = new vscode.EventEmitter<void>();
  // Fires when a pin is newly tapped, so the badge repaints.
  readonly onDidChange = this._onDidChange.event;

  init(context: vscode.ExtensionContext): void {
    this.context = context;
  }

  has(pinId: string): boolean {
    return this.read().includes(pinId);
  }

  // Mark a pin tapped. Idempotent: a no-op (and no event) when the pin is already
  // tapped, so re-opening or re-running a pin does not thrash the badge.
  async mark(pinId: string): Promise<void> {
    if (!this.context) {
      return;
    }
    const tapped = this.read();
    if (tapped.includes(pinId)) {
      return;
    }
    await this.context.globalState.update(KEY, [...tapped, pinId]);
    this._onDidChange.fire();
  }

  private read(): string[] {
    const data = this.context?.globalState.get<string[]>(KEY, []);
    return Array.isArray(data) ? data : [];
  }
}

// Module-level singleton: the open/run commands mark, the badge reads.
export const tappedPins = new TappedPins();
