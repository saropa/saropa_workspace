import * as crypto from "node:crypto";
import * as vscode from "vscode";
import { BoardRun, acceptBoardRun, runBoardScan } from "../commands/releaseBoardCommands";
import { buildBoard, BoardModel } from "../board/boardModel";
import { BoardStrings, renderBoard } from "../board/boardHtml";
import { l10n } from "../i18n/l10n";

// The Release Board first screen, an editor-tab webview. One instance: opening it again
// reveals it and rescans. The page is static HTML under a strict CSP; its only messages
// are "refresh", "accept" and "open <id>", and the host resolves the id against the model
// it rendered, so the page can never name an arbitrary path.

let current: BoardPanel | undefined;

function strings(): BoardStrings {
  return {
    title: l10n("releaseBoard.panel.title"),
    intro: l10n("releaseBoard.panel.intro"),
    noGo: l10n("releaseBoard.panel.noGo"),
    unverified: l10n("releaseBoard.panel.unverified"),
    resolveNow: l10n("releaseBoard.panel.resolveNow"),
    workOn: l10n("releaseBoard.panel.workOn"),
    inProgress: l10n("releaseBoard.panel.inProgress"),
    nothingHere: l10n("releaseBoard.panel.nothingHere"),
    more: l10n("releaseBoard.panel.more", { count: "{count}" }),
    blocked: l10n("releaseBoard.panel.blocked", { count: "{count}" }),
    refresh: l10n("releaseBoard.panel.refresh"),
    accept: l10n("releaseBoard.accept"),
    safetyHold: l10n("releaseBoard.panel.safetyHold"),
    baseline: l10n("releaseBoard.panel.baseline"),
    reasonBaseline: l10n("releaseBoard.panel.reasonBaseline"),
    reasonGrey: l10n("releaseBoard.panel.reasonGrey", { count: "{count}" }),
    reasonHealth: l10n("releaseBoard.panel.reasonHealth"),
    allClear: l10n("releaseBoard.panel.allClear"),
    dependsOn: l10n("releaseBoard.panel.dependsOn"),
    linkedHeading: l10n("releaseBoard.panel.linkedHeading"),
    linkedNote: l10n("releaseBoard.panel.linkedNote"),
    flagsHeading: l10n("releaseBoard.panel.flagsHeading"),
    flagsNote: l10n("releaseBoard.panel.flagsNote"),
    hub: l10n("releaseBoard.panel.hub"),
  };
}

class BoardPanel {
  private model: BoardModel | undefined;
  private run: BoardRun | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly panel: vscode.WebviewPanel
  ) {
    panel.onDidDispose(() => this.dispose(), null, this.disposables);
    panel.webview.onDidReceiveMessage((m: unknown) => void this.onMessage(m), null, this.disposables);
  }

  reveal(): void {
    this.panel.reveal();
  }

  async refresh(): Promise<void> {
    try {
      this.run = await runBoardScan(this.context);
      this.render();
    } catch (e) {
      void vscode.window.showErrorMessage(l10n("releaseBoard.failed", { error: e instanceof Error ? e.message : String(e) }));
    }
  }

  private render(): void {
    if (!this.run) {
      return;
    }
    this.model = buildBoard(this.run.cfg, this.run.result.rows, this.run.safety, this.run.accepted, this.run.result.snapshot);
    const nonce = crypto.randomBytes(16).toString("base64");
    this.panel.webview.html = renderBoard(this.model, strings(), nonce);
  }

  private async onMessage(message: unknown): Promise<void> {
    if (typeof message !== "object" || message === null) {
      return;
    }
    const msg = message as { type?: string; id?: number };
    if (msg.type === "refresh") {
      await this.refresh();
    } else if (msg.type === "accept" && this.run) {
      await acceptBoardRun(this.run);
      this.render();
    } else if (msg.type === "open" && typeof msg.id === "number") {
      const item = this.model?.items[msg.id];
      const project = this.run?.cfg.projects.find((p) => p.id === item?.project);
      if (item && project) {
        const uri = vscode.Uri.joinPath(vscode.Uri.parse(project.path), item.path);
        await vscode.window.showTextDocument(uri, { preview: true });
      }
    }
  }

  private dispose(): void {
    current = undefined;
    this.panel.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}

export async function openBoard(context: vscode.ExtensionContext): Promise<void> {
  if (current) {
    current.reveal();
    await current.refresh();
    return;
  }
  const panel = vscode.window.createWebviewPanel(
    "saropaWorkspace.releaseBoard",
    l10n("releaseBoard.panel.title"),
    vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One,
    { enableScripts: true, retainContextWhenHidden: true }
  );
  current = new BoardPanel(context, panel);
  await current.refresh();
}
