import * as vscode from "vscode";
import * as path from "path";
import { ShortcutStore } from "../model/shortcutStore";
import { l10n } from "../i18n/l10n";

// Roadmap 7.3 — Smart shortcut suggestions.
//
// Keep an on-device frequency count of the files the user opens; when a file the
// user has not added as a shortcut crosses a threshold, offer a one-tap "Add
// shortcut?" toast. The offer is gated once per file (added / dismissed) so it
// never reappears unsolicited. Counts live in globalState and are never
// transmitted (no telemetry — see the roadmap Principles).
//
// Two refinements exist so ordinary development flipping between files does not
// nag (BUG_REPEATED_OPENED_ANNOYING):
//   1. Debounce — during development a file is re-focused constantly (search, go
//      to definition, tab flipping). Each of those is a separate active-editor
//      change, so counting every one inflated the tally to the threshold in a
//      single session. A per-file cooldown collapses a burst of re-focus into at
//      most one count, so the count tracks distinct working sessions, not focus
//      churn.
//   2. Ignore-by-extension — some file types (e.g. .dart during a build/debug
//      loop) are opened often but are never shortcut candidates. The user can
//      suppress a whole extension from the prompt itself ("Ignore .dart"), which
//      writes the extension to the shared `suggestions.ignoreExtensions` setting.

const STATE_KEY = "saropaWorkspace.suggestions.state";
// Cap the handled list so it cannot grow without bound across a long-lived
// profile; the oldest handled paths fall off (re-offering them is acceptable —
// the user opened them enough to be worth a second ask much later).
const MAX_HANDLED = 500;

// The persisted globalState record for this suggester.
export interface SuggestState {
  // fsPath -> number of counted activations since it was last resolved.
  counts: Record<string, number>;
  // fsPath -> epoch-ms of the last COUNTED activation, for the debounce cooldown
  // (constraint 1 in the file header). A re-focus inside the window is ignored.
  lastCountedAt: Record<string, number>;
  // fsPaths the user has resolved (added or dismissed); never offered again
  // while present.
  handled: string[];
}

// The settings the pure decision core reads, resolved from configuration by the
// caller so the core stays host-free and unit-testable.
export interface SuggestConfig {
  // Counted activations required before offering (suggestions.openThreshold).
  threshold: number;
  // Cooldown in ms between two counted activations of the same file (debounce).
  debounceMs: number;
  // Extensions (normalized, leading-dot, lowercase) never counted or offered.
  ignoreExtensions: ReadonlySet<string>;
}

// The result of evaluating one active-editor change: the next state to persist,
// whether it changed (skip a redundant write), whether to offer now, and the
// count to show in the prompt.
export interface OpenEvaluation {
  state: SuggestState;
  changed: boolean;
  offer: boolean;
  count: number;
}

// Normalize a raw extension (from path.extname or user config) to a single
// leading dot, lowercase — so ".Dart", "dart", and ".dart" all compare equal.
// Returns "" for input with no actual extension text so callers can skip it.
export function normalizeExtension(raw: string): string {
  const bare = raw.replace(/^\.+/, "").toLowerCase();
  return bare.length === 0 ? "" : `.${bare}`;
}

// Pure decision core, extracted so the debounce / ignore / threshold logic is
// unit-testable without the VS Code host. Given the stored state and one file's
// activation, it returns the next state plus whether to offer. The input state is
// not mutated; a fresh state object is returned.
//
//   - a resolved (handled) file is left untouched and never offered;
//   - an ignored extension is left untouched and never offered (not marked
//     handled, so lifting the ignore restores normal counting);
//   - a file already a Saropa shortcut is marked handled (its count dropped);
//   - a re-focus within the debounce window of the last counted activation is
//     ignored (no count inflation);
//   - otherwise the count increments, the cooldown stamp updates, and the file is
//     offered once the count reaches the threshold.
export function evaluateOpen(
  state: SuggestState,
  fsPath: string,
  isAlreadyShortcut: boolean,
  cfg: SuggestConfig,
  now: number
): OpenEvaluation {
  const unchanged: OpenEvaluation = { state, changed: false, offer: false, count: 0 };

  if (state.handled.includes(fsPath)) {
    return unchanged;
  }

  const ext = normalizeExtension(path.extname(fsPath));
  if (ext.length > 0 && cfg.ignoreExtensions.has(ext)) {
    return unchanged;
  }

  const counts = { ...state.counts };
  const lastCountedAt = { ...state.lastCountedAt };

  // Already a shortcut (any scope, including auto): nothing to suggest. Mark it
  // handled so it is not re-counted every time it gains focus.
  if (isAlreadyShortcut) {
    delete counts[fsPath];
    delete lastCountedAt[fsPath];
    const handled = appendHandled(state.handled, fsPath);
    return { state: { counts, lastCountedAt, handled }, changed: true, offer: false, count: 0 };
  }

  // Debounce: a re-focus within the cooldown of the last counted activation is
  // focus churn, not a new working session — do not inflate the count.
  const last = lastCountedAt[fsPath];
  if (last !== undefined && now - last < cfg.debounceMs) {
    return unchanged;
  }

  const count = (counts[fsPath] ?? 0) + 1;
  counts[fsPath] = count;
  lastCountedAt[fsPath] = now;

  return {
    state: { counts, lastCountedAt, handled: state.handled },
    changed: true,
    offer: count >= cfg.threshold,
    count,
  };
}

