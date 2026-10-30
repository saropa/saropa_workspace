import * as crypto from "node:crypto";
import * as vscode from "vscode";
import { onDidRecordHealth } from "../commands/boardHealth";
import { onDidChangeMarks, readMarks } from "../commands/boardMarks";
import { REPORT_SETTINGS } from "../commands/boardRecipeEvidence";
import { onDidChangeTrainVersions } from "./boardTrain";
import { renderSkeleton } from "../board/boardHtml";
import { onDidChangeProviders } from "../commands/boardOutside";
import { readLiveSettings } from "../commands/boardLive";
import { onDidChangeSinceLast } from "./boardSinceLast";
import { markPanelOpened, onDidAskRefresh, setPanelVisible } from "./boardFeed";
import { strings } from "./boardStrings";
import { BoardPanelCore, LIVE_GAP_MS } from "./boardPanelCore";

/** Connects the board panel to its event sources (visibility, refresh, marks, documents, health) and schedules rescans. */
export abstract class BoardPanelWiring extends BoardPanelCore {
  constructor(context: vscode.ExtensionContext, panel: vscode.WebviewPanel) {
    super(context, panel);
    // A throw after listeners and watchers exist must not leak them: the caller never gets an object to dispose.
    try {
      panel.onDidDispose(() => this.dispose(), null, this.disposables);
      // While the tab is showing it owns the scan: the sidebar's refresh button asks it.
      markPanelOpened();
      setPanelVisible(panel.visible);
      panel.onDidChangeViewState(() => {
        setPanelVisible(panel.visible);
        if (panel.visible && this.run) {
          // Shown again: repaint, so the strip reflects a dismiss made elsewhere (the sidebar).
          this.render(this.scanning ? { loading: true } : this.cached ? { stale: true } : {});
        }
      }, null, this.disposables);
      onDidAskRefresh(() => this.poke(0), null, this.disposables);
      // The change was taken as seen (or marked seen): draw the board again without the strip.
      onDidChangeSinceLast(
        () => {
          if (this.run) {
            this.lastKey = "";
            this.render(this.scanning ? { loading: true } : this.cached ? { stale: true } : {});
          }
        },
        null,
        this.disposables
      );
      onDidRecordHealth(() => this.poke(300), null, this.disposables);
      // A mark changes only what is drawn, so the stored scan is shown again, not redone.
      onDidChangeMarks(
        () =>
          void readMarks(this.context).then((m) => {
            if (this.run) {
              this.run.marks = m;
              this.render();
              // A repaint wipes the open list of proposed links; it is drawn again from the new board.
              this.patches.reshowLinks();
            }
          }),
        null,
        this.disposables
      );
      this.listenForChanges();
      this.watchDocuments();
      this.disposables.push(this.patches.watch());
      panel.onDidChangeViewState(() => this.panel.visible && this.dirty && this.schedule(0), null, this.disposables);
      // Problems changed while the tab was hidden: look again when it is shown.
      panel.onDidChangeViewState(() => this.panel.visible && !this.scanning && void this.refreshLive(), null, this.disposables);
      // Documents were edited while the tab was hidden: look again when it is shown.
      panel.onDidChangeViewState(() => {
        if (this.panel.visible && this.editedStale) {
          this.editedStale = false;
          void this.refreshEdited();
        }
      }, null, this.disposables);
      panel.webview.onDidReceiveMessage((m: unknown) => void this.onMessage(m), null, this.disposables);
      // Something is on screen at once: placeholders, then the last result, then the scan.
      panel.webview.html = renderSkeleton(strings(), crypto.randomBytes(16).toString("base64"));
    } catch (e) {
      for (const d of this.disposables) {
        d.dispose();
      }
      throw e;
    }
  }

