import * as vscode from "vscode";
import { acceptBoardRun, openRulesFile, runHealthNow } from "../commands/releaseBoardCommands";
import { l10n } from "../i18n/l10n";
import { moveToArchive } from "../commands/boardTidy";
import { startBugDocument } from "../commands/boardLive";
import { currentBoard } from "./boardFeed";
import { applySuggestion, handToChat, openDocument, openExternalLink, openSittingsLine, saveSitting } from "./boardPanelActions";
import { BoardPanelWiring } from "./boardPanelWiring";
import { editBlocker, setFutureField } from "../commands/boardFuture";
import { FUTURE_SORTS, FutureItem, FutureSort, blockKeyOf, isFieldValue } from "../board/futureList";

// The Release Board first screen, an editor-tab webview. One instance: opening it again
// reveals it and rescans. The page is static HTML under a strict CSP; its only messages
// are "refresh", "accept", "profile", "suggest", "rules", "open <id>", "external <group,
// item>", "path <project, step>", "tidy <index>", "liveBug <index>", "hand <kind, index>", "futureSet <index, field, value>", "futureBlocker <index>", "futureOpen <index>" and "futureSort <value>", and the host resolves each id or index against the model it rendered, so the page
// can never name an arbitrary path or address.

let current: BoardPanel | undefined;

class BoardPanel extends BoardPanelWiring {
  // Run buttons in flight (project:kind) and a review dialog that is open: a second click is ignored.
  private readonly starting = new Set<string>();
  private reviewing = false;
  // A Future tab edit (with its dialogs) is under way: a second one is ignored.
  private editing = false;
  // A tidy move (with its confirmation) is under way: a second click is ignored.
  private moving = false;

  protected onClosed(): void {
    current = undefined;
  }

  protected async onMessage(message: unknown): Promise<void> {
    if (typeof message !== "object" || message === null) {
      return;
    }
    const msg = message as { type?: string; id?: number; rev?: number; value?: string; key?: string };
    if (msg.rev !== this.rev) {
      return;
    }
    if (msg.type === "refresh") {
      this.dirty = true;
      await this.refresh();
    } else if (msg.type === "profile" && (msg.value === "rush" || msg.value === "deliberate" || msg.value === "zero")) {
      // The setting change refreshes the board through the configuration listener.
      await vscode.workspace.getConfiguration("saropaWorkspace.releaseBoard").update("profile", msg.value, vscode.ConfigurationTarget.Workspace);
    } else if (msg.type === "suggest" && typeof msg.key === "string" && (msg.value === "accept" || msg.value === "reject")) {
      await applySuggestion(this.context, this.model, msg.key, msg.value);
    } else if (msg.type === "external" && typeof (message as { g?: unknown }).g === "number" && typeof (message as { i?: unknown }).i === "number") {
      const m = message as { g: number; i: number };
      await openExternalLink(this.model, m.g, m.i);
    } else if (msg.type === "sitting") {
      await saveSitting(this.context, this.model, message as { have?: unknown; box?: unknown });
      this.lastKey = "";
      this.render(this.cached ? { stale: true } : {});
    } else if (msg.type === "step" && typeof (message as { i?: unknown }).i === "number") {
      await openSittingsLine(this.model, this.run, (message as { i: number }).i);
    } else if (msg.type === "hand") {
      await handToChat(this.model, this.paths, this.run, message as { k?: unknown; i?: unknown; p?: unknown; s?: unknown });
    } else {
      await this.onActionMessage(message as Record<string, unknown>);
    }
  }

