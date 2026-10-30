import * as vscode from "vscode";
import { BoardModel, buildBoard } from "../board/boardModel";
import { FileIndex, FileLink, MinSeverity, asMinSeverity, buildFileIndex, linksForFile, relativeTo, worstColor } from "../board/editorLinks";
import { applyMarks, pinnedKeys } from "../board/marks";
import { BoardRun, readLastRun } from "../commands/releaseBoardCommands";
import { l10n } from "../i18n/l10n";
import { currentBoard, setBoard } from "./boardFeed";
import { orgPreviousInput } from "./boardPanelActions";

// The board in the editor, VS Code layer: a CodeLens at the top of a file and a status bar
// item, both listing the open board documents that name the current file. They read the
// last board model the board tab published (or the stored last result) and never start a
// scan. When the board is off, or nothing has been scanned yet, nothing shows.

const SETTINGS = "saropaWorkspace.releaseBoard";
const OPEN_ONE = "saropaWorkspace.releaseBoard.editorLinks.openDocument";
const PICK = "saropaWorkspace.releaseBoard.editorLinks.pick";
// Names shown on the lens line before "+N more".
const LENS_NAMES = 3;
// File systems that ignore case: Windows and macOS.
const FOLD = process.platform === "win32" || process.platform === "darwin";
const STATUS_COLOR: Record<FileLink["status"], string> = { red: "charts.red", purple: "charts.purple", amber: "charts.yellow" };

interface Published {
  stamp: number;
  model: BoardModel;
  run: BoardRun;
  index: FileIndex;
}

let state: Published | undefined;
let stamp = 0;
const changed = new vscode.EventEmitter<void>();

// Called by the board tab after each paint (undefined when the board has nothing to show).
export function publishBoard(model: BoardModel | undefined, run: BoardRun | undefined, stored = false): void {
  setBoard(model, run, stored);
  if (!model || !run) {
    state = undefined;
  } else {
    const snap = run.result.snapshot;
    const index = buildFileIndex(model.items, (it) => snap.projects[it.project]?.facts[it.path]?.facts, FOLD);
    state = { stamp: ++stamp, model, run, index };
  }
  changed.fire();
}

function settings(): { on: boolean; lens: boolean; bar: boolean; min: MinSeverity } {
  const board = vscode.workspace.getConfiguration(SETTINGS);
  const on = board.get<boolean>("enabled", true) && board.get<boolean>("editorLinks.enabled", true);
  return {
    on,
    lens: on && board.get<boolean>("editorLinks.codeLens", true),
    bar: on && board.get<boolean>("editorLinks.statusBar", true),
    min: asMinSeverity(board.get<string>("editorLinks.minSeverity", "any")),
  };
}

// The documents naming a file, from every project the file sits in.
function linksFor(uri: vscode.Uri, min: MinSeverity): FileLink[] {
  if (!state) {
    return [];
  }
  const out: FileLink[] = [];
  for (const p of state.run.cfg.projects) {
    const base = vscode.Uri.parse(p.path);
    if (base.scheme !== uri.scheme || (FOLD ? base.authority.toLowerCase() !== uri.authority.toLowerCase() : base.authority !== uri.authority)) {
      continue;
    }
    const rel = relativeTo(base.path, uri.path, FOLD);
    if (rel !== undefined) {
      out.push(...linksForFile(state.index, p.id, rel, FOLD, min));
    }
  }
  return out;
}

const statusWord = (s: FileLink["status"]): string => l10n(`editorLinks.status.${s}`);

function cappedNotes(links: FileLink[]): string[] {
  return links.filter((l) => l.capped).map((l) => l10n("editorLinks.capped", { title: l.title }));
}

async function openDocument(id: number, at: number): Promise<void> {
  const item = state && state.stamp === at ? state.model.items[id] : undefined;
  const project = state?.run.cfg.projects.find((p) => p.id === item?.project);
  if (item && project) {
    try {
      await vscode.window.showTextDocument(vscode.Uri.joinPath(vscode.Uri.parse(project.path), item.path), { preview: true });
    } catch (e) {
      void vscode.window.showErrorMessage(l10n("releaseBoard.failed", { error: e instanceof Error ? e.message : String(e) }));
    }
  }
}

// `owner` is the file the lens sits in; the status bar passes nothing and uses the active editor.
async function pick(owner?: unknown): Promise<void> {
  const uri = owner instanceof vscode.Uri ? owner : vscode.window.activeTextEditor?.document.uri;
  const at = state?.stamp;
  if (!uri || at === undefined) {
    return;
  }
  const links = linksFor(uri, settings().min);
  if (links.length === 0) {
    return;
  }
  if (links.length === 1) {
    await openDocument(links[0].id, at);
    return;
  }
  const chosen = await vscode.window.showQuickPick(
    links.map((l) => ({ label: l.title, description: statusWord(l.status), detail: l.capped ? l10n("editorLinks.capped", { title: l.title }) : undefined, id: l.id })),
    { placeHolder: l10n("editorLinks.pickPlaceholder") }
  );
  if (chosen) {
    await openDocument(chosen.id, at);
  }
}

