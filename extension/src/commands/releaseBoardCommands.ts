import * as vscode from "vscode";
import * as path from "node:path";
import { ScanResult, completeFacts, dropFailed, scanAll, snapshotFingerprint } from "../board/scanner";
import { checkScan } from "../board/safety";
import { openBoard } from "../views/boardPanel";
import { ProjectHealth } from "../board/health";
import { collectHealth, findHealthShortcut, startHealthRecorder } from "./boardHealth";
import { enableFeedSchedule } from "./boardRecipeEvidence";
import { registerBoardOvernight } from "./boardOvernight";
import { toBackground } from "../exec/chainRunner";
import { exportMarksCommand, markCommand, readMarks } from "./boardMarks";
import { ShortcutStore } from "../model/shortcutStore";
import { BoardConfig, ProjectDef, StatusCounts } from "../board/types";
import { l10n } from "../i18n/l10n";
import { withTimeout } from "../board/timeout";
import { bindStatusLight } from "./boardStatusLight";
import { workspaceFileSource } from "./boardFileSource";
import { DEFAULT_ROOTS, boardReady, loadConfig } from "./boardConfigLoad";
import { BoardRun, readAccepted, readLastRun, writeAccepted, writeLast } from "./boardScanStore";
import { openRulesFile, previewGlob } from "./boardRules";
import { chooseProjects, openBoardSettings } from "../views/boardProjectsFlow";

// Release Board, VS Code layer: the scan flow. It runs one queued scan of the open workspace
// folders with the board's rule engine, checks it against the last accepted scan, stores the
// baseline, prints the result and registers the board commands and the status bar button.
// The board core (src/board) has no VS Code imports. The file source (workspace.fs, so
// remote workspaces work), rule loading, stored scans and rules-file helpers live in the
// sibling board*.ts modules; the exports callers use are re-exported here.
// Gated by saropaWorkspace.releaseBoard.enabled (on by default).

export type { BoardRun };
export { DEFAULT_ROOTS, readLastRun, openRulesFile };

const OUTPUT_NAME = "Saropa Release Board";

let channel: vscode.OutputChannel | undefined;

function out(): vscode.OutputChannel {
  channel ??= vscode.window.createOutputChannel(OUTPUT_NAME);
  return channel;
}

// A quiet scan that fails says so here; nothing pops up.
export function logBoardError(e: unknown): void {
  out().appendLine(`Release Board scan failed: ${e instanceof Error ? e.message : String(e)}`);
}

// The status counts as one output line.
function countsLine(c: StatusCounts): string {
  // Done, deferred and reference work is never printed as a count.
  return `red ${c.red} · amber ${c.amber} · purple ${c.purple} · grey ${c.grey}`;
}

// The fingerprint of the last result written, so an unchanged board is not written again.
let lastFingerprint = "";

// Every scan (the tab, the background scan, the Scan command, the pattern preview) goes
// through one chain, so two never run or write the baseline and last-result files at once.
let scanChain: Promise<unknown> = Promise.resolve();
// A scan that takes longer is abandoned so the queue moves on; it reports a failure.
const SCAN_TIMEOUT_MS = 120 * 1000;

// Set when a scan is abandoned: it must not call back or write files afterwards.
interface Abandon {
  gone: boolean;
}

// Scan, run the safety check against the last accepted scan, and store the scan as the
// new baseline only when the check found nothing. `onFirst` gets the board as soon as the
// documents are sorted, before their text is read for marks and severity.
export function runBoardScan(
  context: vscode.ExtensionContext,
  quiet = false,
  onFirst?: (run: BoardRun) => void
): Promise<BoardRun | undefined> {
  const next = scanChain.then(() => {
    const token: Abandon = { gone: false };
    return withTimeout(scanNow(context, quiet, onFirst, token), SCAN_TIMEOUT_MS, () => (token.gone = true));
  });
  scanChain = next.catch(() => undefined);
  return next;
}

