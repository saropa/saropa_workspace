import * as vscode from "vscode";
import { ShortcutStore } from "../model/shortcutStore";
import { ShortcutsTreeProvider } from "../views/shortcutsTreeProvider";
import { ShortcutTreeItem } from "../views/shortcutTreeItem";
import { ScheduleStatusBar } from "../views/scheduleStatusBar";
import { SetStatusBar } from "../views/setStatusBar";

// Activation wiring block split out of extension.ts (and, before that, out of
// wiring.ts once that file itself grew past the project's line-count cap) so
// activate() stays a short, readable sequence of named steps.

// The schedule + set status-bar items and the reveal/peek commands that need the
// tree-view handle.
export function setupStatusBars(
  context: vscode.ExtensionContext,
  store: ShortcutStore,
  tree: ShortcutsTreeProvider,
  treeView: vscode.TreeView<vscode.TreeItem>
): void {
  // Status-bar item for the soonest upcoming scheduled run; clicking it reveals
  // the shortcut in the tree. The reveal command lives here because it needs the tree
  // view handle created above.
  const scheduleStatusBar = new ScheduleStatusBar(store);
  context.subscriptions.push(scheduleStatusBar);

  // Status-bar shortcut-set switcher: shows the active set's name and opens the
  // switcher QuickPick on click. Hidden while the workspace is on the lone default
  // set, so single-set users see no new chrome until they create a second set.
  // Disposable so its status-bar item and store subscription are released on
  // deactivation.
  context.subscriptions.push(new SetStatusBar(store));
  context.subscriptions.push(
    vscode.commands.registerCommand("saropaWorkspace.revealNextScheduled", async () => {
      const id = scheduleStatusBar.getCurrentShortcutId();
      const shortcut = id ? store.findShortcut(id) : undefined;
      if (!shortcut) {
        return;
      }
      await treeView.reveal(tree.revealItem(shortcut), {
        select: true,
        focus: true,
        expand: true,
      });
    })
  );

  // Keyboard peek: peek the file shortcut currently selected in the Shortcuts view. A
  // keybinding cannot receive the focused tree item as an argument, so the command
  // reads the view's selection here (where the tree view handle lives) and delegates
  // to the shared peekShortcut command. No-op when nothing (or a non-shortcut row) is
  // selected.
  context.subscriptions.push(
    vscode.commands.registerCommand("saropaWorkspace.peekFocusedPin", () => {
      const selected = treeView.selection.find(
        (item) => item instanceof ShortcutTreeItem
      );
      if (selected instanceof ShortcutTreeItem) {
        void vscode.commands.executeCommand("saropaWorkspace.peekPin", selected.shortcut);
      }
    })
  );
}
