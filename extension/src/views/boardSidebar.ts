import * as vscode from "vscode";
import { Light } from "../board/boardModel";
import { ExpandMode, SidebarBlocker, SidebarLabels, SidebarRow, asExpandMode, blockerColor, buildSidebarRows, clampBlockers, hasDocuments, lightLook } from "../board/sidebar";
import { TrainRow, trainRows } from "../board/train";
import { l10n } from "../i18n/l10n";
import { onDidChangeTrainVersions, trainsFor } from "./boardTrain";
import { SinceLast } from "../board/sinceLast";
import { currentChange, onDidChangeSinceLast, sidebarLines, whenText } from "./boardSinceLast";
import { askRefresh, currentBoard, hasFailed, isFirstScanDone, staleNote, isScanning, onDidChangeBoard } from "./boardFeed";

// The Release Board section at the top of the sidebar: one row per project with its light,
// its first blockers underneath. It only reads the published model; it never scans. A click
// on a blocker names an index into the model it was built from, and the host resolves it
// there, never from text.

const SETTINGS = "saropaWorkspace.releaseBoard";
const VIEW = "saropaWorkspace.releaseBoard";
const STATE_KEY = "saropaWorkspace.releaseBoard.sidebarState";
const OPEN_BLOCKER = "saropaWorkspace.releaseBoard.sidebar.openBlocker";

function labels(): SidebarLabels {
  return {
    light: { "no-go": l10n("releaseBoard.panel.noGo"), unverified: l10n("releaseBoard.panel.unverified"), go: l10n("releaseBoard.panel.go") },
    blockerOne: l10n("releaseBoard.sidebar.blockerOne"),
    blockerMany: l10n("releaseBoard.sidebar.blockerMany", { count: "{count}" }),
    causeLint: l10n("releaseBoard.sidebar.causeLint"),
    causeTests: l10n("releaseBoard.sidebar.causeTests"),
    causeBlocked: l10n("releaseBoard.sidebar.causeBlocked", { count: "{count}" }),
    causeHeld: l10n("releaseBoard.sidebar.causeHeld"),
    reasons: {
      baseline: l10n("releaseBoard.panel.reasonBaseline"),
      grey: l10n("releaseBoard.panel.reasonGrey", { count: "{count}" }),
      health: l10n("releaseBoard.panel.reasonHealth"),
      unread: l10n("releaseBoard.panel.reasonUnread"),
    },
  };
}

type Node = { kind: "train"; row: TrainRow } | { kind: "since"; change: SinceLast } | { kind: "change"; text: string; details: string[] } | { kind: "project"; row: SidebarRow } | { kind: "blocker"; project: SidebarRow; blocker: SidebarBlocker; stamp: number };

function themed(icon: string, color: string): vscode.ThemeIcon {
  return new vscode.ThemeIcon(icon, new vscode.ThemeColor(color));
}

class BoardSidebar implements vscode.TreeDataProvider<Node> {
  private readonly emitter = new vscode.EventEmitter<Node | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;
  private rows: SidebarRow[] = [];
  // Release trains: shown first, only when more than one project is found.
  private trains: TrainRow[] = [];
  private stamp = 0;
  // Part of each project row's id: a change of the expand setting then takes effect at once.
  private expandMode: ExpandMode = "whenNoGo";

  refresh(): void {
    const board = currentBoard();
    const cfg = vscode.workspace.getConfiguration(SETTINGS);
    this.expandMode = asExpandMode(cfg.get("sidebar.expandProjects", "whenNoGo"));
    this.rows = board
      ? buildSidebarRows(
          board.model,
          { blockersPerProject: clampBlockers(cfg.get("sidebar.blockersPerProject", 3)), expandProjects: this.expandMode, staleNote: staleNote() },
          labels()
        )
      : [];
    this.trains = board
      ? trainRows(trainsFor(board.model, board.run.cfg), {
          title: l10n("releaseBoard.train.title", { name: "{name}" }),
          light: { "no-go": l10n("releaseBoard.panel.noGo"), unverified: l10n("releaseBoard.panel.unverified"), go: l10n("releaseBoard.panel.go") },
          heldBy: l10n("releaseBoard.train.heldBy", { names: "{names}" }),
          cycle: l10n("releaseBoard.train.cycle"),
        })
      : [];
    this.stamp = board?.stamp ?? 0;
    // The welcome text under the title depends on this: loading, empty, or rows.
    const on = cfg.get<boolean>("enabled", true) && (vscode.workspace.workspaceFolders?.length ?? 0) > 0;
    const found = on && board !== undefined && hasDocuments(board.model);
    const state = found ? "ready" : !on ? "empty" : hasFailed() && !board ? "failed" : !isFirstScanDone() || isScanning() ? "loading" : "empty";
    if (!found) {
      this.rows = [];
      this.trains = [];
    }
    void vscode.commands.executeCommand("setContext", STATE_KEY, state);
    this.emitter.fire(undefined);
  }