class Lenses implements vscode.CodeLensProvider {
  readonly onDidChangeCodeLenses = changed.event;

  provideCodeLenses(doc: vscode.TextDocument): vscode.CodeLens[] {
    const s = settings();
    if (!s.lens || !state) {
      return [];
    }
    const links = linksFor(doc.uri, s.min);
    if (links.length === 0) {
      return [];
    }
    const range = new vscode.Range(0, 0, 0, 0);
    const notes = cappedNotes(links);
    const summary = new vscode.CodeLens(range, {
      title: l10n(links.length === 1 ? "editorLinks.summaryOne" : "editorLinks.summaryMany", { count: links.length }),
      tooltip: notes.length > 0 ? notes.join("\n") : l10n("editorLinks.summaryTooltip"),
      command: PICK,
      arguments: [doc.uri],
    });
    const named = links.slice(0, LENS_NAMES).map(
      (l) =>
        new vscode.CodeLens(range, {
          title: `${l.title} (${statusWord(l.status)})`,
          tooltip: l.capped ? l10n("editorLinks.capped", { title: l.title }) : l10n("editorLinks.openTooltip", { title: l.title }),
          command: OPEN_ONE,
          arguments: [l.id, state!.stamp],
        })
    );
    const rest = links.length - named.length;
    if (rest > 0) {
      named.push(new vscode.CodeLens(range, { title: l10n("editorLinks.more", { count: rest }), command: PICK, arguments: [doc.uri] }));
    }
    return [summary, ...named];
  }
}

function updateBar(bar: vscode.StatusBarItem): void {
  const s = settings();
  const uri = vscode.window.activeTextEditor?.document.uri;
  const links = s.bar && uri ? linksFor(uri, s.min) : [];
  const worst = worstColor(links);
  if (!worst) {
    bar.hide();
    return;
  }
  bar.text = `$(circle-filled) ${links.length}`;
  bar.color = new vscode.ThemeColor(STATUS_COLOR[worst]);
  bar.tooltip = [
    l10n(links.length === 1 ? "editorLinks.summaryOne" : "editorLinks.summaryMany", { count: links.length }),
    ...links.map((l) => `${l.title} (${statusWord(l.status)})`),
    ...cappedNotes(links),
  ].join("\n");
  bar.show();
}

// Builds the board from the stored last result when the board tab has not published yet.
async function loadStored(context: vscode.ExtensionContext): Promise<void> {
  // A board already published (by a scan) is newer than the stored one.
  if (state || currentBoard() || !settings().on) {
    return;
  }
  const run = await readLastRun(context).catch(() => undefined);
  if (!run || state || currentBoard()) {
    return;
  }
  const model = buildBoard(run.cfg, applyMarks(run.result.rows, run.marks), run.safety, run.accepted, run.result.snapshot, run.previous, run.health, {
    needs: run.marks.needs,
    rejected: run.marks.rejected,
    pins: pinnedKeys(run.marks),
    orgPrevious: orgPreviousInput(context),
  });
  publishBoard(model, run, true);
}

/** Registers the editor links status bar item, code lenses and pick command. */
export function registerEditorLinks(context: vscode.ExtensionContext): void {
  const bar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 90);
  bar.name = l10n("editorLinks.statusBarName");
  bar.command = PICK;
  const refresh = (): void => updateBar(bar);
  context.subscriptions.push(
    bar,
    changed,
    vscode.languages.registerCodeLensProvider({ scheme: "*" }, new Lenses()),
    vscode.commands.registerCommand(OPEN_ONE, (id: unknown, at: unknown) => (typeof id === "number" && typeof at === "number" ? openDocument(id, at) : undefined)),
    vscode.commands.registerCommand(PICK, (owner?: unknown) => pick(owner)),
    changed.event(refresh),
    vscode.window.onDidChangeActiveTextEditor(refresh),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration(SETTINGS)) {
        // The scans publish a fresh board when the projects change; this only repaints.
        void loadStored(context).then(() => {
          changed.fire();
        });
      }
    })
  );
  // Never in the way of startup: the stored result is read a little later.
  const timer = setTimeout(() => void loadStored(context), 3000);
  context.subscriptions.push({ dispose: () => clearTimeout(timer) });
  refresh();
}
