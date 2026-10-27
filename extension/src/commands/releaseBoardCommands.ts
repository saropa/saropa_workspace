import * as vscode from "vscode";
import * as path from "node:path";
import defaultRules from "../board/defaultRules.json";
import { FileSource, ScanResult, ScanSnapshot, completeFacts, scanAll, snapshotFingerprint } from "../board/scanner";
import { SafetyResult, checkScan } from "../board/safety";
import { openBoard } from "../views/boardPanel";
import { mapLimit } from "../board/pool";
import { ProjectHealth } from "../board/health";
import { collectHealth, findHealthShortcut, startHealthRecorder } from "./boardHealth";
import { toBackground } from "../exec/chainRunner";
import { exportMarksCommand, markCommand, readMarks } from "./boardMarks";
import { MarksFile } from "../board/marks";
import { ShortcutStore } from "../model/shortcutStore";
import { Profile, asProfile } from "../board/severity";
import { globToRegExp } from "../board/glob";
import { BoardConfig, ProjectDef, ScanFile, StatusCounts } from "../board/types";
import { l10n } from "../i18n/l10n";
import { bindStatusLight } from "./boardStatusLight";

// Release Board, VS Code layer: scan the open workspace folders with the
// board's rule engine, run the safety check against the last accepted scan, and print
// the result. The board core (src/board) has no VS Code imports; this file supplies the
// file source (workspace.fs, so remote workspaces work), the cache location and the
// command. Gated by saropaWorkspace.releaseBoard.enabled (on by default).

const OUTPUT_NAME = "Saropa Release Board";
const CACHE_FILE = "release-board-accepted.json";
const RULES_FILE = ".saropa/release-board.json";
// Folders a project may keep its documents in; only the ones that exist are scanned.
const DEFAULT_ROOTS = ["bugs", "docs", "plans", "reports", "db-access"];
const DEFAULT_SETS = ["folder-states", "reference-docs", "doc-kinds", "live-folders", "status-line"];

let channel: vscode.OutputChannel | undefined;

function out(): vscode.OutputChannel {
  channel ??= vscode.window.createOutputChannel(OUTPUT_NAME);
  return channel;
}

// A quiet scan that fails says so here; nothing pops up.
export function logBoardError(e: unknown): void {
  out().appendLine(`Release Board scan failed: ${e instanceof Error ? e.message : String(e)}`);
}

// FileSource over workspace.fs. Walks a root recursively; a missing root throws and the
// scanner treats it as empty.
export function workspaceFileSource(): FileSource {
  return {
    async list(projectDir: string, root: string, accept?: (path: string) => boolean): Promise<ScanFile[]> {
      const base = vscode.Uri.parse(projectDir);
      // Folders are walked in parallel and only wanted files are stat-ed, in parallel:
      // each call is a round trip, and on a remote workspace they dominate the scan.
      const walk = async (rel: string): Promise<ScanFile[]> => {
        const entries = await vscode.workspace.fs.readDirectory(vscode.Uri.joinPath(base, rel));
        const dirs: string[] = [];
        const files: string[] = [];
        for (const [name, type] of entries) {
          const childRel = rel + "/" + name;
          if (type & vscode.FileType.Directory) {
            dirs.push(childRel);
          } else if (type & vscode.FileType.File && (!accept || accept(childRel))) {
            files.push(childRel);
          }
        }
        const [stats, nested] = await Promise.all([
          mapLimit(files, 32, async (childRel): Promise<ScanFile> => {
            const st = await vscode.workspace.fs.stat(vscode.Uri.joinPath(base, childRel));
            return { path: childRel, size: st.size, mtimeMs: st.mtime };
          }),
          mapLimit(dirs, 8, walk),
        ]);
        return [...stats, ...nested.flat()];
      };
      return walk(root);
    },
    async readHead(projectDir: string, p: string, lines: number): Promise<string> {
      const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(vscode.Uri.parse(projectDir), p));
      return Buffer.from(bytes).toString("utf8").split(/\r?\n/).slice(0, lines).join("\n");
    },
    async readText(projectDir: string, p: string): Promise<string> {
      const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(vscode.Uri.parse(projectDir), p));
      return Buffer.from(bytes).toString("utf8");
    },
  };
}

