import * as vscode from "vscode";

const KEY = "saropaWorkspace.tappedPins";

// Tracks which shortcuts the user has interacted with — "tapped" means opened (single
// click) or run (double click / play). Drives the per-row "untapped" dot, a discovery
// cue marking shortcuts added but never used (see shortcutTreeItem.ts).
//
// Persisted in globalState (rides VS Code Settings Sync like the global shortcuts), so
// a shortcut tapped in one session stays tapped in the next and the dot does not
// re-appear on every launch.
//
// Deliberately separate from `telemetry`: telemetry records RUNS only and is
// opt-out via saropaWorkspace.telemetry.enabled; the tapped set also counts plain
// opens and must keep working regardless of that toggle, because the badge is a
// navigation aid, not analytics.
class TappedShortcuts {
  // Set by activate(); until then every method is an inert no-op, so importing the
  // singleton at module load (e.g. in shortcutCommands) is safe before activation.
  private context: vscode.ExtensionContext | undefined;

  private readonly _onDidChange = new vscode.EventEmitter<void>();
  // Fires when a shortcut is newly tapped, so the badge repaints.
  readonly onDidChange = this._onDidChange.event;

  init(context: vscode.ExtensionContext): void {
    this.context = context;
  }

  has(shortcutId: string): boolean {
    return this.read().includes(shortcutId);
  }

  // Mark a shortcut tapped. Idempotent: a no-op (and no event) when the shortcut is
  // already tapped, so re-opening or re-running a shortcut does not thrash the badge.
  async mark(shortcutId: string): Promise<void> {
    if (!this.context) {
      return;
    }
    const tapped = this.read();
    if (tapped.includes(shortcutId)) {
      return;
    }
    await this.context.globalState.update(KEY, [...tapped, shortcutId]);
    this._onDidChange.fire();
  }

  private read(): string[] {
    const data = this.context?.globalState.get<string[]>(KEY, []);
    return Array.isArray(data) ? data : [];
  }
}

// Module-level singleton: the open/run commands mark, the badge reads.
export const tappedShortcuts = new TappedShortcuts();
