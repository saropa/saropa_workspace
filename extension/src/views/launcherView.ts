import * as vscode from "vscode";
import * as crypto from "crypto";
import { ShortcutStore } from "../model/shortcutStore";
import { runShortcutCommand } from "../commands/shortcutExecution";
import { openShortcut } from "../commands/shortcutInteraction";
import { l10n } from "../i18n/l10n";
import { buildLauncherItems } from "./launcherItems";
import { LAUNCHER_STYLE, LAUNCHER_SCRIPT } from "./launcherAssets";

// The "Saropa Launcher" Panel webview: a second, always-reachable window onto the same
// shortcut data the sidebar tree shows, living in the bottom Panel (beside Terminal /
// Output) so a shortcut can be found and run without opening the activity-bar icon. The
// sidebar tree stays the canonical arrange/manage surface (drag-reorder, the full context
// menu); this surface is a fast launcher: an always-visible search over two responsive
// panes — the user's own shortcuts and the detected (un-adopted) recipes — each a set of
// collapsible groups of tinted cards.
//
// Why a webview and not a second tree: a native TreeView is a single vertical column with
// no embedded search field and no side-by-side panes. The Panel is wide and short, so the
// two-pane grid reflows to use its width and the search box sits permanently at the top.
//
// The host sends the full item set on every store change; the webview filters it
// client-side, so search never round-trips. A primary click expands a card's drawer; the ▶
// button runs; a right-click opens a menu that mirrors the sidebar's actions and is routed
// back here as a `command` message, re-resolved against the store by id (never trusting a
// shortcut object from the webview). Strict CSP with a per-load nonce; the only local
// resource is the codicon font (shipped in dist/, loaded via asWebviewUri), so the cards
// can draw real product-icon glyphs. The row-building logic lives in the vscode-free
// launcherItems module so it unit-tests under Node's runner.

// The right-click menu only lists commands verified to accept a raw Shortcut via asShortcut
// (see buildMenu in launcherItems). Re-resolving the id here and forwarding the shortcut as
// the command argument is therefore safe: the registered handler normalizes it exactly as a
// tree-item invocation would. The allowlist guards against a webview posting an arbitrary
// command id.
const MENU_COMMANDS: ReadonlySet<string> = new Set([
  "saropaWorkspace.openPin",
  "saropaWorkspace.runPin",
  "saropaWorkspace.runWith",
  "saropaWorkspace.configureRun",
  "saropaWorkspace.configureSchedule",
  "saropaWorkspace.configureTriggers",
  "saropaWorkspace.pausePin",
  "saropaWorkspace.unpausePin",
  "saropaWorkspace.customizeShortcut",
  "saropaWorkspace.setMetric",
  "saropaWorkspace.duplicateFile",
  "saropaWorkspace.renameFileOnDisk",
  "saropaWorkspace.copyFileTo",
  "saropaWorkspace.toggleMask",
  "saropaWorkspace.copyPinLink",
  "saropaWorkspace.renamePin",
  "saropaWorkspace.unpin",
  "saropaWorkspace.promoteRecipe",
  "saropaWorkspace.scheduleRecipe",
]);

export class LauncherViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewId = "saropaWorkspace.launcher";

  private view: vscode.WebviewView | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly store: ShortcutStore,
    private readonly extensionUri: vscode.Uri
  ) {
    // Repaint whenever the shortcut/recipe set changes so the launcher never lags the
    // sidebar. The view may not be resolved yet (the Panel tab was never opened); the
    // post is a no-op until it is, and resolve does the first paint.
    this.disposables.push(this.store.onDidChange(() => this.post()));
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      // The codicon font + stylesheet live in dist/; restrict local-resource loads to it.
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "dist")],
    };
    view.webview.html = this.renderHtml(view.webview);
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
    const msg = message as { type?: string; id?: string; command?: string };
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
    } else if (msg.type === "command" && typeof msg.command === "string") {
      // A right-click menu choice: run the same command the sidebar would, passing the
      // re-resolved shortcut as its argument. Gated by the allowlist so only the menu's
      // own commands can be driven from the webview.
      if (MENU_COMMANDS.has(msg.command)) {
        await vscode.commands.executeCommand(msg.command, shortcut);
      }
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
        open: l10n("launcher.open"),
        pin: l10n("launcher.pin"),
        schedule: l10n("launcher.schedule"),
        mine: l10n("launcher.mineSection"),
        recipes: l10n("launcher.recipesSection"),
        // {n} / {shown} / {total} stay literal here: the webview substitutes the live
        // counts, so these are fetched without l10n params.
        count: l10n("launcher.count"),
        countFiltered: l10n("launcher.countFiltered"),
      },
    });
  }

  private renderHtml(webview: vscode.Webview): string {
    const nonce = crypto.randomBytes(16).toString("base64");
    const codiconUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "dist", "codicon.css")
    );
    const csp = [
      "default-src 'none'",
      "img-src 'none'",
      // The codicon stylesheet loads from the webview's own resource origin; our injected
      // <style> needs 'unsafe-inline'. The font loads from the same origin.
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `font-src ${webview.cspSource}`,
      `script-src 'nonce-${nonce}'`,
    ].join("; ");
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<link href="${codiconUri}" rel="stylesheet" />
<title>${l10n("launcher.title")}</title>
<style>${LAUNCHER_STYLE}</style>
</head>
<body>
<header>
  <div class="search">
    <span class="codicon codicon-search"></span>
    <input id="q" type="text" spellcheck="false" aria-label="${l10n("launcher.searchPlaceholder")}" />
    <span id="count" class="count"></span>
  </div>
</header>
<div id="empty" class="empty hidden">${l10n("launcher.empty")}</div>
<div id="root" class="root"></div>
<script nonce="${nonce}">${LAUNCHER_SCRIPT}</script>
</body>
</html>`;
  }
}
