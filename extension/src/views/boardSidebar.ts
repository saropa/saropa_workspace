import { MAX_EXTRA_PROJECTS } from "../board/extraProjects";
import * as vscode from "vscode";
import { Light } from "../board/boardModel";
import { ExpandMode, SidebarBlocker, SidebarLabels, SidebarRow, asExpandMode, blockerColor, buildSidebarRows, clampBlockers, hasDocuments, lightLook } from "../board/sidebar";
import { TrainRow, trainRows } from "../board/train";
import { l10n } from "../i18n/l10n";
import { onDidChangeOvernightOffer, overnightOfferVisible } from "../commands/boardOvernight";
import { onDidChangeTrainVersions, trainsFor } from "./boardTrain";
import { SinceLast } from "../board/sinceLast";
import { currentChange, onDidChangeSinceLast, sidebarLines, whenText } from "./boardSinceLast";
import { askRefresh, currentBoard, hasFailed, isFirstScanDone, staleNote, isScanning, onDidChangeBoard } from "./boardFeed";

// The Release Board section at the top of the sidebar: one row per project with its light,
// its first blockers underneath. It only reads the published model; it never scans. A click
// on a blocker names an index into the model it was built from, and the host resolves it
// there, never from text.

// Configuration section that holds every Release Board setting; a change under it refreshes the tree.
const SETTINGS = "saropaWorkspace.releaseBoard";
// Id of the tree view contributed in package.json.
const VIEW = "saropaWorkspace.releaseBoard";
// Context key the welcome text keys off (ready, empty, failed or loading).
const STATE_KEY = "saropaWorkspace.releaseBoard.sidebarState";
// Internal command a blocker row runs; its arguments are the item index and the board stamp.
const OPEN_BLOCKER = "saropaWorkspace.releaseBoard.sidebar.openBlocker";

// The light names in the user's language, shared by the project rows and the trains.
function lightWords(): Record<Light, string> {
  return { "no-go": l10n("releaseBoard.panel.noGo"), unverified: l10n("releaseBoard.panel.unverified"), go: l10n("releaseBoard.panel.go") };
}

// The texts the sidebar rows are built from. `{count}`, `{name}` and `{names}` stay in the
// text for the pure row builder to fill.
function labels(): SidebarLabels {
  return {
    light: lightWords(),
    blockerOne: l10n("releaseBoard.sidebar.blockerOne"),
    blockerMany: l10n("releaseBoard.sidebar.blockerMany", { count: "{count}" }),
    causeLint: l10n("releaseBoard.sidebar.causeLint"),
    causeBuild: l10n("releaseBoard.sidebar.causeBuild"),
    causeDeps: l10n("releaseBoard.sidebar.causeDeps"),
    causeTests: l10n("releaseBoard.sidebar.causeTests"),
    causeBlocked: l10n("releaseBoard.sidebar.causeBlocked", { count: "{count}" }),
    causeHeld: l10n("releaseBoard.sidebar.causeHeld"),
    loweredByUser: l10n("releaseBoard.sidebar.loweredByUser", { count: "{count}" }),
    umbrella: {
      skipped: {
        missing: l10n("releaseBoard.projects.label.skip_missing"),
        notFolder: l10n("releaseBoard.projects.label.skip_notFolder"),
        unreadable: l10n("releaseBoard.projects.label.skip_unreadable"),
        overLimit: l10n("releaseBoard.projects.label.skip_overLimit", { max: MAX_EXTRA_PROJECTS }),
        timedOut: l10n("releaseBoard.projects.label.skip_timedOut"),
      },
      hidden: l10n("releaseBoard.projects.label.hidden", { count: "{count}" }),
    },
    reasons: {
      baseline: l10n("releaseBoard.panel.reasonBaseline"),
      grey: l10n("releaseBoard.panel.reasonGrey", { count: "{count}" }),
      health: l10n("releaseBoard.panel.reasonHealth"),
      unread: l10n("releaseBoard.panel.reasonUnread"),
    },
  };
}

// What a row of the tree stands for. Blockers carry the stamp of the board they came from.
type Node = { kind: "offer" } | { kind: "train"; row: TrainRow } | { kind: "since"; change: SinceLast } | { kind: "change"; text: string; details: string[] } | { kind: "project"; row: SidebarRow } | { kind: "blocker"; project: SidebarRow; blocker: SidebarBlocker; stamp: number };