async function scanNow(
  context: vscode.ExtensionContext,
  quiet: boolean,
  onFirst: ((run: BoardRun) => void) | undefined,
  token: Abandon
): Promise<BoardRun | undefined> {
  if (!boardReady(quiet)) {
    return undefined;
  }
  let cfg = await loadConfig();
  // Per workspace: another workspace must never see or overwrite this baseline.
  const dir = context.storageUri ?? context.globalStorageUri;
  const accepted = await readAccepted(dir);
  const source = workspaceFileSource();
  const work = (): Promise<[ScanResult, Record<string, ProjectHealth>]> =>
    Promise.all([
      scanAll(cfg, source, accepted, Date.now(), onFirst ? "cached" : "all"),
      boardStore ? collectHealth(context, boardStore, cfg) : Promise.resolve({} as Record<string, ProjectHealth>),
    ]);
  // The board tab has its own progress bar; the commands show one in the status bar.
  const [result, health] = onFirst
    ? await work()
    : await vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: l10n("releaseBoard.scanning") }, work);
  cfg = dropFailed(cfg, result.failed);
  const safety = checkScan(accepted, result.snapshot);
  const run: BoardRun = { cfg, result, safety, dir, accepted: safety.clean, previous: accepted, health, marks: await readMarks(context) };
  if (onFirst && result.pending.length > 0) {
    if (!token.gone) {
      onFirst(run);
    }
    await completeFacts(cfg, source, result);
  }
  if (token.gone) {
    throw new Error("scan abandoned");
  }
  const baselineChanged = !accepted || snapshotFingerprint(accepted) !== snapshotFingerprint(result.snapshot) || result.stats.headReads + result.stats.factReads > 0;
  if (safety.clean && baselineChanged) {
    await writeAccepted(dir, result.snapshot);
  }
  if (token.gone) {
    throw new Error("scan abandoned");
  }
  // The stored last result also holds the health marks and the accepted state.
  if (baselineChanged || snapshotFingerprint(result.snapshot, health) !== lastFingerprint) {
    lastFingerprint = snapshotFingerprint(result.snapshot, health);
    await writeLast(dir, run).catch(() => undefined);
  }
  out().appendLine(`Release Board scan: ${result.stats.files} files, ${result.stats.headReads} heads and ${result.stats.factReads} documents read, ${result.stats.ms} ms`);
  return run;
}

// Stores the scan as the baseline. Refused (false) when the stored baseline is no longer
// the one this scan was compared with: the user must look at a fresh scan first.
export function acceptBoardRun(run: BoardRun): Promise<boolean> {
  const next = scanChain.then(() => withTimeout(acceptNow(run), SCAN_TIMEOUT_MS));
  scanChain = next.catch(() => undefined);
  return next;
}

async function acceptNow(run: BoardRun): Promise<boolean> {
  const stored = await readAccepted(run.dir);
  if ((stored?.takenAt ?? 0) !== (run.previous?.takenAt ?? 0)) {
    return false;
  }
  await writeAccepted(run.dir, run.result.snapshot);
  run.accepted = true;
  await writeLast(run.dir, run).catch(() => undefined);
  return true;
}

async function scan(context: vscode.ExtensionContext): Promise<void> {
  const run = await runBoardScan(context);
  if (!run) {
    return;
  }
  const { cfg, result, safety } = run;
  const o = out();
  o.clear();
  o.appendLine(l10n("releaseBoard.heading", { time: new Date(result.snapshot.takenAt).toLocaleString() }));
  for (const p of cfg.projects) {
    o.appendLine(`${p.name ?? p.id}: ${countsLine(result.snapshot.projects[p.id].counts)}`);
    for (const [folder, n] of Object.entries(result.snapshot.projects[p.id].greyFolders)) {
      o.appendLine(`  ${l10n("releaseBoard.needsRule", { folder: folder || path.sep, count: n })}`);
    }
  }
  if (safety.baseline) {
    o.appendLine(l10n("releaseBoard.baseline"));
  }
  for (const f of safety.findings) {
    o.appendLine(`${f.project}: ${f.text}`);
  }
  o.show(true);
  if (run.accepted) {
    return;
  }
  const accept = l10n("releaseBoard.accept");
  const pick = await vscode.window.showWarningMessage(
    safety.baseline ? l10n("releaseBoard.acceptBaseline") : l10n("releaseBoard.held", { count: safety.findings.length }),
    accept
  );
  if (pick === accept) {
    if (await acceptBoardRun(run)) {
      // The sidebar, status light and editor lines pick the accepted baseline up.
      void vscode.commands.executeCommand("saropaWorkspace.releaseBoard.sidebar.refresh");
    } else {
      void vscode.window.showWarningMessage(l10n("releaseBoard.acceptStale"));
    }
  }
}

