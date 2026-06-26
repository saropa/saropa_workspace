import * as vscode from "vscode";

// Shared renderer for the hub-and-spoke config menus (Configure Schedule,
// Configure Triggers, Configure Boot Sequence). Each of those is a list the user
// returns to after every edit; rendering it with a fresh one-shot
// `showQuickPick` per iteration reopened the menu scrolled to the top and dropped
// keyboard focus, so editing a field or flipping a toggle felt like the menu was
// looping back to the start and a toggle's change looked like it had not taken.
//
// This renders the menu with a persistent `createQuickPick` instead:
//   - `active` restores focus to the row the caller last acted on, so the
//     selection stays put across re-renders;
//   - `ignoreFocusOut` keeps the menu up when focus shifts (a notification, a
//     stray click), so only Esc discards.
//
// Resolves with the chosen item, or undefined when the user pressed Esc / the
// menu was hidden without an accept. Separators may sit in `items` (they are
// non-selectable, so they never come back as the result).
export function showHubQuickPick<T extends vscode.QuickPickItem>(
  items: readonly T[],
  options: { title: string; placeholder: string; active?: T }
): Promise<T | undefined> {
  return new Promise<T | undefined>((resolve) => {
    const qp = vscode.window.createQuickPick<T>();
    qp.title = options.title;
    qp.placeholder = options.placeholder;
    qp.items = items as T[];
    qp.ignoreFocusOut = true;
    if (options.active) {
      qp.activeItems = [options.active];
    }
    // Tell an accept apart from a plain hide so onDidHide only discards when the
    // user actually backed out, never after a row was chosen.
    let accepted = false;
    qp.onDidAccept(() => {
      accepted = true;
      const picked = qp.selectedItems[0];
      qp.hide();
      resolve(picked);
    });
    qp.onDidHide(() => {
      qp.dispose();
      if (!accepted) {
        resolve(undefined);
      }
    });
    qp.show();
  });
}
