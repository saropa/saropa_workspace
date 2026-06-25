import * as vscode from "vscode";
import * as path from "path";
import { PinStore } from "../model/pinStore";
import { l10n } from "../i18n/l10n";

// Roadmap 7.3 — Smart pin suggestions.
//
// Keep an on-device frequency count of the files the user opens; when a file the
// user has not pinned crosses a threshold, offer a one-tap "Pin this?" toast. The
// offer is gated once per file (pinned / dismissed) so it never reappears
// unsolicited. Counts live in globalState and are never transmitted (no
// telemetry — see the roadmap Principles).

const STATE_KEY = "saropaWorkspace.suggestions.state";
// Cap the handled list so it cannot grow without bound across a long-lived
// profile; the oldest handled paths fall off (re-offering them is acceptable —
// the user opened them enough to be worth a second ask much later).
const MAX_HANDLED = 500;

interface SuggestState {
  // fsPath -> number of activations since it was last counted.
  counts: Record<string, number>;
  // fsPaths the user has resolved (pinned or dismissed); never offered again
  // while present.
  handled: string[];
}

// Path fragments that are never worth suggesting: dependency trees, VCS
// internals, and the extension's own pin/favorites files.
const NOISE = [
  `${path.sep}node_modules${path.sep}`,
  `${path.sep}.git${path.sep}`,
  `${path.sep}.vscode${path.sep}saropa-workspace.json`,
  `.favorites.json`,
];

export class SuggestionTracker {
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly store: PinStore
  ) {
    // Count on active-editor changes: a focus into a file is the strongest
    // "the user works with this" signal available without heavier tracking.
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor) {
          void this.onActivate(editor.document.uri);
        }
      })
    );
  }

  dispose(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
  }

  private enabled(): boolean {
    return vscode.workspace
      .getConfiguration("saropaWorkspace")
      .get<boolean>("suggestions.enabled", true);
  }

  private threshold(): number {
    return vscode.workspace
      .getConfiguration("saropaWorkspace")
      .get<number>("suggestions.openThreshold", 6);
  }

  private async onActivate(uri: vscode.Uri): Promise<void> {
    if (!this.enabled() || uri.scheme !== "file") {
      return;
    }
    const fsPath = uri.fsPath;
    if (NOISE.some((fragment) => fsPath.includes(fragment))) {
      return;
    }

    const state = this.readState();
    if (state.handled.includes(fsPath)) {
      return;
    }
    // Already pinned (any scope, including auto): nothing to suggest. Mark it
    // handled so it is not re-counted every time it gains focus.
    if (this.isPinned(uri)) {
      this.markHandled(state, fsPath);
      await this.writeState(state);
      return;
    }

    state.counts[fsPath] = (state.counts[fsPath] ?? 0) + 1;
    const crossed = state.counts[fsPath] >= this.threshold();
    await this.writeState(state);

    if (crossed) {
      await this.offer(uri, state.counts[fsPath]);
    }
  }

  // Offer to pin the frequently-opened file. Pin goes to the project scope when
  // the file is inside a workspace folder (shareable via the repo), otherwise
  // global. Either choice (pin or dismiss) marks the file handled so the prompt
  // never nags.
  private async offer(uri: vscode.Uri, count: number): Promise<void> {
    const name = path.basename(uri.fsPath);
    const pinAction = l10n("suggest.pin");
    const dismissAction = l10n("suggest.never");
    const choice = await vscode.window.showInformationMessage(
      l10n("suggest.prompt", { name, count }),
      pinAction,
      dismissAction
    );

    const state = this.readState();
    this.markHandled(state, uri.fsPath);
    await this.writeState(state);

    if (choice === pinAction) {
      const inWorkspace = vscode.workspace.getWorkspaceFolder(uri) !== undefined;
      const added = await this.store.addPin(uri, inWorkspace ? "project" : "global");
      vscode.window.showInformationMessage(
        added ? l10n("pin.added", { name }) : l10n("pin.alreadyPinned", { name })
      );
    }
  }

  private isPinned(uri: vscode.Uri): boolean {
    return (
      this.store.findPinByUri(uri, "project") !== undefined ||
      this.store.findPinByUri(uri, "global") !== undefined
    );
  }

  private markHandled(state: SuggestState, fsPath: string): void {
    delete state.counts[fsPath];
    if (!state.handled.includes(fsPath)) {
      state.handled.push(fsPath);
      if (state.handled.length > MAX_HANDLED) {
        state.handled = state.handled.slice(-MAX_HANDLED);
      }
    }
  }

  private readState(): SuggestState {
    const stored = this.context.globalState.get<SuggestState>(STATE_KEY);
    return {
      counts: stored?.counts ?? {},
      handled: Array.isArray(stored?.handled) ? stored.handled : [],
    };
  }

  private async writeState(state: SuggestState): Promise<void> {
    await this.context.globalState.update(STATE_KEY, state);
  }
}