  private async onActionMessage(message: Record<string, unknown>): Promise<void> {
    if (message.type === "tidy" && typeof message.i === "number") {
      await this.tidyMove(message.i);
    } else if (message.type === "liveBug" && typeof message.i === "number") {
      await this.liveBug(message.i);
    } else if (message.type === "futureSet" || message.type === "futureBlocker") {
      await this.futureEdit(message);
    } else if (message.type === "futureOpen") {
      await this.futureOpen(message);
    } else if (message.type === "futureSort" && FUTURE_SORTS.includes(message.value as FutureSort)) {
      this.futureSort = message.value as FutureSort;
      this.lastKey = "";
      this.render(this.cached ? { stale: true } : {});
    } else if (message.type === "rules") {
      await openRulesFile();
    } else if (message.type === "accept") {
      await this.accept();
    } else if (message.type === "open" && typeof message.id === "number") {
      await this.openItem(message.id);
    } else if (message.type === "path" && typeof message.p === "number" && typeof message.s === "number") {
      await this.pathAction(message.p, message.s);
    }
  }

  // The listed document and its project folder for an index the page sent; the index is
  // resolved against the Future list this panel painted, never a path from the page.
  private futureTarget(i: unknown): { item: FutureItem; root: vscode.Uri } | undefined {
    const item = typeof i === "number" ? this.futureShown[i] : undefined;
    const def = this.run?.cfg.projects.find((p) => p.id === item?.project);
    return item && def ? { item, root: vscode.Uri.parse(def.path) } : undefined;
  }

  // Sets one flag or characteristic, or the blocker line, of a listed document. The page is
  // painted again afterwards whatever the outcome, so its controls show what the file holds.
  private async futureEdit(message: Record<string, unknown>): Promise<void> {
    const target = this.futureTarget(message.i);
    const field = typeof message.field === "string" ? message.field : "";
    const key = blockKeyOf(field);
    if (!target || this.cached || this.editing) {
      return;
    }
    this.editing = true;
    try {
      if (message.type === "futureBlocker") {
        await editBlocker(target.root, target.item);
      } else if (key && isFieldValue(field, message.value)) {
        await setFutureField(target.root, target.item, key, message.value);
      }
    } catch (e) {
      void vscode.window.showErrorMessage(l10n("releaseBoard.failed", { error: e instanceof Error ? e.message : String(e) }));
    } finally {
      this.editing = false;
    }
    this.lastKey = "";
    this.dirty = true;
    await this.refreshFuture();
  }

  // Opens a listed document (a deferred one by index, a read-only one by outside index).
  private async futureOpen(message: Record<string, unknown>): Promise<void> {
    const item = typeof message.i === "number" ? this.futureShown[message.i] : undefined;
    const outside = typeof message.o === "number" ? this.futureOutsideShown[message.o] : undefined;
    const hit = item ?? outside;
    const def = this.run?.cfg.projects.find((p) => p.id === hit?.project);
    if (hit && def) {
      const pos = outside ? new vscode.Position(Math.max(0, outside.line - 1), 0) : undefined;
      await openDocument(vscode.Uri.joinPath(vscode.Uri.parse(def.path), hit.path), pos ? new vscode.Range(pos, pos) : undefined);
    }
  }

  // The index is resolved against the list this panel rendered, never a path from the page.
  private async liveBug(i: number): Promise<void> {
    const u = this.model?.liveUnnamed?.[i];
    const project = this.run?.cfg.projects.find((p) => p.id === u?.project);
    if (u && project && !this.scanning && !this.cached) {
      try {
        if (await startBugDocument(vscode.Uri.parse(project.path), u, this.liveDays)) {
          this.dirty = true;
          await this.refresh(true);
        }
      } catch (e) {
        void vscode.window.showErrorMessage(l10n("releaseBoard.failed", { error: e instanceof Error ? e.message : String(e) }));
      }
    }
  }

  // One click, one document. The index is resolved against the list this panel rendered;
  // the move asks first, naming the exact source and destination.
  private async tidyMove(i: number): Promise<void> {
    const c = this.model?.tidy?.candidates[i];
    const project = this.run?.cfg.projects.find((p) => p.id === c?.project);
    if (!c || !project || this.scanning || this.cached || this.moving) {
      return;
    }
    this.moving = true;
    try {
      if (await moveToArchive(vscode.Uri.parse(project.path), c)) {
        this.dirty = true;
        await this.refresh();
      }
    } finally {
      this.moving = false;
    }
  }

