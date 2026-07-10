import * as vscode from "vscode";
import { ShortcutStore } from "../model/shortcutStore";
import { Shortcut, shortcutKind } from "../model/shortcut";
import { l10n } from "../i18n/l10n";
import { openShortcut } from "./shortcutOpen";

// Tail-follow log shortcuts (WOW #5): keep a followed document's view pinned to its
// newest line as it grows, and the toggle command that turns this on/off for a file
// shortcut. Split out of shortcutInteraction.ts.

// URIs currently followed `tail -f`-style, keyed by uri string. A single shared
// document-change listener (registered once via registerTailFollow) keeps every
// followed doc scrolled to its newest line; a close listener drops the entry so a
// closed tab leaves nothing behind. In-memory only: a follow lives for one tab's
// lifetime and is re-armed from shortcut.tailFollow each time the shortcut is opened.
const followedDocs = new Set<string>();

// Begin following a freshly-opened editor: jump to the end now and remember the
// document so the shared change listener re-pins it to the tail on every append.
export function startTailFollow(editor: vscode.TextEditor): void {
  followedDocs.add(editor.document.uri.toString());
  revealDocEnd(editor);
}

// Scroll an editor to its final line (the tail). Used on open and on every append.
// A no-op on an empty document, where there is no last line to reveal.
function revealDocEnd(editor: vscode.TextEditor): void {
  const lastLine = editor.document.lineCount - 1;
  if (lastLine < 0) {
    return;
  }
  const end = editor.document.lineAt(lastLine).range.end;
  editor.revealRange(
    new vscode.Range(end, end),
    vscode.TextEditorRevealType.Default
  );
}

// Wire the two listeners that drive tail-follow, once. Both are pushed to
// subscriptions so they dispose on deactivate.
export function registerTailFollow(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    // A followed file grew (or changed) on disk: re-pin every visible editor
    // showing it to its newest line, so split views all track the tail like a
    // terminal would in each pane.
    vscode.workspace.onDidChangeTextDocument((event) => {
      const key = event.document.uri.toString();
      if (!followedDocs.has(key)) {
        return;
      }
      for (const editor of vscode.window.visibleTextEditors) {
        if (editor.document.uri.toString() === key) {
          revealDocEnd(editor);
        }
      }
    }),
    // The tab closed: stop following so the set never accumulates dead entries (a
    // stale follow would yank an unrelated reopened file to its end).
    vscode.workspace.onDidCloseTextDocument((doc) => {
      followedDocs.delete(doc.uri.toString());
    })
  );
}

// Toggle tail-follow on a file shortcut (WOW #5). Persists the flag so it sticks across
// sessions; on enable, offers to open the file now so the follow takes effect
// immediately rather than only on the next open. On disable, drops any live follow
// on the shortcut's file so the current tab stops auto-scrolling at once.
export async function toggleTail(store: ShortcutStore, shortcut: Shortcut): Promise<void> {
  const name = shortcut.label ?? (shortcut.path.split("/").pop() ?? shortcut.path);
  if (shortcutKind(shortcut) !== "file") {
    vscode.window.showWarningMessage(l10n("tail.fileOnly", { name }));
    return;
  }
  const next = !shortcut.tailFollow;
  await store.setShortcutTail(shortcut, next);
  if (next) {
    const openNow = l10n("tail.openNow");
    const choice = await vscode.window.showInformationMessage(
      l10n("tail.enabled", { name }),
      openNow
    );
    if (choice === openNow) {
      // Re-fetch the stored shortcut so openShortcut sees the freshly-written tailFollow flag.
      await openShortcut(store, store.findShortcut(shortcut.id) ?? shortcut);
    }
    return;
  }
  // Disabling: stop any in-flight follow on this file immediately, not just on the
  // next open, so an open log tab stops jumping the moment the user turns it off.
  const uri = store.resolveUri(shortcut);
  if (uri) {
    followedDocs.delete(uri.toString());
  }
  vscode.window.showInformationMessage(l10n("tail.disabled", { name }));
}