async function exists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

// The rule file: the user's own `.saropa/release-board.json` in the first folder when
// present, else the rules shipped with the extension. A user file may leave out any
// section; rule sets are layered over the shipped ones. When no projects are listed,
// every workspace folder becomes one, scanning the document folders it actually has.
// Project paths become URI strings so remote and virtual workspaces resolve correctly.
async function loadConfig(): Promise<BoardConfig> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  const shipped = defaultRules as unknown as BoardConfig;
  let cfg: BoardConfig = { ...shipped };
  if (folders.length > 0) {
    const user = vscode.Uri.joinPath(folders[0].uri, RULES_FILE);
    if (await exists(user)) {
      const bytes = await vscode.workspace.fs.readFile(user);
      const parsed = JSON.parse(Buffer.from(bytes).toString("utf8")) as Partial<BoardConfig>;
      cfg = {
        ...shipped,
        ...parsed,
        ignore: parsed.ignore ?? shipped.ignore,
        ruleSets: { ...shipped.ruleSets, ...(parsed.ruleSets ?? {}) },
        projects: parsed.projects ?? [],
      };
    }
  }
  // A profile chosen in settings wins over the rules file.
  const setting = vscode.workspace.getConfiguration("saropaWorkspace.releaseBoard").inspect<Profile>("profile");
  const chosen = setting?.workspaceFolderValue ?? setting?.workspaceValue ?? setting?.globalValue;
  cfg = { ...cfg, profile: asProfile(chosen ?? cfg.profile) };
  if (cfg.projects.length > 0) {
    const base = folders[0].uri;
    const projects = cfg.projects.map((p) => ({
      ...p,
      path: (path.isAbsolute(p.path) ? (base.scheme === "file" ? vscode.Uri.file(p.path) : base.with({ path: p.path })) : vscode.Uri.joinPath(base, p.path)).toString(),
    }));
    return { ...cfg, projects };
  }
  const projects: ProjectDef[] = [];
  const used = new Set<string>();
  for (const f of folders) {
    const roots: string[] = [];
    for (const r of DEFAULT_ROOTS) {
      if (await exists(vscode.Uri.joinPath(f.uri, r))) {
        roots.push(r);
      }
    }
    // Two folders can share a name; the project id must stay unique.
    let id = f.name;
    for (let n = 2; used.has(id); n++) {
      id = `${f.name}-${n}`;
    }
    used.add(id);
    projects.push({ id, name: f.name, path: f.uri.toString(), roots, ruleSets: DEFAULT_SETS });
  }
  return { ...cfg, projects };
}

async function readAccepted(dir: vscode.Uri): Promise<ScanSnapshot | undefined> {
  try {
    const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(dir, CACHE_FILE));
    return JSON.parse(Buffer.from(bytes).toString("utf8")) as ScanSnapshot;
  } catch {
    return undefined;
  }
}

async function writeAccepted(dir: vscode.Uri, snap: ScanSnapshot): Promise<void> {
  await vscode.workspace.fs.createDirectory(dir);
  await vscode.workspace.fs.writeFile(
    vscode.Uri.joinPath(dir, CACHE_FILE),
    Buffer.from(JSON.stringify(snap), "utf8")
  );
}

function countsLine(c: StatusCounts): string {
  // Done, deferred and reference work is never printed as a count.
  return `red ${c.red} · amber ${c.amber} · purple ${c.purple} · grey ${c.grey}`;
}

