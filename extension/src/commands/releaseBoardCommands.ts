import * as vscode from "vscode";
import * as path from "node:path";
import defaultRules from "../board/defaultRules.json";
import { FileSource, ScanSnapshot, scanAll } from "../board/scanner";
import { checkScan } from "../board/safety";
import { BoardConfig, ProjectDef, ScanFile, StatusCounts } from "../board/types";
import { l10n } from "../i18n/l10n";

// Release Board, VS Code layer for step 1: scan the open workspace folders with the
// board's rule engine, run the safety check against the last accepted scan, and print
// the result. The board core (src/board) has no VS Code imports; this file supplies the
// file source (workspace.fs, so remote workspaces work), the cache location and the
// command. Gated by saropaWorkspace.releaseBoard.enabled (off by default).

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

// FileSource over workspace.fs. Walks a root recursively; a missing root throws and the
// scanner treats it as empty.
export function workspaceFileSource(): FileSource {
  return {
    async list(projectDir: string, root: string): Promise<ScanFile[]> {
      const files: ScanFile[] = [];
      const base = vscode.Uri.file(projectDir);
      const walk = async (rel: string): Promise<void> => {
        const dir = vscode.Uri.joinPath(base, rel);
        for (const [name, type] of await vscode.workspace.fs.readDirectory(dir)) {
          const childRel = rel + "/" + name;
          if (type & vscode.FileType.Directory) {
            await walk(childRel);
          } else if (type & vscode.FileType.File) {
            const st = await vscode.workspace.fs.stat(vscode.Uri.joinPath(base, childRel));
            files.push({ path: childRel, size: st.size, mtimeMs: st.mtime });
          }
        }
      };
      await walk(root);
      return files;
    },
    async readHead(projectDir: string, p: string, lines: number): Promise<string> {
      const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(vscode.Uri.file(projectDir), p));
      return Buffer.from(bytes).toString("utf8").split(/\r?\n/).slice(0, lines).join("\n");
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
// present, else the rules shipped with the extension. When the file lists no projects,
// every workspace folder becomes one, scanning the document folders it actually has.
async function loadConfig(): Promise<BoardConfig> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  let cfg = defaultRules as unknown as BoardConfig;
  if (folders.length > 0) {
    const user = vscode.Uri.joinPath(folders[0].uri, RULES_FILE);
    if (await exists(user)) {
      const bytes = await vscode.workspace.fs.readFile(user);
      cfg = JSON.parse(Buffer.from(bytes).toString("utf8")) as BoardConfig;
    }
  }
  if (cfg.projects.length > 0) {
    return cfg;
  }
  const projects: ProjectDef[] = [];
  for (const f of folders) {
    const roots: string[] = [];
    for (const r of DEFAULT_ROOTS) {
      if (await exists(vscode.Uri.joinPath(f.uri, r))) {
        roots.push(r);
      }
    }
    projects.push({
      id: f.name,
      name: f.name,
      path: f.uri.fsPath,
      roots,
      ruleSets: DEFAULT_SETS,
    });
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

async function scanCommand(context: vscode.ExtensionContext): Promise<void> {
  const enabled = vscode.workspace
    .getConfiguration("saropaWorkspace.releaseBoard")
    .get<boolean>("enabled", false);
  if (!enabled) {
    void vscode.window.showInformationMessage(l10n("releaseBoard.disabled"));
    return;
  }
  if (!vscode.workspace.workspaceFolders?.length) {
    void vscode.window.showInformationMessage(l10n("releaseBoard.noFolder"));
    return;
  }
  const cfg = await loadConfig();
  const dir = context.globalStorageUri;
  const accepted = await readAccepted(dir);
  const result = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Window, title: l10n("releaseBoard.scanning") },
    () => scanAll(cfg, workspaceFileSource(), accepted)
  );
  const safety = checkScan(accepted, result.snapshot);
  const o = out();
  o.clear();
  o.appendLine(l10n("releaseBoard.heading", { time: new Date(result.snapshot.takenAt).toLocaleString() }));
  for (const p of cfg.projects) {
    o.appendLine(`${p.name ?? p.id}: ${countsLine(result.snapshot.projects[p.id].counts)}`);
    const grey = Object.entries(result.snapshot.projects[p.id].greyFolders);
    for (const [folder, n] of grey) {
      o.appendLine(`  ${l10n("releaseBoard.needsRule", { folder: folder || path.sep, count: n })}`);
    }
  }
  if (safety.baseline) {
    o.appendLine(l10n("releaseBoard.baseline"));
  }
  for (const f of safety.findings) {
    o.appendLine(`[${f.severity}] ${f.project}: ${f.text}`);
  }
  o.show(true);
  if (safety.clean) {
    await writeAccepted(dir, result.snapshot);
    return;
  }
  const accept = l10n("releaseBoard.accept");
  const pick = await vscode.window.showWarningMessage(
    safety.baseline ? l10n("releaseBoard.acceptBaseline") : l10n("releaseBoard.held", { count: safety.findings.length }),
    accept
  );
  if (pick === accept) {
    await writeAccepted(dir, result.snapshot);
  }
}

export function registerReleaseBoard(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("saropaWorkspace.releaseBoard.scan", () => scanCommand(context))
  );
}