// A codicon tinted with a theme color.
function themed(icon: string, color: string): vscode.ThemeIcon {
  return new vscode.ThemeIcon(icon, new vscode.ThemeColor(color));
}

// What the welcome text under the title shows.
export type SidebarState = "ready" | "empty" | "failed" | "loading";

// Picks the sidebar state. `on` is the board switched on with a folder open, `found` that
// the board has documents, `failed` that the last scan failed with no board to show.
export function sidebarState(s: { on: boolean; found: boolean; failed: boolean; firstScanDone: boolean; scanning: boolean }): SidebarState {
  if (s.found) {
    return "ready";
  }
  if (!s.on) {
    return "empty";
  }
  if (s.failed) {
    return "failed";
  }
  return !s.firstScanDone || s.scanning ? "loading" : "empty";
}

// A click on any of these opens the board tab.
function openBoardCommand(): vscode.Command {
  return { command: "saropaWorkspace.releaseBoard.open", title: l10n("releaseBoard.statusBarText") };
}

// The line that offers to turn the overnight run on.
function offerItem(): vscode.TreeItem {
  const item = new vscode.TreeItem(l10n("releaseBoard.overnight.offer"), vscode.TreeItemCollapsibleState.None);
  item.id = "offer/overnight";
  item.iconPath = new vscode.ThemeIcon("history");
  item.tooltip = l10n("releaseBoard.overnight.offerTip");
  item.contextValue = "releaseBoardOvernightOffer";
  item.command = { command: "saropaWorkspace.releaseBoard.overnight.enable", title: l10n("releaseBoard.overnight.offer") };
  return item;
}

// The "since you last looked" heading; its changes are the children.
function sinceItem(change: SinceLast): vscode.TreeItem {
  const item = new vscode.TreeItem(l10n("releaseBoard.sinceLast.title"), vscode.TreeItemCollapsibleState.Expanded);
  item.id = `since/${change.since}`;
  item.description = whenText(change.since);
  item.iconPath = new vscode.ThemeIcon("history");
  item.contextValue = "releaseBoardSince";
  item.tooltip = l10n("releaseBoard.sinceLast.tooltip");
  item.command = openBoardCommand();
  return item;
}

// One line of the change under the "since" heading.
function changeItem(text: string, details: string[]): vscode.TreeItem {
  const item = new vscode.TreeItem(text, vscode.TreeItemCollapsibleState.None);
  item.tooltip = [text, ...details].join("\n");
  item.command = openBoardCommand();
  return item;
}

// A blocker row; its click names an index into the board it was built from.
function blockerItem(project: SidebarRow, blocker: SidebarBlocker, stamp: number): vscode.TreeItem {
  const item = new vscode.TreeItem(blocker.title, vscode.TreeItemCollapsibleState.None);
  item.id = `${project.projectId}/${blocker.id}/${stamp}`;
  item.iconPath = themed("circle-filled", blockerColor(blocker.status));
  item.command = { command: OPEN_BLOCKER, title: l10n("releaseBoard.sidebar.openBlocker"), arguments: [blocker.id, stamp] };
  return item;
}

// A release train row.
function trainItem(row: TrainRow): vscode.TreeItem {
  const item = new vscode.TreeItem(row.name, vscode.TreeItemCollapsibleState.None);
  item.id = `train/${row.key}`;
  item.description = row.description;
  item.tooltip = row.tooltip.join("\n");
  item.iconPath = themed("rocket", lightLook(row.light).color);
  item.command = openBoardCommand();
  return item;
}

// A project row: expanded or collapsed by the setting, with its light as the icon. The
// expand mode is part of the id so a change of the setting takes effect at once.
function projectItem(row: SidebarRow, expandMode: ExpandMode): vscode.TreeItem {
  const state = row.blockers.length === 0 ? vscode.TreeItemCollapsibleState.None : row.expand ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed;
  const item = new vscode.TreeItem(row.name, state);
  item.id = `project/${row.projectId}/${expandMode}`;
  item.description = row.description;
  item.tooltip = row.tooltip.join("\n");
  const look = lightLook(row.light as Light);
  item.iconPath = row.note ? new vscode.ThemeIcon("info") : themed(look.icon, look.color);
  item.command = openBoardCommand();
  return item;
}