export interface BoardRun {
  cfg: BoardConfig;
  result: ScanResult;
  safety: SafetyResult;
  dir: vscode.Uri;
  // The scan is the accepted baseline (clean, or the user accepted it).
  accepted: boolean;
  // The last accepted scan this run was compared with.
  previous?: ScanSnapshot;
  health: Record<string, ProjectHealth>;
  // Hand marks, shared file under local ones.
  marks: MarksFile;
}

// Gate shared by every board command. Returns false (after telling the user why) when
// the board is off or there is nothing to scan.
function ready(quiet = false): boolean {
  const enabled = vscode.workspace
    .getConfiguration("saropaWorkspace.releaseBoard")
    .get<boolean>("enabled", true);
  if (!enabled) {
    if (!quiet) {
      void vscode.window.showInformationMessage(l10n("releaseBoard.disabled"));
    }
    return false;
  }
  if (!vscode.workspace.workspaceFolders?.length) {
    if (!quiet) {
      void vscode.window.showInformationMessage(l10n("releaseBoard.noFolder"));
    }
    return false;
  }
  return true;
}

const LAST_FILE = "release-board-last.json";
let lastFingerprint = "";

// What the board last showed, kept so the next open paints at once while a fresh scan runs.
interface LastRun {
  version: 1;
  rows: ScanResult["rows"];
  snapshot: ScanSnapshot;
  accepted: boolean;
  safety: SafetyResult;
  health: Record<string, ProjectHealth>;
}

async function writeLast(dir: vscode.Uri, run: BoardRun): Promise<void> {
  const last: LastRun = { version: 1, rows: run.result.rows, snapshot: run.result.snapshot, accepted: run.accepted, safety: run.safety, health: run.health };
  await vscode.workspace.fs.createDirectory(dir);
  await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(dir, LAST_FILE), Buffer.from(JSON.stringify(last), "utf8"));
}

// The last shown board, or undefined. It is only a first paint: the caller must mark it as
// not yet refreshed and scan again.
export async function readLastRun(context: vscode.ExtensionContext): Promise<BoardRun | undefined> {
  if (!ready(true)) {
    return undefined;
  }
  try {
    const dir = context.storageUri ?? context.globalStorageUri;
    const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(dir, LAST_FILE));
    const last = JSON.parse(Buffer.from(bytes).toString("utf8")) as LastRun;
    if (last.version !== 1) {
      return undefined;
    }
    const cfg = await loadConfig();
    // Only if the same projects are configured; otherwise the old rows mean nothing.
    if (cfg.projects.some((p) => !last.snapshot.projects[p.id])) {
      return undefined;
    }
    const result: ScanResult = { rows: last.rows, snapshot: last.snapshot, pending: [], stats: { files: last.rows.length, headReads: 0, factReads: 0, ms: 0 } };
    // The accepted scan the result was compared with, so a stored paint is never greener than the real one.
    return { cfg, result, safety: last.safety, dir, accepted: last.accepted, previous: await readAccepted(dir), health: last.health, marks: await readMarks(context) };
  } catch {
    return undefined;
  }
}

// Scan, run the safety check against the last accepted scan, and store the scan as the
// new baseline only when the check found nothing. `onFirst` gets the board as soon as the
// documents are sorted, before their text is read for marks and severity.
// Every scan (the tab, the background scan, the Scan command, the pattern preview) goes
// through one chain, so two never run or write the baseline and last-result files at once.
let scanChain: Promise<unknown> = Promise.resolve();

export function runBoardScan(
  context: vscode.ExtensionContext,
  quiet = false,
  onFirst?: (run: BoardRun) => void
): Promise<BoardRun | undefined> {
  const next = scanChain.then(() => scanNow(context, quiet, onFirst));
  scanChain = next.catch(() => undefined);
  return next;
}

