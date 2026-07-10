import * as vscode from "vscode";
import { DEFAULT_SET_NAME } from "../model/shortcut";
import { ShortcutStore } from "../model/shortcutStore";
import { l10n } from "../i18n/l10n";

// Multiple-favorite-sets roadmap — a status-bar item showing the active shortcut
// set's name. Clicking it opens the switcher QuickPick (switch / new / rename /
// delete / duplicate). It stays hidden while the workspace is on a single set named
// "Default" (the migrated/first-run state), so existing single-set users see no
// new chrome until they opt into sets — the "single-set behavior is unchanged"
// guarantee. It appears once a second set exists or the sole set has been renamed,
// and hides entirely when no workspace folder is open (sets are a project concept).

export class SetStatusBar {
  private readonly item: vscode.StatusBarItem;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly store: ShortcutStore) {
    // Left-aligned, low priority: this is workspace context, not a transient
    // notification, so it sits with the other workspace indicators on the left.
    this.item = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      0
    );
    // Names the entry in VS Code's own right-click "Hide" menu; without it both of
    // this extension's status-bar entries read as the extension's display name and a
    // user cannot tell which one they are hiding.
    this.item.name = l10n("pinSet.statusBarName");
    this.item.command = "saropaWorkspace.switchPinSet";

    this.disposables.push(this.store.onDidChange(() => this.recompute()));
    this.recompute();
  }

  private recompute(): void {
    const hasFolder = (vscode.workspace.workspaceFolders?.length ?? 0) > 0;
    const names = this.store.getSetNames();
    const active = this.store.getActiveSetName();

    // Hide until the user has actually engaged with sets: no folder, or the lone
    // default set untouched. Showing it always would add permanent chrome for
    // users who never use the feature.
    const onlyDefault = names.length <= 1 && active === DEFAULT_SET_NAME;
    if (!hasFolder || onlyDefault) {
      this.item.hide();
      return;
    }

    this.item.text = l10n("pinSet.statusBar", { name: active });
    this.item.tooltip = l10n("pinSet.statusBarTooltip", {
      name: active,
      count: names.length,
    });
    this.item.show();
  }

  dispose(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
    this.item.dispose();
  }
}
