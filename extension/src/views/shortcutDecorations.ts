import * as vscode from "vscode";
import { ShortcutStore } from "../model/shortcutStore";
import { shortcutBadges, formatBadgeDelta } from "../exec/shortcutBadges";
import { shortcutKind } from "../model/shortcut";

// Tints a file shortcut's tree-row label green (fewer issues) or red (more
// issues) based on the ▲/▼ delta between the current and previous sweep badge.
// Only file shortcuts participate: they carry a resourceUri that VS Code's
// FileDecorationProvider can match. Non-file shortcuts (shell/url/command)
// have no resourceUri, so no tint is possible without a custom URI scheme.
//
// The decoration is visible in every view that shows the same URI (Explorer,
// open editors, our tree). This is intentional: a file whose lint or test
// results are worsening is worth highlighting everywhere.

type DeltaDir = "improving" | "worsening";

// charts.green: a built-in VS Code chart color, stable since 1.50 (Oct 2020).
// errorForeground: the standard error text color across all themes. Both are
// core workbench tokens (not extension-contributed), so they resolve in every
// theme that ships with VS Code and in well-behaved third-party themes.
const COLOR_IMPROVING = new vscode.ThemeColor("charts.green");
const COLOR_WORSENING = new vscode.ThemeColor("errorForeground");

export class ShortcutDecorationProvider
  implements vscode.FileDecorationProvider
{
  private readonly _onDidChange =
    new vscode.EventEmitter<vscode.Uri | vscode.Uri[]>();
  readonly onDidChangeFileDecorations = this._onDidChange.event;

  private readonly deltaByUri = new Map<string, DeltaDir>();

  constructor(private readonly store: ShortcutStore) {}

  // Rebuild the URI → direction map from the current badge state and fire
  // change events so VS Code re-queries affected rows.
  refresh(): void {
    const prev = new Set(this.deltaByUri.keys());
    this.deltaByUri.clear();

    const shortcuts = [
      ...this.store.getProjectShortcuts(),
      ...this.store.getGlobalShortcuts(),
    ];

    const changed: vscode.Uri[] = [];

    for (const shortcut of shortcuts) {
      if (shortcutKind(shortcut) !== "file" || shortcut.masked) {
        continue;
      }
      const badge = shortcutBadges.get(shortcut.id);
      const previous = shortcutBadges.previous(shortcut.id);
      if (!badge || !previous) {
        continue;
      }
      const delta = formatBadgeDelta(badge, previous);
      if (!delta) {
        continue;
      }
      const uri = this.store.resolveUri(shortcut);
      if (!uri) {
        continue;
      }
      const key = uri.toString();
      const dir: DeltaDir = delta.startsWith("▼") ? "improving" : "worsening";
      this.deltaByUri.set(key, dir);
      prev.delete(key);
      changed.push(uri);
    }

    // URIs that had a decoration but no longer do — fire so VS Code clears them.
    for (const stale of prev) {
      changed.push(vscode.Uri.parse(stale));
    }

    if (changed.length > 0) {
      this._onDidChange.fire(changed);
    }
  }

  provideFileDecoration(
    uri: vscode.Uri
  ): vscode.FileDecoration | undefined {
    const dir = this.deltaByUri.get(uri.toString());
    if (!dir) {
      return undefined;
    }
    const decoration = new vscode.FileDecoration();
    decoration.color =
      dir === "improving" ? COLOR_IMPROVING : COLOR_WORSENING;
    return decoration;
  }

  dispose(): void {
    this._onDidChange.dispose();
  }
}