async function scanNow(
  context: vscode.ExtensionContext,
  quiet: boolean,
  onFirst?: (run: BoardRun) => void
): Promise<BoardRun | undefined> {
  if (!ready(quiet)) {
    return undefined;
  }
  const cfg = await loadConfig();
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
  const safety = checkScan(accepted, result.snapshot);
  const run: BoardRun = { cfg, result, safety, dir, accepted: safety.clean, previous: accepted, health, marks: await readMarks(context) };
  if (onFirst && result.pending.length > 0) {
    onFirst(run);
    await completeFacts(cfg, source, result);
  }
  const baselineChanged = !accepted || snapshotFingerprint(accepted) !== snapshotFingerprint(result.snapshot) || result.stats.headReads + result.stats.factReads > 0;
  if (safety.clean && baselineChanged) {
    await writeAccepted(dir, result.snapshot);
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
export async function acceptBoardRun(run: BoardRun): Promise<boolean> {
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
  if (pick === accept && !(await acceptBoardRun(run))) {
    void vscode.window.showWarningMessage(l10n("releaseBoard.acceptStale"));
  }
}

async function scanCommand(context: vscode.ExtensionContext): Promise<void> {
  try {
    await scan(context);
  } catch (e) {
    void vscode.window.showErrorMessage(l10n("releaseBoard.failed", { error: e instanceof Error ? e.message : String(e) }));
  }
}

const RULES_TEMPLATE = `{
  "version": 1,
  "profile": "deliberate",
  "pinned": [],
  "groups": []
}
`;

// Opens the user's rules file, creating a small one first when there is none. With a
// project id and folder it moves to that project in the file when the file names it, and
// says which folder needs a rule.
export async function openRulesFile(at?: { project: string; folder: string }): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    void vscode.window.showInformationMessage(l10n("releaseBoard.noFolder"));
    return;
  }
  const uri = vscode.Uri.joinPath(folder.uri, RULES_FILE);
  if (!(await exists(uri))) {
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(folder.uri, ".saropa"));
    await vscode.workspace.fs.writeFile(uri, Buffer.from(RULES_TEMPLATE, "utf8"));
    void vscode.window.showInformationMessage(l10n("releaseBoard.rulesCreated", { file: RULES_FILE }));
  }
  const editor = await vscode.window.showTextDocument(uri);
  if (at) {
    const text = editor.document.getText();
    const i = text.indexOf(JSON.stringify(at.project));
    if (i >= 0) {
      const pos = editor.document.positionAt(i);
      editor.selection = new vscode.Selection(pos, pos);
      editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
    }
    void vscode.window.showInformationMessage(l10n("releaseBoard.ruleFor", { folder: at.folder ? `${at.folder}/**` : "/" }));
  }
}

// Asks for a glob and reports how many documents it matches, so a rule can be checked
// before it is written. Matches the path inside each project, like a rule does.
async function previewGlob(context: vscode.ExtensionContext): Promise<void> {
  const glob = await vscode.window.showInputBox({ prompt: l10n("releaseBoard.previewPrompt") });
  if (!glob) {
    return;
  }
  const run = await runBoardScan(context);
  if (!run) {
    return;
  }
  const re = globToRegExp(glob);
  const hits = run.result.rows.filter((r) => re.test(r.path) || re.test(r.project + "/" + r.path));
  void vscode.window.showInformationMessage(
    hits.length === 0
      ? l10n("releaseBoard.previewNone", { glob })
      : l10n("releaseBoard.previewResult", { count: hits.length, glob, sample: hits.slice(0, 5).map((h) => h.path).join(", ") })
  );
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

// True when a project lives outside the open workspace folders, where no file watcher sees
// changes: the board then rescans on every open.
export function hasOutsideProject(cfg: BoardConfig): boolean {
  const roots = (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.toString());
  return cfg.projects.some((p) => !roots.some((r) => p.path === r || p.path.startsWith(r + "/")));
}

export function registerReleaseBoard(context: vscode.ExtensionContext, store: ShortcutStore): void {
  boardStore = store;
  startHealthRecorder(context, store, loadConfig);
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
    vscode.commands.registerCommand("saropaWorkspace.releaseBoard.previewGlob", () => previewGlob(context))
  );
}