  getTreeItem(node: Node): vscode.TreeItem {
    if (node.kind === "since") {
      const item = new vscode.TreeItem(l10n("releaseBoard.sinceLast.title"), vscode.TreeItemCollapsibleState.Expanded);
      item.id = `since/${node.change.since}`;
      item.description = whenText(node.change.since);
      item.iconPath = new vscode.ThemeIcon("history");
      item.contextValue = "releaseBoardSince";
      item.tooltip = l10n("releaseBoard.sinceLast.tooltip");
      item.command = { command: "saropaWorkspace.releaseBoard.open", title: l10n("releaseBoard.statusBarText") };
      return item;
    }
    if (node.kind === "change") {
      const item = new vscode.TreeItem(node.text, vscode.TreeItemCollapsibleState.None);
      item.tooltip = [node.text, ...node.details].join("\n");
      item.command = { command: "saropaWorkspace.releaseBoard.open", title: l10n("releaseBoard.statusBarText") };
      return item;
    }
    if (node.kind === "blocker") {
      const item = new vscode.TreeItem(node.blocker.title, vscode.TreeItemCollapsibleState.None);
      item.id = `${node.project.projectId}/${node.blocker.id}/${node.stamp}`;
      item.iconPath = themed("circle-filled", blockerColor(node.blocker.status));
      item.command = { command: OPEN_BLOCKER, title: l10n("releaseBoard.sidebar.openBlocker"), arguments: [node.blocker.id, node.stamp] };
      return item;
    }
    if (node.kind === "train") {
      const item = new vscode.TreeItem(node.row.name, vscode.TreeItemCollapsibleState.None);
      item.id = `train/${node.row.key}`;
      item.description = node.row.description;
      item.tooltip = node.row.tooltip.join("\n");
      const look = lightLook(node.row.light);
      item.iconPath = themed("rocket", look.color);
      item.command = { command: "saropaWorkspace.releaseBoard.open", title: l10n("releaseBoard.statusBarText") };
      return item;
    }
    const row = node.row;
    const state = row.blockers.length === 0 ? vscode.TreeItemCollapsibleState.None : row.expand ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed;
    const item = new vscode.TreeItem(row.name, state);
    item.id = `project/${row.projectId}/${this.expandMode}`;
    item.description = row.description;
    item.tooltip = row.tooltip.join("\n");
    const look = lightLook(row.light as Light);
    item.iconPath = themed(look.icon, look.color);
    item.command = { command: "saropaWorkspace.releaseBoard.open", title: l10n("releaseBoard.statusBarText") };
    return item;
  }

  getChildren(node?: Node): Node[] {
    if (!node) {
      // The change leads the section, and only while there is one.
      const change = this.rows.length > 0 ? currentChange() : undefined;
      return [...(change ? [{ kind: "since" as const, change }] : []), ...this.trains.map((row) => ({ kind: "train" as const, row })), ...this.rows.map((row) => ({ kind: "project" as const, row }))];
    }
    if (node.kind === "since") {
      return sidebarLines(node.change).map((l) => ({ kind: "change" as const, text: l.text, details: l.details }));
    }
    if (node.kind === "change") {
      return [];
    }
    return node.kind === "project" ? node.row.blockers.map((blocker) => ({ kind: "blocker", project: node.row, blocker, stamp: this.stamp })) : [];
  }

  dispose(): void {
    this.emitter.dispose();
  }
}

// Opens the document behind a row, if the row still belongs to the board on screen.
async function openBlocker(id: unknown, stamp: unknown): Promise<void> {
  const board = currentBoard();
  if (!board || typeof id !== "number" || stamp !== board.stamp) {
    return;
  }
  const item = board.model.items[id];
  const project = board.run.cfg.projects.find((p) => p.id === item?.project);
  if (!item || !project) {
    return;
  }
  try {
    await vscode.window.showTextDocument(vscode.Uri.joinPath(vscode.Uri.parse(project.path), item.path), { preview: true });
  } catch (e) {
    void vscode.window.showErrorMessage(l10n("releaseBoard.failed", { error: e instanceof Error ? e.message : String(e) }));
  }
}

export function registerBoardSidebar(context: vscode.ExtensionContext): void {
  const provider = new BoardSidebar();
  const refresh = (): void => provider.refresh();
  context.subscriptions.push(
    provider,
    vscode.window.registerTreeDataProvider(VIEW, provider),
    onDidChangeBoard(refresh),
    onDidChangeTrainVersions(refresh),
    onDidChangeSinceLast(refresh),
    vscode.workspace.onDidChangeConfiguration((e) => e.affectsConfiguration(SETTINGS) && refresh()),
    vscode.workspace.onDidChangeWorkspaceFolders(refresh),
    vscode.commands.registerCommand(OPEN_BLOCKER, (id: unknown, stamp: unknown) => openBlocker(id, stamp)),
    vscode.commands.registerCommand("saropaWorkspace.releaseBoard.sidebar.refresh", () => askRefresh())
  );
  refresh();
}
