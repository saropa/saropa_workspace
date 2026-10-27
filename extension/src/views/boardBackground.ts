import * as vscode from "vscode";
import { BoardModel, buildBoard } from "../board/boardModel";
import { applyMarks, pinnedKeys } from "../board/marks";
import { asStartupMode, projectsFound, shouldOpenOnStartup } from "../board/sidebar";
import { onDidRecordHealth } from "../commands/boardHealth";
import { onDidChangeMarks, readMarks } from "../commands/boardMarks";
import { BoardRun, DEFAULT_ROOTS, logBoardError, readLastRun, runBoardScan } from "../commands/releaseBoardCommands";
import { askRefresh, currentBoard, disposeFeed, hasPanelOpened, isPanelVisible, isStoredOnly, onDidAskRefresh, onDidChangePanelVisible, setFailed, setScanning } from "./boardFeed";
import { openBoard } from "./boardPanel";
import { publishBoard } from "./editorLinks";

// The quiet scan behind the sidebar, the status bar light and the editor lines, so they are
// live without the board tab open. While the tab is showing it owns the scan and this stays
// out of the way; a tab that is hidden or closed does not. Scans never overlap: a request
// during a scan only asks for one more pass (the scan itself is also serialized in
// runBoardScan, with the tab's and the commands').

const SETTINGS = "saropaWorkspace.releaseBoard";
// Same short delay the editor lines use, so startup is never in the way.
const START_DELAY_MS = 3000;
// Settings that change what a scan finds. Everything else only changes how it is drawn.
const SCAN_SETTINGS = ["enabled", "profile"].map((k) => `${SETTINGS}.${k}`);
const IGNORED = /[\\/](?:node_modules|\.git|build|\.dart_tool|Pods|vendor)[\\/]/;

function boardOn(): boolean {
  return vscode.workspace.getConfiguration(SETTINGS).get<boolean>("enabled", true) && (vscode.workspace.workspaceFolders?.length ?? 0) > 0;
}

function modelOf(run: BoardRun): BoardModel {
  return buildBoard(run.cfg, applyMarks(run.result.rows, run.marks), run.safety, run.accepted, run.result.snapshot, run.previous, run.health, {
    needs: run.marks.needs,
    rejected: run.marks.rejected,
    pins: pinnedKeys(run.marks),
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

export function registerBoardBackground(context: vscode.ExtensionContext): void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let scanning = false;
  let again = false;
  // A request came in while the tab was showing; run it once the tab is hidden or closed.
  let skipped = false;
  // The startup tab is decided once per window, after the first pass, and never later.
  let startupDecided = false;

  const decideStartup = (ok: boolean): void => {
    if (startupDecided) {
      return;
    }
    startupDecided = true;
    const board = currentBoard();
    if (!ok || !board || hasPanelOpened()) {
      return;
    }
    const mode = asStartupMode(vscode.workspace.getConfiguration(SETTINGS).get<string>("openOnStartup", "whenProjectsFound"));
    if (shouldOpenOnStartup(mode, projectsFound(board.model), boardOn())) {
      void openBoard(context, true);
    }
  };

  // One pass. Returns false when it failed; the previous board stays on screen.
  const scanOnce = async (): Promise<boolean> => {
    try {
      // An empty first callback keeps the scan quiet: no progress item, text read in one go.
      const run = await runBoardScan(context, true, () => undefined);
      // The tab became visible during the pass: it scans for itself and publishes.
      if (isPanelVisible()) {
        return true;
      }
      publishBoard(run ? modelOf(run) : undefined, run);
      setFailed(false);
      return true;
    } catch (e) {
      logBoardError(e);
      setFailed(true);
      return false;
    }
  };

  const scan = async (): Promise<void> => {
    if (isPanelVisible()) {
      skipped = true;
      // A tab opened by hand before the first pass counts as the startup tab.
      startupDecided = true;
      return;
    }
    if (scanning) {
      again = true;
      return;
    }
    scanning = true;
    let ok = true;
    try {
      if (!boardOn()) {
        publishBoard(undefined, undefined);
        return;
      }
      setScanning(true);
      skipped = false;
      do {
        again = false;
        ok = await scanOnce();
      } while (again && !isPanelVisible());
      // Left because the tab became visible: the request is kept for when it hides.
      skipped = skipped || again;
    } finally {
      scanning = false;
      setScanning(false);
      decideStartup(ok && boardOn());
    }
  };

  const request = (ms: number): void => {
    clearTimeout(timer);
    timer = setTimeout(() => void scan(), ms);
  };

  const paintStored = async (): Promise<void> => {
    if (!boardOn() || currentBoard()) {
      return;
    }
    const run = await readLastRun(context).catch(() => undefined);
    if (run && !currentBoard()) {
      publishBoard(modelOf(run), run, true);
    }
  };

  // Only documents in a project's own document folders trigger a scan.
  const changedFile = (uri: vscode.Uri): void => {
    if (!IGNORED.test(uri.path) && inScannedRoot(uri)) {
      request(1500);
    }
  };
  // Asks both the background scan and the tab (which remembers it while hidden).
  const rootChanged = (uri: vscode.Uri): void => {
    if (isRootFolder(uri)) {
      askRefresh();
    }
  };
  // The rules file changes which projects and folders exist, wherever it sits.
  const rulesChanged = (): void => request(1500);
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

  context.subscriptions.push(
    docs,
    folders,
    rules,
    { dispose: () => clearTimeout(timer) },
    onDidRecordHealth(() => request(300)),
    onDidAskRefresh(() => request(0)),
    onDidChangePanelVisible((visible) => !visible && skipped && request(500)),
    vscode.workspace.onDidChangeWorkspaceFolders(() => request(300)),
    // Display-only settings (sidebar, status bar light, startup, editor lines) repaint on their own.
    vscode.workspace.onDidChangeConfiguration((e) => SCAN_SETTINGS.some((k) => e.affectsConfiguration(k)) && request(300)),
    // A mark changes only what is drawn: the stored scan is shown again, not redone.
    onDidChangeMarks(() => {
      const board = currentBoard();
      if (board && !isPanelVisible()) {
        void readMarks(context).then((marks) => {
          board.run.marks = marks;
          publishBoard(modelOf(board.run), board.run, isStoredOnly());
        });
      }
    })
  );
  const start = setTimeout(() => void paintStored().then(() => scan()), START_DELAY_MS);
  context.subscriptions.push({ dispose: () => clearTimeout(start) }, { dispose: disposeFeed });
}