// Tree provider for the Release Board section. It rebuilds its rows from the published
// board on every refresh and keeps no scan state of its own.
class BoardSidebar implements vscode.TreeDataProvider<Node> {
  constructor(private readonly context: vscode.ExtensionContext) {}
  private readonly emitter = new vscode.EventEmitter<Node | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;
  private rows: SidebarRow[] = [];
  // Release trains: shown first, only when more than one project is found.
  private trains: TrainRow[] = [];
  private stamp = 0;
  private offer = false;
  // Part of each project row's id: a change of the expand setting then takes effect at once.
  private expandMode: ExpandMode = "whenNoGo";

  // Rebuilds the rows from the published board and the settings, tells the welcome text
  // which state applies, and repaints.
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
          light: lightWords(),
          heldBy: l10n("releaseBoard.train.heldBy", { names: "{names}" }),
          cycle: l10n("releaseBoard.train.cycle"),
        })
      : [];
    this.stamp = board?.stamp ?? 0;
    this.offer = overnightOfferVisible(this.context);
    // The welcome text under the title depends on this: loading, empty, or rows.
    const on = cfg.get<boolean>("enabled", true) && (vscode.workspace.workspaceFolders?.length ?? 0) > 0;
    const found = on && board !== undefined && hasDocuments(board.model);
    const state = sidebarState({ on, found, failed: hasFailed() && !board, firstScanDone: isFirstScanDone(), scanning: isScanning() });
    if (!found) {
      this.rows = [];
      this.trains = [];
    }
    void vscode.commands.executeCommand("setContext", STATE_KEY, state);
    this.emitter.fire(undefined);
  }

  // Maps a node to its tree row; each kind has its own builder above.
  getTreeItem(node: Node): vscode.TreeItem {
    switch (node.kind) {
      case "offer":
        return offerItem();
      case "since":
        return sinceItem(node.change);
      case "change":
        return changeItem(node.text, node.details);
      case "blocker":
        return blockerItem(node.project, node.blocker, node.stamp);
      case "train":
        return trainItem(node.row);
      case "project":
        return projectItem(node.row, this.expandMode);
    }
  }

  // Roots: the change, the trains, the projects, then the overnight offer. Children: a
  // change's lines, or a project's blockers.
  getChildren(node?: Node): Node[] {
    if (!node) {
      // The change leads the section, and only while there is one.
      const change = this.rows.length > 0 ? currentChange() : undefined;
      const rows: Node[] = [...(change ? [{ kind: "since" as const, change }] : []), ...this.trains.map((row) => ({ kind: "train" as const, row })), ...this.rows.map((row) => ({ kind: "project" as const, row }))];
      // One line under the rows, only while the overnight feature is off and not dismissed.
      return this.rows.length > 0 && this.offer ? [...rows, { kind: "offer" as const }] : rows;
    }
    if (node.kind === "since") {
      return sidebarLines(node.change).map((l) => ({ kind: "change" as const, text: l.text, details: l.details }));
    }
    if (node.kind === "change" || node.kind === "offer") {
      return [];
    }
    return node.kind === "project" ? node.row.blockers.map((blocker) => ({ kind: "blocker", project: node.row, blocker, stamp: this.stamp })) : [];
  }

  // Releases the change emitter.
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
  // The id indexes the model the row was built from; the stamp check above guarantees it is the same one.
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

// Registers the sidebar tree, its refresh triggers and the two commands (open a blocker,
// scan now), then draws it once.
export function registerBoardSidebar(context: vscode.ExtensionContext): void {
  const provider = new BoardSidebar(context);
  const refresh = (): void => provider.refresh();
  context.subscriptions.push(
    provider,
    vscode.window.registerTreeDataProvider(VIEW, provider),
    onDidChangeBoard(refresh),
    onDidChangeOvernightOffer(refresh),
    onDidChangeTrainVersions(refresh),
    onDidChangeSinceLast(refresh),
    vscode.workspace.onDidChangeConfiguration((e) => e.affectsConfiguration(SETTINGS) && refresh()),
    vscode.workspace.onDidChangeWorkspaceFolders(refresh),
    vscode.commands.registerCommand(OPEN_BLOCKER, (id: unknown, stamp: unknown) => openBlocker(id, stamp)),
    vscode.commands.registerCommand("saropaWorkspace.releaseBoard.sidebar.refresh", () => askRefresh())
  );
  refresh();
}
