import * as vscode from "vscode";
import * as crypto from "crypto";
import * as path from "path";
import { ShortcutStore } from "../model/shortcutStore";
import { shortcutKind } from "../model/shortcut";
import { FolderWatchStore } from "../model/folderWatch";
import { runShortcutCommand } from "../commands/shortcutExecution";
import { openShortcut } from "../commands/shortcutInteraction";
import { l10n } from "../i18n/l10n";
import {
  buildLauncherItems,
  watchLauncherItem,
  fileLauncherItem,
  LauncherItem,
} from "./launcherItems";
import { ProjectFilesTreeProvider, formatRelativeTime } from "./projectFilesProvider";
import { glyphForCategory, ProjectFileInfo } from "../model/projectFiles";
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
    const msg = message as {
      type?: string;
      id?: string;
      command?: string;
      path?: string;
    };
    if (msg.type === "ready") {
      void this.post();
      return;
    }

    // The Watches and Project Files panes route their opens by their OWN validated
    // targets, not through the store: a watch id is not a shortcut id, and a surfaced
    // project file is often not a shortcut at all. Each id/path is re-validated against
    // the live source here so the untrusted webview can never drive an arbitrary watch
    // or open an arbitrary file path.
    if (msg.type === "openWatch" && typeof msg.id === "string") {
      if (this.watchStore.find(msg.id)) {
        // openWatch opens what changed and clears the watch's unseen counter; the
        // launcher's watch card carries that same counter, so it stays in sync.
        await vscode.commands.executeCommand("saropaWorkspace.openWatch", msg.id);
      }
      return;
    }
    if (msg.type === "openFile" && typeof msg.path === "string") {
      const files = await this.projectFiles.listSurfacedFiles();
      const target = files.find((f) => f.uri.fsPath === msg.path);
      if (target) {
        await vscode.commands.executeCommand("vscode.open", target.uri);
      }
      return;
    }
    // Copy a file-backed card's full on-disk path to the clipboard, resolved host-side by
    // the card's id so the webview never carries or is trusted with a path. A file shortcut/
    // recipe resolves through the store (its stored path may be folder-relative, so resolve
    // to the absolute fsPath); a surfaced project file's id is its absolute path, re-validated
    // against the live surfaced-files list. Either way the toast names the file.
    if (msg.type === "copyPath" && typeof msg.id === "string") {
      const shortcut = this.store.findShortcut(msg.id);
      if (shortcut) {
        // Only file shortcuts have a meaningful on-disk path; a shell/macro/routine does not.
        if (shortcutKind(shortcut) !== "file") {
          return;
        }
        const full = this.store.resolveUri(shortcut)?.fsPath ?? shortcut.path;
        await vscode.env.clipboard.writeText(full);
        void vscode.window.showInformationMessage(
          l10n("launcher.copiedPath", {
            name: shortcut.label ?? (shortcut.path.split("/").pop() ?? shortcut.path),
          })
        );
        return;
      }
      const files = await this.projectFiles.listSurfacedFiles();
      const target = files.find((f) => f.uri.fsPath === msg.id);
      if (target) {
        await vscode.env.clipboard.writeText(target.uri.fsPath);
        void vscode.window.showInformationMessage(
          l10n("launcher.copiedPath", {
            name: target.name.split("/").pop() ?? target.name,
          })
        );
      }
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
    const items = this.buildAllItems(files);
    void this.view.webview.postMessage({
      type: "data",
      items,
      header: this.buildHeader(files, items),
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

  // Assemble every launcher row: the shortcut + recipe cards (the two existing panes),
  // then the watch cards and the project-file cards (the two flat panes). Each watch/file
  // card is formatted by the vscode-free builders in launcherItems; the host supplies the
  // bits those builders cannot compute (the watch's unseen tally, a file's shortcut state
  // and freshness clock). `files` is the already-scanned surfaced-file set passed in by
  // post() so the disk scan runs once per paint (shared with the header's version/stats).
  private buildAllItems(files: readonly ProjectFileInfo[]): LauncherItem[] {
    const items = buildLauncherItems(this.store);

    for (const w of this.watchStore.list()) {
      items.push(
        watchLauncherItem({
          id: w.id,
          label: w.label ?? path.basename(w.target),
          target: w.target,
          isFile: w.isFile,
          mode: w.mode,
          enabled: w.enabled,
          unseen: this.watchStore.unseenCount(w.id),
        })
      );
    }

    // One card per surfaced project file. Ordered by category first (the scan returns
    // files in catalog order — Project, then the platform groups — so first appearance
    // here gives the launcher's group order), then by displayed name within a category
    // to match the tree. The relative time is stamped from one clock read so every card
    // in this paint shares the same "now".
    const now = Date.now();
    const categoryOrder: string[] = [];
    for (const f of files) {
      if (!categoryOrder.includes(f.category)) {
        categoryOrder.push(f.category);
      }
    }
    const fileName = (name: string): string => name.split("/").pop() ?? name;
    const ordered = [...files].sort((a, b) => {
      const byCategory =
        categoryOrder.indexOf(a.category) - categoryOrder.indexOf(b.category);
      if (byCategory !== 0) {
        return byCategory;
      }
      return fileName(a.name).localeCompare(fileName(b.name), undefined, {
        sensitivity: "base",
      });
    });
    const fileItems = ordered.map((f) =>
      fileLauncherItem({
        path: f.uri.fsPath,
        fileName: fileName(f.name),
        version: f.version,
        relative: formatRelativeTime(f.modified, now),
        isShortcut:
          this.store.findShortcutByUri(f.uri, "project") !== undefined,
        category: f.category,
        categoryGlyph: glyphForCategory(f.category),
      })
    );
    items.push(...fileItems);

    return items;
  }

  // The launcher header's leading block: the current project (the first workspace folder),
  // its declared version, and a compact count of what the board holds. The name is also
  // painted synchronously from the initial HTML (projectName below); posting it again here
  // keeps it correct when the open folder changes. Version + stats are the asynchronous
  // facets — version is read from the same already-scanned manifest set, stats from the
  // built items — so the developer's "version and stats computed asynchronously" lands
  // without a second disk scan.
  private buildHeader(
    files: readonly ProjectFileInfo[],
    items: readonly LauncherItem[]
  ): LauncherHeader {
    const primary = (vscode.workspace.workspaceFolders ?? [])[0];
    const project =
      primary?.name ?? vscode.workspace.name ?? l10n("launcher.noProject");
    const version = deriveProjectVersion(files, primary?.name);

    // Count by pane, omitting an empty bucket so the meta line stays a tight summary of
    // what is actually present rather than a row of zeros.
    const count = (pane: LauncherItem["pane"]): number =>
      items.reduce((n, it) => (it.pane === pane ? n + 1 : n), 0);
    const stats: LauncherStat[] = [];
    const pushStat = (n: number, icon: string, key: string): void => {
      if (n > 0) {
        stats.push({ icon, text: l10n(key, { count: n }) });
      }
    };
    pushStat(count("mine"), "star-full", "launcher.statShortcuts");
    pushStat(count("recipes"), "book", "launcher.statRecipes");
    pushStat(count("watches"), "eye", "launcher.statWatches");
    pushStat(count("files"), "files", "launcher.statFiles");

    return {
      project,
      version: version ? l10n("launcher.version", { version }) : undefined,
      stats,
    };
  }

  private renderHtml(webview: vscode.Webview): string {
    const nonce = crypto.randomBytes(16).toString("base64");
    const codiconUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "dist", "codicon.css")
    );
    // Paint the project name synchronously in the initial markup so the header is never
    // blank on first render; the version + stats arrive in the first data message (they
    // need the disk scan). A folder basename is user-controlled, so it is HTML-escaped
    // before it is interpolated into the markup (the webview's later update uses
    // textContent and is safe by construction).
    const primary = (vscode.workspace.workspaceFolders ?? [])[0];
    const projectName = escapeHtml(
      primary?.name ?? vscode.workspace.name ?? l10n("launcher.noProject")
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
  <div class="head-bar">
    <div class="project">
      <div id="projName" class="project-name">${projectName}</div>
      <div id="projMeta" class="project-meta"></div>
    </div>
    <div class="search">
      <span class="codicon codicon-search"></span>
      <input id="q" type="text" spellcheck="false" aria-label="${l10n("launcher.searchPlaceholder")}" />
      <span id="count" class="count"></span>
    </div>
  </div>
</header>
<div id="empty" class="empty hidden">${l10n("launcher.empty")}</div>
<div id="root" class="root"></div>
<script nonce="${nonce}">${LAUNCHER_SCRIPT}</script>
</body>
</html>`;
  }
}

// One count shown in the header's meta line: a codicon id and its pre-localized label
// (e.g. "6 shortcuts"). Built host-side so the webview holds no display strings.
interface LauncherStat {
  readonly icon: string;
  readonly text: string;
}

// The header's leading block, posted with every data message. `project` is the current
// folder name; `version` is the pre-localized "v{x}" label (undefined when no manifest
// declares one); `stats` is the non-empty count summary.
interface LauncherHeader {
  readonly project: string;
  readonly version: string | undefined;
  readonly stats: readonly LauncherStat[];
}

// The project's declared version, read from the already-scanned manifest set. Manifests are
// tried in a fixed precedence so a polyglot repo reports one stable version: the package
// manifests first (the authored project version), then CHANGELOG as a last resort (its
// newest released heading). Scoped to the primary folder so a sibling folder's manifest in a
// multi-root workspace never leaks into the header. Returns undefined when nothing declares
// one, which the caller renders as no version chip rather than an empty "v".
function deriveProjectVersion(
  files: readonly ProjectFileInfo[],
  primaryFolder: string | undefined
): string | undefined {
  const precedence = [
    "package.json",
    "pubspec.yaml",
    "Cargo.toml",
    "pyproject.toml",
    "CHANGELOG.md",
  ];
  const scoped = primaryFolder
    ? files.filter((f) => f.folderName === primaryFolder)
    : files;
  const baseName = (name: string): string => name.split("/").pop() ?? name;
  for (const manifest of precedence) {
    const hit = scoped.find(
      (f) => baseName(f.name) === manifest && f.version
    );
    if (hit?.version) {
      return hit.version;
    }
  }
  return undefined;
}

// Escape the five HTML-significant characters before interpolating an untrusted value (a
// folder basename) into the initial markup string. Every other rendered value reaches the
// webview through textContent, which escapes by construction; this guards the one value
// baked into the HTML host-side.
function escapeHtml(value: string): string {
  return value
    .split("&").join("&amp;")
    .split("<").join("&lt;")
    .split(">").join("&gt;")
    .split('"').join("&quot;")
    .split("'").join("&#39;");
}