  // Marks, providers, Problems, trains, folders and settings: each draws again or asks for a scan.
  protected listenForChanges(): void {
    onDidChangeProviders(() => void this.refreshOutside(), null, this.disposables);
    // The Problems panel changes often while typing: look again at most every few seconds.
    vscode.languages.onDidChangeDiagnostics(
      () => {
        // A true throttle: at most one look every 4 s, the last change always gets one.
        if (this.panel.visible && !this.liveTimer && readLiveSettings().enabled) {
          this.liveTimer = setTimeout(() => {
            this.liveTimer = undefined;
            void this.refreshLive();
          }, Math.max(0, this.liveAt + LIVE_GAP_MS - Date.now()));
        }
      },
      null,
      this.disposables
    );
    // A document was opened, edited, saved or closed: the In progress list may change.
    vscode.workspace.onDidChangeTextDocument((e) => e.document.uri.scheme === "file" && this.scheduleEdited(), null, this.disposables);
    vscode.workspace.onDidSaveTextDocument((d) => d.uri.scheme === "file" && this.scheduleEdited(), null, this.disposables);
    vscode.workspace.onDidOpenTextDocument((d) => d.uri.scheme === "file" && this.scheduleEdited(), null, this.disposables);
    vscode.workspace.onDidCloseTextDocument((d) => d.uri.scheme === "file" && this.scheduleEdited(), null, this.disposables);
    // A project version was read: draw the train name again.
    onDidChangeTrainVersions(() => !this.scanning && !this.cached && this.render(), null, this.disposables);
    vscode.workspace.onDidChangeWorkspaceFolders(() => this.poke(300), null, this.disposables);
    vscode.workspace.onDidChangeConfiguration(
      (e) => {
        if (["enabled", "profile", "projects", "projectScope", ...REPORT_SETTINGS].some((k) => e.affectsConfiguration(`saropaWorkspace.releaseBoard.${k}`))) {
          this.poke(300);
        } else if (this.onlyStartupChanged(e)) {
          // Only the start-up checkbox changed: draw the stored scan again, nothing else.
          this.render(this.scanning ? { loading: true } : this.cached ? { stale: true } : {});
        } else if (e.affectsConfiguration("saropaWorkspace.releaseBoard")) {
          // Display-only settings: draw the stored scan again, no rescan.
          this.lastKey = "";
          this.render(this.scanning ? { loading: true } : this.cached ? { stale: true } : {});
          void this.refreshOutside();
          void this.refreshLive();
          void this.refreshFuture();
          void this.refreshEdited();
          void this.chats.refresh();
        }
      },
      null,
      this.disposables
    );
  }

  // True when the change touched the start-up setting and no other Release Board setting.
  private onlyStartupChanged(e: vscode.ConfigurationChangeEvent): boolean {
    const prefix = "saropaWorkspace.releaseBoard.";
    if (!e.affectsConfiguration(prefix + "openOnStartup")) {
      return false;
    }
    const props = (this.context.extension.packageJSON as { contributes?: { configuration?: unknown } }).contributes?.configuration;
    const blocks = Array.isArray(props) ? props : props ? [props] : [];
    const keys = blocks.flatMap((b) => Object.keys((b as { properties?: Record<string, unknown> }).properties ?? {}));
    return !keys.some((k) => k.startsWith(prefix) && k !== prefix + "openOnStartup" && e.affectsConfiguration(k));
  }

  protected watchDocuments(): void {
    // Documents change on disk: rescan while the tab is showing, else only remember it.
    const rules = vscode.workspace.createFileSystemWatcher("**/.saropa/release-board*.json");
    const watcher = vscode.workspace.createFileSystemWatcher("**/*.{md,sql}");
    rules.onDidChange(() => this.poke(300), null, this.disposables);
    rules.onDidCreate(() => this.poke(300), null, this.disposables);
    rules.onDidDelete(() => this.poke(300), null, this.disposables);
    this.disposables.push(rules);
    const changed = (uri: vscode.Uri): void => {
      if (/[\\/](?:node_modules|\.git)[\\/]/.test(uri.path)) {
        return;
      }
      this.dirty = true;
      if (this.panel.visible) {
        this.schedule(1500);
      }
    };
    watcher.onDidChange(changed, null, this.disposables);
    watcher.onDidCreate(changed, null, this.disposables);
    watcher.onDidDelete(changed, null, this.disposables);
    this.disposables.push(watcher);
  }
}