// Append fsPath to the handled list (dropping the oldest past the cap) without
// mutating the input array.
function appendHandled(handled: readonly string[], fsPath: string): string[] {
  if (handled.includes(fsPath)) {
    return [...handled];
  }
  const next = [...handled, fsPath];
  return next.length > MAX_HANDLED ? next.slice(-MAX_HANDLED) : next;
}

// Path fragments that are never worth suggesting: dependency trees, VCS
// internals, and the extension's own shortcut/favorites files.
const NOISE = [
  `${path.sep}node_modules${path.sep}`,
  `${path.sep}.git${path.sep}`,
  `${path.sep}.vscode${path.sep}saropa-workspace.json`,
  `.favorites.json`,
];

// Wires the active-editor-change listener and owns the per-file open counts and
// handled list described above. One instance lives for the extension's lifetime;
// dispose() tears down the listener on deactivate.
export class SuggestionTracker {
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly store: ShortcutStore
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

  private config(): SuggestConfig {
    const cfg = vscode.workspace.getConfiguration("saropaWorkspace");
    const ignore = cfg.get<string[]>("suggestions.ignoreExtensions", []);
    return {
      threshold: cfg.get<number>("suggestions.openThreshold", 10),
      debounceMs: cfg.get<number>("suggestions.debounceMinutes", 30) * 60 * 1000,
      ignoreExtensions: new Set(
        ignore.map(normalizeExtension).filter((ext) => ext.length > 0)
      ),
    };
  }

  private async onActivate(uri: vscode.Uri): Promise<void> {
    if (!this.enabled() || uri.scheme !== "file") {
      return;
    }
    const fsPath = uri.fsPath;
    if (NOISE.some((fragment) => fsPath.includes(fragment))) {
      return;
    }

    const result = evaluateOpen(
      this.readState(),
      fsPath,
      this.isShortcut(uri),
      this.config(),
      Date.now()
    );
    if (result.changed) {
      await this.writeState(result.state);
    }
    if (result.offer) {
      await this.offer(uri, result.count);
    }
  }

  // Offer to add the frequently-opened file as a shortcut. The shortcut goes to the
  // project scope when the file is inside a workspace folder (shareable via the
  // repo), otherwise global. Any choice (add, ignore, or dismiss) marks the file
  // handled so the prompt never nags.
  private async offer(uri: vscode.Uri, count: number): Promise<void> {
    const name = path.basename(uri.fsPath);
    const ext = normalizeExtension(path.extname(uri.fsPath));

    const addAction = l10n("suggest.pin");
    const dismissAction = l10n("suggest.never");
    // Only offer the extension-wide suppression when the file has one.
    const ignoreAction = ext.length > 0 ? l10n("suggest.ignoreType", { ext }) : undefined;
    const actions = ignoreAction
      ? [addAction, ignoreAction, dismissAction]
      : [addAction, dismissAction];

    const choice = await vscode.window.showInformationMessage(
      l10n("suggest.prompt", { name, count }),
      ...actions
    );

    const state = this.readState();
    this.markHandled(state, uri.fsPath);
    await this.writeState(state);

    if (choice === addAction) {
      const inWorkspace = vscode.workspace.getWorkspaceFolder(uri) !== undefined;
      const added = await this.store.addShortcut(uri, inWorkspace ? "project" : "global");
      vscode.window.showInformationMessage(
        added ? l10n("pin.added", { name }) : l10n("pin.alreadyPinned", { name })
      );
      return;
    }

    if (choice === ignoreAction && ext.length > 0) {
      await this.addIgnoredExtension(ext);
      vscode.window.showInformationMessage(l10n("suggest.ignored", { ext }));
    }
  }

  // Add an extension to the shared ignore list so files of that type are never
  // counted or offered again. Written to the global (user) target because a noisy
  // extension (.dart, .g.dart) is language-wide, not tied to one workspace.
  private async addIgnoredExtension(ext: string): Promise<void> {
    const config = vscode.workspace.getConfiguration("saropaWorkspace");
    const current = config.get<string[]>("suggestions.ignoreExtensions", []);
    if (current.some((entry) => normalizeExtension(entry) === ext)) {
      return;
    }
    await config.update(
      "suggestions.ignoreExtensions",
      [...current, ext],
      vscode.ConfigurationTarget.Global
    );
  }

  private isShortcut(uri: vscode.Uri): boolean {
    return (
      this.store.findShortcutByUri(uri, "project") !== undefined ||
      this.store.findShortcutByUri(uri, "global") !== undefined
    );
  }

  private markHandled(state: SuggestState, fsPath: string): void {
    delete state.counts[fsPath];
    delete state.lastCountedAt[fsPath];
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
      lastCountedAt: stored?.lastCountedAt ?? {},
      handled: Array.isArray(stored?.handled) ? stored.handled : [],
    };
  }

  private async writeState(state: SuggestState): Promise<void> {
    await this.context.globalState.update(STATE_KEY, state);
  }
}
