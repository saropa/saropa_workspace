import * as vscode from "vscode";
import { BoardModel, buildBoard } from "../board/boardModel";
import { applyMarks, pinnedKeys } from "../board/marks";
import { asStartupMode, projectsFound, shouldOpenOnStartup } from "../board/sidebar";
import { onDidRecordHealth } from "../commands/boardHealth";
import { onDidChangeMarks, readMarks } from "../commands/boardMarks";
import { BoardRun, readLastRun, runBoardScan } from "../commands/releaseBoardCommands";
import { currentBoard, isFirstScanDone, isPanelOpen, isScanning, onDidAskRefresh, onDidChangeBoard, setScanning } from "./boardFeed";
import { openBoard } from "./boardPanel";
import { publishBoard } from "./editorLinks";

// The quiet scan behind the sidebar, the status bar light and the editor lines, so they are
// live without the board tab open. While the tab is open it owns the scan and this stays
// out of the way. Scans never overlap: a request during a scan only asks for one more pass.

const SETTINGS = "saropaWorkspace.releaseBoard";
// Same short delay the editor lines use, so startup is never in the way.
const START_DELAY_MS = 3000;

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

export function registerBoardBackground(context: vscode.ExtensionContext): void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let scanning = false;
  let again = false;
  let startupDecided = false;

  const scanOnce = async (): Promise<void> => {
    // An empty first callback keeps the scan quiet: no progress item, text read in one go.
    const run = await runBoardScan(context, true, () => undefined).catch(() => undefined);
    publishBoard(run ? modelOf(run) : undefined, run);
  };

  const scan = async (): Promise<void> => {
    if (isPanelOpen() || !boardOn()) {
      return;
    }
    if (scanning) {
      again = true;
      return;
    }
    scanning = true;
    setScanning(true);
    try {
      do {
        again = false;
        await scanOnce();
      } while (again && !isPanelOpen());
    } finally {
      scanning = false;
      setScanning(false);
    }
  };

  const request = (ms: number): void => {
    clearTimeout(timer);
    timer = setTimeout(() => void scan(), ms);
  };

  // Opens the board tab once per window, in the background, when the setting and the result allow it.
  const maybeOpenOnStartup = (): void => {
    const board = currentBoard();
    // Only after the first real scan, so the tab opens on a fresh result.
    if (startupDecided || !board || !isFirstScanDone() || isScanning()) {
      return;
    }
    const mode = asStartupMode(vscode.workspace.getConfiguration(SETTINGS).get<string>("openOnStartup", "whenProjectsFound"));
    const found = projectsFound(board.model);
    startupDecided = true;
    if (shouldOpenOnStartup(mode, found, boardOn())) {
      void openBoard(context, true);
    }
  };

  const paintStored = async (): Promise<void> => {
    if (!boardOn() || currentBoard()) {
      return;
    }
    const run = await readLastRun(context).catch(() => undefined);
    if (run && !currentBoard()) {
      publishBoard(modelOf(run), run);
    }
  };

  const underProject = (uri: vscode.Uri): boolean => {
    const projects = currentBoard()?.run.cfg.projects;
    return !projects || projects.some((p) => uri.toString().startsWith(p.path));
  };
  const changedFile = (uri: vscode.Uri): void => {
    if (!/[\\/](?:node_modules|\.git)[\\/]/.test(uri.path) && underProject(uri)) {
      request(1500);
    }
  };
  const docs = vscode.workspace.createFileSystemWatcher("**/*.{md,sql}");
  const rules = vscode.workspace.createFileSystemWatcher("**/.saropa/release-board*.json");
  for (const w of [docs, rules]) {
    w.onDidChange(changedFile);
    w.onDidCreate(changedFile);
    w.onDidDelete(changedFile);
  }

  context.subscriptions.push(
    docs,
    rules,
    { dispose: () => clearTimeout(timer) },
    onDidRecordHealth(() => request(300)),
    onDidAskRefresh(() => request(0)),
    vscode.workspace.onDidChangeWorkspaceFolders(() => request(300)),
    vscode.workspace.onDidChangeConfiguration((e) => e.affectsConfiguration(SETTINGS) && request(300)),
    // A mark changes only what is drawn: the stored scan is shown again, not redone.
    onDidChangeMarks(() => {
      const board = currentBoard();
      if (board && !isPanelOpen()) {
        void readMarks(context).then((marks) => {
          board.run.marks = marks;
          publishBoard(modelOf(board.run), board.run);
        });
      }
    }),
    onDidChangeBoard(maybeOpenOnStartup)
  );
  const start = setTimeout(() => void paintStored().then(() => scan()), START_DELAY_MS);
  context.subscriptions.push({ dispose: () => clearTimeout(start) });
}