async function scanCommand(context: vscode.ExtensionContext): Promise<void> {
  try {
    await scan(context);
  } catch (e) {
    void vscode.window.showErrorMessage(l10n("releaseBoard.failed", { error: e instanceof Error ? e.message : String(e) }));
  }
}

// The shortcut store, for resolving the shortcuts a project names as its test and lint runs.
let boardStore: ShortcutStore | undefined;

// True when the project names a shortcut for this evidence and the board can start it.
export function canRunHealth(project: ProjectDef, kind: "lint" | "tests"): boolean {
  return boardStore !== undefined && findHealthShortcut(boardStore, project, kind) !== undefined;
}

// Starts the shortcut the project names as its lint or test run, in the background only:
// that is the one mode with an exit code the board trusts. boardHealth.ts records the
// result when the run ends. Returns false when no shortcut is named.
export async function runHealthNow(project: ProjectDef, kind: "lint" | "tests"): Promise<boolean> {
  const shortcut = boardStore ? findHealthShortcut(boardStore, project, kind) : undefined;
  if (!shortcut) {
    return false;
  }
  await vscode.commands.executeCommand("saropaWorkspace.runPin", toBackground(shortcut));
  return true;
}

// Turns on the daily report of the recipe that feeds a row. The page names only the project and
// the row; the recipe is found here. Returns false when the project has no such recipe.
export async function enableDailyReport(project: ProjectDef, feed: "build" | "lint" | "tests"): Promise<boolean> {
  return boardStore ? enableFeedSchedule(boardStore, project, feed) : false;
}

// True when a project lives outside the open workspace folders, where no file watcher sees
// changes: the board then rescans on every open.
export function hasOutsideProject(cfg: BoardConfig): boolean {
  const roots = (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.toString());
  return cfg.projects.some((p) => !roots.some((r) => p.path === r || p.path.startsWith(r + "/")));
}

// Registers the board commands and the status bar button, and starts the health recorder
// and the overnight run.
export function registerReleaseBoard(context: vscode.ExtensionContext, store: ShortcutStore): void {
  boardStore = store;
  startHealthRecorder(context, store, loadConfig);
  registerBoardOvernight(context, store, loadConfig);
  // One click from anywhere in the window; shown while the board is on.
  const button = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 1);
  button.name = l10n("releaseBoard.statusBarName");
  button.text = "$(checklist) " + l10n("releaseBoard.statusBarText");
  button.tooltip = l10n("releaseBoard.statusBarTooltip");
  button.command = "saropaWorkspace.releaseBoard.open";
  const showButton = (): void => {
    if (vscode.workspace.getConfiguration("saropaWorkspace.releaseBoard").get<boolean>("enabled", true)) {
      button.show();
    } else {
      button.hide();
    }
  };
  showButton();
  context.subscriptions.push(
    button,
    bindStatusLight(button),
    vscode.workspace.onDidChangeConfiguration((e) => e.affectsConfiguration("saropaWorkspace.releaseBoard.enabled") && showButton()),
    vscode.commands.registerCommand("saropaWorkspace.releaseBoard.scan", () => scanCommand(context)),
    vscode.commands.registerCommand("saropaWorkspace.releaseBoard.open", () => openBoard(context)),
    vscode.commands.registerCommand("saropaWorkspace.releaseBoard.mark", () => markCommand(context, loadConfig)),
    vscode.commands.registerCommand("saropaWorkspace.releaseBoard.exportMarks", () => exportMarksCommand(context)),
    vscode.commands.registerCommand("saropaWorkspace.releaseBoard.openRules", () => openRulesFile()),
    vscode.commands.registerCommand("saropaWorkspace.releaseBoard.openSettings", () => openBoardSettings()),
    vscode.commands.registerCommand("saropaWorkspace.releaseBoard.projects", () => chooseProjects()),
    vscode.commands.registerCommand("saropaWorkspace.releaseBoard.previewGlob", () => previewGlob(() => runBoardScan(context)))
  );
}
