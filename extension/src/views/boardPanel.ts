import * as crypto from "node:crypto";
import * as vscode from "vscode";
import { BoardRun, acceptBoardRun, openRulesFile, runBoardScan } from "../commands/releaseBoardCommands";
import { buildBoard, BoardModel } from "../board/boardModel";
import { BoardStrings, escapeHtml, renderBoard } from "../board/boardHtml";
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
    profileLabel: l10n("releaseBoard.panel.profileLabel"),
    profileRush: l10n("releaseBoard.panel.profileRush"),
    profileDeliberate: l10n("releaseBoard.panel.profileDeliberate"),
    profileZero: l10n("releaseBoard.panel.profileZero"),
    severityNames: l10n("releaseBoard.panel.severityNames"),
    proOnly: l10n("releaseBoard.panel.proOnly"),
    pinned: l10n("releaseBoard.panel.pinned"),
    needsRuleHeading: l10n("releaseBoard.panel.needsRuleHeading"),
    needsRuleNote: l10n("releaseBoard.panel.needsRuleNote"),
  };
}

function emptyPage(text: string): string {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"></head><body style="font-family:var(--vscode-font-family);color:var(--vscode-foreground);padding:16px"><p>${escapeHtml(text)}</p></body></html>`;
}

class BoardPanel {
  private model: BoardModel | undefined;
  private run: BoardRun | undefined;
  // Bumped on every render; messages from an older page are ignored.
  private rev = 0;
  // Each refresh takes a number; a scan that finishes after a newer one started is dropped.
  private scanSeq = 0;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly panel: vscode.WebviewPanel
  ) {
    panel.onDidDispose(() => this.dispose(), null, this.disposables);
    vscode.workspace.onDidChangeWorkspaceFolders(() => void this.refresh(true), null, this.disposables);
    vscode.workspace.onDidChangeConfiguration(
      (e) => e.affectsConfiguration("saropaWorkspace.releaseBoard") && void this.refresh(true),
      null,
      this.disposables
    );
    panel.webview.onDidReceiveMessage((m: unknown) => void this.onMessage(m), null, this.disposables);
  }

  reveal(): void {
    this.panel.reveal();
  }

  async refresh(quiet = false): Promise<void> {
    try {
      const seq = ++this.scanSeq;
      const run = await runBoardScan(this.context, quiet);
      if (seq !== this.scanSeq) {
        return;
      }
      this.run = run;
      if (!this.run) {
        this.model = undefined;
        this.rev += 1;
        this.panel.webview.html = emptyPage(l10n("releaseBoard.disabled"));
        return;
      }
      this.render();
    } catch (e) {
      void vscode.window.showErrorMessage(l10n("releaseBoard.failed", { error: e instanceof Error ? e.message : String(e) }));
    }
  }

  private render(): void {
    if (!this.run) {
      return;
    }
    this.model = buildBoard(this.run.cfg, this.run.result.rows, this.run.safety, this.run.accepted, this.run.result.snapshot, this.run.previous);
    const nonce = crypto.randomBytes(16).toString("base64");
    this.rev += 1;
    this.panel.webview.html = renderBoard(this.model, strings(), nonce, this.rev);
  }

  private async onMessage(message: unknown): Promise<void> {
    if (typeof message !== "object" || message === null) {
      return;
    }
    const msg = message as { type?: string; id?: number; rev?: number; value?: string };
    if (msg.rev !== this.rev) {
      return;
    }
    if (msg.type === "refresh") {
      await this.refresh();
    } else if (msg.type === "profile" && (msg.value === "rush" || msg.value === "deliberate" || msg.value === "zero")) {
      // The setting change refreshes the board through the configuration listener.
      await vscode.workspace.getConfiguration("saropaWorkspace.releaseBoard").update("profile", msg.value, vscode.ConfigurationTarget.Workspace);
    } else if (msg.type === "rules") {
      await openRulesFile();
    } else if (msg.type === "accept" && this.run && (this.model?.baseline || this.model?.safetyHold)) {
      if (await acceptBoardRun(this.run)) {
        this.render();
      } else {
        void vscode.window.showWarningMessage(l10n("releaseBoard.acceptStale"));
        await this.refresh();
      }
    } else if (msg.type === "open" && typeof msg.id === "number") {
      const item = this.model?.items[msg.id];
      const project = this.run?.cfg.projects.find((p) => p.id === item?.project);
      if (item && project) {
        const uri = vscode.Uri.joinPath(vscode.Uri.parse(project.path), item.path);
        try {
          await vscode.window.showTextDocument(uri, { preview: true });
        } catch (e) {
          void vscode.window.showErrorMessage(l10n("releaseBoard.failed", { error: e instanceof Error ? e.message : String(e) }));
        }
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
    { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [] }
  );
  current = new BoardPanel(context, panel);
  await current.refresh();
}
