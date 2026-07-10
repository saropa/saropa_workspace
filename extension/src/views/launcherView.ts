import * as vscode from "vscode";
import { ShortcutStore } from "../model/shortcutStore";
import { FolderWatchStore } from "../model/folderWatch";
import { l10n } from "../i18n/l10n";
import { LauncherItem } from "./launcherItems";
import { ProjectFilesTreeProvider } from "./projectFilesProvider";
import { handleLauncherMessage } from "./launcherViewMessages";
import { buildAllItems, buildHeader } from "./launcherViewData";
import { renderHtml } from "./launcherViewShell";

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
// launcherItems module so it unit-tests under Node's runner. The message-routing body lives
// in launcherViewMessages, the item/header assembly in launcherViewData, and the HTML shell
// in launcherViewShell — this file keeps only the webview lifecycle.
export class LauncherViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewId = "saropaWorkspace.launcher";

  private view: vscode.WebviewView | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly store: ShortcutStore,
    private readonly watchStore: FolderWatchStore,
    private readonly projectFiles: ProjectFilesTreeProvider,
    private readonly extensionUri: vscode.Uri
  ) {
    // Repaint whenever any of the surfaces the launcher mirrors changes, so it never lags
    // the sidebar: the shortcut/recipe set (store), the watch list and its unseen counts
    // (watchStore — two events: the list itself, and the per-watch unseen tally), and the
    // project files' freshness/version on a save or a folder/setting change. The view may
    // not be resolved yet (the Panel tab was never opened); post() is a no-op until it is,
    // and resolve does the first paint.
    this.disposables.push(
      this.store.onDidChange(() => void this.post()),
      this.watchStore.onDidChange(() => void this.post()),
      this.watchStore.onDidChangeCounts(() => void this.post()),
      vscode.workspace.onDidSaveTextDocument(() => void this.post()),
      vscode.workspace.onDidChangeWorkspaceFolders(() => void this.post()),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration("saropaWorkspace.projectFiles")) {
          void this.post();
        }
      })
    );
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      // The codicon font + stylesheet live in dist/; restrict local-resource loads to it.
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "dist")],
    };
    view.webview.html = renderHtml(view.webview, this.extensionUri);
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

  // Thin delegator to the extracted message-routing body, supplying the stores/provider it
  // resolves ids against and a bound post() so a `ready` handshake can trigger the first
  // paint without handing the whole class instance to a free function.
  private async onMessage(message: unknown): Promise<void> {
    await handleLauncherMessage(message, {
      store: this.store,
      watchStore: this.watchStore,
      projectFiles: this.projectFiles,
      post: () => this.post(),
    });
  }

  // Push the current item set + UI strings to the webview. No-op until the view is
  // resolved. Async because the project-files scan does a handful of file stats (the same
  // scan the tree does); the watch + shortcut data is in-memory. The scan runs ONCE here
  // and feeds both the file cards and the header's version/stats, so the header's
  // asynchronous facets (version, counts) ride the same data message — the project NAME
  // already painted synchronously from the initial HTML, so the header fills in without
  // blocking the first render.
  private async post(): Promise<void> {
    if (!this.view) {
      return;
    }
    const files = await this.projectFiles.listSurfacedFiles();
    const items: LauncherItem[] = buildAllItems(this.store, this.watchStore, files);
    void this.view.webview.postMessage({
      type: "data",
      items,
      header: buildHeader(this.store, files, items),
      placeholder: l10n("launcher.searchPlaceholder"),
      strings: {
        run: l10n("launcher.run"),
        open: l10n("launcher.open"),
        copyPath: l10n("launcher.copyPath"),
        pin: l10n("launcher.pin"),
        schedule: l10n("launcher.schedule"),
        mine: l10n("launcher.mineSection"),
        recipes: l10n("launcher.recipesSection"),
        watches: l10n("launcher.watchesSection"),
        files: l10n("launcher.filesSection"),
        // {n} / {shown} / {total} stay literal here: the webview substitutes the live
        // counts, so these are fetched without l10n params.
        count: l10n("launcher.count"),
        countFiltered: l10n("launcher.countFiltered"),
      },
    });
  }
}
