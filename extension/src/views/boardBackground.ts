import * as vscode from "vscode";
import { BoardModel, buildBoard } from "../board/boardModel";
import { applyMarks, pinnedKeys } from "../board/marks";
import { asStartupMode, projectsFound, shouldOpenOnStartup } from "../board/sidebar";
import { onDidRecordHealth } from "../commands/boardHealth";
import { onDidChangeMarks, readMarks } from "../commands/boardMarks";
import { REPORT_SETTINGS } from "../commands/boardRecipeEvidence";
import { BoardRun, DEFAULT_ROOTS, logBoardError, readLastRun, runBoardScan } from "../commands/releaseBoardCommands";
import { disposeTrain } from "./boardTrain";
import { askRefresh, currentBoard, disposeFeed, hasPanelOpened, isPanelVisible, isStoredOnly, onDidAskRefresh, onDidChangePanelVisible, setFailed, setScanning } from "./boardFeed";
import { openBoard } from "./boardPanel";
import { publishBoard } from "./editorLinks";
import { orgPreviousInput } from "./boardPanelActions";

// The quiet scan behind the sidebar, the status bar light and the editor lines, so they are
// live without the board tab open. While the tab is showing it owns the scan and this stays
// out of the way; a tab that is hidden or closed does not. Scans never overlap: a request
// during a scan only asks for one more pass (the scan itself is also serialized in
// runBoardScan, with the tab's and the commands').

const SETTINGS = "saropaWorkspace.releaseBoard";
// Same short delay the editor lines use, so startup is never in the way.
const START_DELAY_MS = 3000;
// Settings that change what a scan finds. Everything else only changes how it is drawn.
const SCAN_SETTINGS = ["enabled", "profile", ...REPORT_SETTINGS].map((k) => `${SETTINGS}.${k}`);
const IGNORED = /[\\/](?:node_modules|\.git|build|\.dart_tool|Pods|vendor)[\\/]/;

function boardOn(): boolean {
  return vscode.workspace.getConfiguration(SETTINGS).get<boolean>("enabled", true) && (vscode.workspace.workspaceFolders?.length ?? 0) > 0;
}

function modelOf(run: BoardRun, context: vscode.ExtensionContext): BoardModel {
  return buildBoard(run.cfg, applyMarks(run.result.rows, run.marks), run.safety, run.accepted, run.result.snapshot, run.previous, run.health, {
    needs: run.marks.needs,
    rejected: run.marks.rejected,
    pins: pinnedKeys(run.marks),
    // The saved layouts the tab uses, so the groups never differ between the tab and the background board.
    orgPrevious: orgPreviousInput(context),
  });
}

// The projects to watch: the scanned ones, else (no board yet, or the first scan failed)
// every workspace folder with the default document folders.
function watched(): Array<{ path: string; roots: string[] }> {
  const projects = currentBoard()?.run.cfg.projects;
  if (projects && projects.length > 0) {
    return projects.map((p) => ({ path: p.path, roots: [...new Set([...p.roots, ...DEFAULT_ROOTS])] }));
  }
  return (vscode.workspace.workspaceFolders ?? []).map((f) => ({ path: f.uri.toString(), roots: DEFAULT_ROOTS }));
}

// True when the file sits inside a document folder of a watched project.
function inScannedRoot(uri: vscode.Uri): boolean {
  const at = uri.toString();
  return watched().some((p) => p.roots.some((r) => at.startsWith(`${p.path}/${r}/`)));
}

// True when a document folder itself (bugs, docs, plans...) was created or deleted at the top of a project.
function isRootFolder(uri: vscode.Uri): boolean {
  const at = uri.toString();
  return watched().some((p) => p.roots.some((r) => at === `${p.path}/${r}`));
}

class BackgroundScan {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private scanning = false;
  private again = false;
  // A request came in while the tab was showing; run it once the tab is hidden or closed.
  private skipped = false;
  // The startup tab is decided once per window, after the first pass, and never later.
  private startupDecided = false;

  constructor(private readonly context: vscode.ExtensionContext) {}

  clearTimer(): void {
    clearTimeout(this.timer);
  }

  private decideStartup(ok: boolean): void {
    if (this.startupDecided) {
      return;
    }
    this.startupDecided = true;
    const board = currentBoard();
    if (!ok || !board || hasPanelOpened()) {
      return;
    }
    const mode = asStartupMode(vscode.workspace.getConfiguration(SETTINGS).get<string>("openOnStartup", "whenProjectsFound"));
    if (shouldOpenOnStartup(mode, projectsFound(board.model), boardOn())) {
      openBoard(this.context, true).catch(logBoardError);
    }
  }

