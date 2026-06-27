import * as vscode from "vscode";
import * as crypto from "crypto";
import { ShortcutStore } from "../model/shortcutStore";
import { runShortcutCommand } from "../commands/shortcutExecution";
import { openShortcut } from "../commands/shortcutInteraction";
import { l10n } from "../i18n/l10n";
import { buildLauncherItems } from "./launcherItems";
import { LAUNCHER_STYLE, LAUNCHER_SCRIPT } from "./launcherAssets";

// The "Saropa Launcher" Panel webview: a second, always-reachable window onto the
// same shortcut data the sidebar tree shows, living in the bottom Panel (beside
// Terminal / Output) so a shortcut can be found and run without opening the activity-
// bar icon. The sidebar tree stays the canonical arrange/manage surface (drag-reorder,
// context menus); this surface is a fast launcher: an always-visible search box over a
// responsive grid of every shortcut plus the detected (un-adopted) recipes.
//
// Why a webview and not a second tree: a native TreeView is always a single vertical
// column with no embedded search field. The Panel is wide and short, so the grid
// reflows to use its horizontal width, and the search box sits permanently at the top
// — neither is possible in a TreeView.
//
// The host sends the full item set on every store change; the webview filters it
// client-side, so search never round-trips. Strict CSP with a per-load nonce, no
// remote content, theme via --vscode-* variables. The row-building logic lives in the
// vscode-free launcherItems module so it unit-tests under Node's runner.

export class LauncherViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewId = "saropaWorkspace.launcher";

  private view: vscode.WebviewView | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly store: ShortcutStore) {
    // Repaint whenever the shortcut/recipe set changes so the launcher never lags the
    // sidebar. The view may not be resolved yet (the Panel tab was never opened); the
    // post is a no-op until it is, and resolve does the first paint.
    this.disposables.push(this.store.onDidChange(() => this.post()));
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true };
    view.webview.html = this.renderHtml();
    // The webview posts `ready` once its message listener is mounted; replying then
    // (rather than pushing eagerly here) avoids a race where the host posts before the
    // script can receive it.
    view.webview.onDidReceiveMessage(
      (message: unknown) => void this.onMessage(message),
      null,
      this.disposables
    );
    view.onDidDispose(() => {
      this.view = undefined;
    }, null, this.disposables);
  }

  dispose(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
  }

  // Resolve a webview message to an action on the addressed shortcut. The payload is
  // untrusted, so the id is narrowed and re-resolved against the store rather than
  // trusting a shortcut object from the webview.
  private async onMessage(message: unknown): Promise<void> {
    if (typeof message !== "object" || message === null) {
      return;
    }
    const msg = message as { type?: string; id?: string };
    if (msg.type === "ready") {
      this.post();
      return;
    }
    if (typeof msg.id !== "string") {
      return;
    }
    const shortcut = this.store.findShortcut(msg.id);
    if (!shortcut) {
      return;
    }
    if (msg.type === "open") {
      await openShortcut(this.store, shortcut);
    } else if (msg.type === "run") {
      await runShortcutCommand(this.store, shortcut);
    }
  }

  // Push the current item set + UI strings to the webview. No-op until the view is
  // resolved.
  private post(): void {
    if (!this.view) {
      return;
    }
    void this.view.webview.postMessage({
      type: "data",
      items: buildLauncherItems(this.store),
      placeholder: l10n("launcher.searchPlaceholder"),
      strings: {
        run: l10n("launcher.run"),
        // {n} / {shown} / {total} stay literal here: the webview substitutes the live
        // counts, so these are fetched without l10n params.
        count: l10n("launcher.count"),
        countFiltered: l10n("launcher.countFiltered"),
      },
    });
  }

  private renderHtml(): string {
    const nonce = crypto.randomBytes(16).toString("base64");
    const csp = [
      "default-src 'none'",
      "img-src 'none'",
      "style-src 'unsafe-inline'",
      `script-src 'nonce-${nonce}'`,
    ].join("; ");
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${l10n("launcher.title")}</title>
<style>${LAUNCHER_STYLE}</style>
</head>
<body>
<header>
  <div class="search">
    <input id="q" type="text" spellcheck="false" aria-label="${l10n("launcher.searchPlaceholder")}" />
    <span id="count" class="count"></span>
  </div>
</header>
<div id="empty" class="empty hidden">${l10n("launcher.empty")}</div>
<div id="root"></div>
<script nonce="${nonce}">${LAUNCHER_SCRIPT}</script>
</body>
</html>`;
  }
}