  private async accept(): Promise<void> {
    if (!(this.run && !this.scanning && !this.cached && (this.model?.baseline || this.model?.safetyHold))) {
      return;
    }
    if (await acceptBoardRun(this.run).catch(() => false)) {
      this.lastKey = "";
      this.render();
    } else {
      void vscode.window.showWarningMessage(l10n("releaseBoard.acceptStale"));
      await this.refresh();
    }
  }

  private async openItem(id: number): Promise<void> {
    const item = this.model?.items[id];
    const project = this.run?.cfg.projects.find((p) => p.id === item?.project);
    if (item && project) {
      await openDocument(vscode.Uri.joinPath(vscode.Uri.parse(project.path), item.path));
    }
  }

  // A button in a Path to GO list. The page sent a project and step index; both are resolved
  // against the paths this panel rendered, never against anything the page names.
  private async pathAction(pi: number, si: number): Promise<void> {
    const project = this.model?.projects[pi];
    const step = this.paths?.[pi]?.steps[si];
    const def = this.run?.cfg.projects.find((d) => d.id === project?.id);
    if (!project || !step || !def || this.scanning || this.cached) {
      return;
    }
    if (step.kind === "item" && step.itemId !== undefined) {
      await this.openItem(step.itemId);
    } else if ((step.kind === "lint" || step.kind === "tests") && step.run) {
      const flight = `${def.id}:${step.kind}`;
      if (this.starting.has(flight)) {
        return;
      }
      this.starting.add(flight);
      try {
        if (!(await runHealthNow(def, step.kind))) {
          void vscode.window.showInformationMessage(l10n("releaseBoard.noRunShortcut"));
        }
      } finally {
        this.starting.delete(flight);
      }
    } else if (step.kind === "rules") {
      await openRulesFile({ project: def.id, folder: step.folder ?? "" });
    } else if (step.kind === "accept") {
      await this.reviewAndAccept();
    }
  }

  // Asks first, saying what the scan holds, then accepts through the same path as the banner.
  private async reviewAndAccept(): Promise<void> {
    if (this.reviewing || !this.run || !(this.model?.baseline || this.model?.safetyHold)) {
      return;
    }
    // The scan being reviewed: if the board repaints while the dialog is open, it is another scan.
    const run = this.run;
    const rev = this.rev;
    const accept = l10n("releaseBoard.accept");
    const text = run.safety.baseline ? l10n("releaseBoard.acceptBaseline") : l10n("releaseBoard.held", { count: run.safety.findings.length });
    this.reviewing = true;
    try {
      if ((await vscode.window.showWarningMessage(text, accept)) !== accept) {
        return;
      }
    } finally {
      this.reviewing = false;
    }
    if (this.run !== run || this.rev !== rev) {
      void vscode.window.showInformationMessage(l10n("releaseBoard.changedDuringReview"));
      return;
    }
    await this.accept();
  }
}

// `background` opens the tab without taking focus (the window start does this).
export async function openBoard(context: vscode.ExtensionContext, background = false): Promise<void> {
  if (current) {
    if (background) {
      return;
    }
    current.reveal();
    if (current.needsRefresh()) {
      await current.refresh();
    }
    return;
  }
  const panel = vscode.window.createWebviewPanel(
    "saropaWorkspace.releaseBoard",
    l10n("releaseBoard.panel.title"),
    // Background: beside the active editor, so no open file is covered and focus stays put.
    { viewColumn: background ? (vscode.window.activeTextEditor ? vscode.ViewColumn.Beside : vscode.ViewColumn.Active) : (vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One), preserveFocus: background },
    { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [] }
  );
  current = new BoardPanel(context, panel);
  const fresh = background ? currentBoard() : undefined;
  if (fresh) {
    current.seed(fresh.run);
    return;
  }
  await current.showCached();
  await current.refresh();
}