  // One pass. Returns false when it failed; the previous board stays on screen.
  private async scanOnce(): Promise<boolean> {
    try {
      // An empty first callback keeps the scan quiet: no progress item, text read in one go.
      const run = await runBoardScan(this.context, true, () => undefined);
      // The tab became visible during the pass: it scans for itself and publishes.
      if (isPanelVisible()) {
        return true;
      }
      publishBoard(run ? modelOf(run, this.context) : undefined, run);
      setFailed(false);
      return true;
    } catch (e) {
      logBoardError(e);
      setFailed(true);
      return false;
    }
  }

  async scan(): Promise<void> {
    if (isPanelVisible()) {
      this.skipped = true;
      // A tab opened by hand before the first pass counts as the startup tab.
      this.startupDecided = true;
      return;
    }
    if (this.scanning) {
      this.again = true;
      return;
    }
    this.scanning = true;
    let ok = true;
    try {
      if (!boardOn()) {
        publishBoard(undefined, undefined);
        return;
      }
      setScanning(true);
      this.skipped = false;
      do {
        this.again = false;
        ok = await this.scanOnce();
      } while (this.again && !isPanelVisible());
      // Left because the tab became visible: the request is kept for when it hides.
      this.skipped = this.skipped || this.again;
    } finally {
      this.scanning = false;
      setScanning(false);
      this.decideStartup(ok && boardOn());
    }
  }

  request(ms: number): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.scan(), ms);
  }

  async paintStored(): Promise<void> {
    if (!boardOn() || currentBoard()) {
      return;
    }
    const run = await readLastRun(this.context).catch(() => undefined);
    if (run && !currentBoard()) {
      publishBoard(modelOf(run, this.context), run, true);
    }
  }

  // The tab was hidden or closed: run the request that came in while it showed.
  onPanelVisible(visible: boolean): void {
    if (!visible && this.skipped) {
      this.request(500);
    }
  }

  // A mark changes only what is drawn: the stored scan is shown again, not redone.
  onMarks(): void {
    const board = currentBoard();
    if (board && !isPanelVisible()) {
      void readMarks(this.context).then((marks) => {
        board.run.marks = marks;
        publishBoard(modelOf(board.run, this.context), board.run, isStoredOnly());
      });
    }
  }
}

// The watchers whose events ask for a scan.
function watchFiles(bg: BackgroundScan): vscode.Disposable[] {
  // Only documents in a project's own document folders trigger a scan.
  const changedFile = (uri: vscode.Uri): void => {
    if (!IGNORED.test(uri.path) && inScannedRoot(uri)) {
      bg.request(1500);
    }
  };
  // Asks both the background scan and the tab (which remembers it while hidden).
  const rootChanged = (uri: vscode.Uri): void => {
    if (isRootFolder(uri)) {
      askRefresh();
    }
  };
  // The rules file changes which projects and folders exist, wherever it sits.
  const rulesChanged = (): void => bg.request(1500);
  const docs = vscode.workspace.createFileSystemWatcher("**/*.{md,sql}");
  const rules = vscode.workspace.createFileSystemWatcher("**/.saropa/release-board*.json");
  docs.onDidChange(changedFile);
  docs.onDidCreate(changedFile);
  docs.onDidDelete(changedFile);
  const folders = vscode.workspace.createFileSystemWatcher(`**/{${DEFAULT_ROOTS.join(",")}}`);
  folders.onDidCreate(rootChanged);
  folders.onDidDelete(rootChanged);
  rules.onDidChange(rulesChanged);
  rules.onDidCreate(rulesChanged);
  rules.onDidDelete(rulesChanged);
  return [docs, folders, rules];
}

/** Starts the background board scan: rescans after file, folder, setting and health changes (debounced) and skips work while nothing needs it. */
export function registerBoardBackground(context: vscode.ExtensionContext): void {
  const bg = new BackgroundScan(context);
  context.subscriptions.push(
    ...watchFiles(bg),
    { dispose: () => bg.clearTimer() },
    onDidRecordHealth(() => bg.request(300)),
    onDidAskRefresh(() => bg.request(0)),
    onDidChangePanelVisible((visible) => bg.onPanelVisible(visible)),
    vscode.workspace.onDidChangeWorkspaceFolders(() => bg.request(300)),
    // Display-only settings (sidebar, status bar light, startup, editor lines) repaint on their own.
    vscode.workspace.onDidChangeConfiguration((e) => SCAN_SETTINGS.some((k) => e.affectsConfiguration(k)) && bg.request(300)),
    onDidChangeMarks(() => bg.onMarks())
  );
  const start = setTimeout(() => void bg.paintStored().then(() => bg.scan()), START_DELAY_MS);
  context.subscriptions.push({ dispose: () => clearTimeout(start) }, { dispose: disposeFeed }, { dispose: disposeTrain });
}
