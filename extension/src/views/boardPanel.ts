import * as crypto from "node:crypto";
import * as vscode from "vscode";
import { onDidRecordHealth } from "../commands/boardHealth";
import { onDidChangeMarks, readMarks } from "../commands/boardMarks";
import { applyMarks, pinnedKeys } from "../board/marks";
import { BoardRun, acceptBoardRun, canRunHealth, hasOutsideProject, openRulesFile, readLastRun, runBoardScan, runHealthNow } from "../commands/releaseBoardCommands";
import { buildBoard, BoardModel } from "../board/boardModel";
import { onDidChangeTrainVersions, trainsFor } from "./boardTrain";
import { PathToGo, pathToGo } from "../board/pathToGo";
import { RenderState, renderBoard, renderSkeleton } from "../board/boardHtml";
import { l10n } from "../i18n/l10n";
import { Outside, emptyOutside } from "../board/outside";
import { loadOutside, onDidChangeProviders } from "../commands/boardOutside";
import { moveToArchive } from "../commands/boardTidy";
import { publishBoard } from "./editorLinks";
import { loadLiveSignals, readLiveSettings, startBugDocument } from "../commands/boardLive";
import { LiveSignals } from "../board/liveEvidence";
import { onDidChangeSinceLast, panelLeft, panelShowed, viewFor } from "./boardSinceLast";
import { readHandSettings } from "../commands/boardHandToChat";
import { currentBoard, markPanelOpened, markScanDone, onDidAskRefresh, setFailed, setPanelVisible } from "./boardFeed";
import { strings } from "./boardStrings";
import { applySuggestion, emptyPage, handToChat, liveInput, openDocument, openExternalLink, openSittingsLine, pathSettings, saveSitting, sittingsInput, tidyInput } from "./boardPanelActions";

// The Release Board first screen, an editor-tab webview. One instance: opening it again
// reveals it and rescans. The page is static HTML under a strict CSP; its only messages
// are "refresh", "accept", "profile", "suggest", "rules", "open <id>", "external <group,
// item>", "path <project, step>", "tidy <index>", "liveBug <index>" and "hand <kind, index>", and the host resolves each id or index against the model it rendered, so the page
// can never name an arbitrary path or address.

let current: BoardPanel | undefined;

// Least time between two looks at the Problems panel.
const LIVE_GAP_MS = 4000;

class BoardPanel {
  private model: BoardModel | undefined;
  // One Path to GO per project, in the order of model.projects: what the page shows, so a
  // click's indexes are resolved against exactly this.
  private paths: PathToGo[] | undefined;
  // Run buttons in flight (project:kind) and a review dialog that is open: a second click is ignored.
  private readonly starting = new Set<string>();
  private reviewing = false;
  // A tidy move (with its confirmation) is under way: a second click is ignored.
  private moving = false;
  private run: BoardRun | undefined;
  // Bumped on every render; messages from an older page are ignored.
  private rev = 0;
  // Overlapping triggers (a setting change, a file save, a Refresh click) share one scan:
  // while one runs, a new request only asks for one more pass afterwards.
  private scanning = false;
  private again = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  // A document changed since the last scan; reopening or showing the tab then rescans.
  private dirty = true;
  // What is on screen is the stored last result, not a fresh scan.
  private cached = false;
  private lastScanAt = 0;
  // The page shows a board whose documents are still being read; a scan that dies now leaves it so.
  private partial = false;
  private lastKey = "";
  // Sessions, review requests and other extensions' groups; loaded after the scan, never awaited by it.
  private outside: Outside = emptyOutside();
  private outsideToken = 0;
  private disposed = false;
  private outsidePending = false;
  // Error and warning counts for the files open documents name; loaded after the scan.
  private live: LiveSignals = {};
  private liveToken = 0;
  private liveTimer: ReturnType<typeof setTimeout> | undefined;
  private liveAt = 0;
  // The lookback in force when the signals were gathered; a bug document uses the same one.
  private liveDays = 1;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly panel: vscode.WebviewPanel
  ) {
    panel.onDidDispose(() => this.dispose(), null, this.disposables);
    // While the tab is showing it owns the scan: the sidebar's refresh button asks it.
    markPanelOpened();
    setPanelVisible(panel.visible);
    panel.onDidChangeViewState(() => {
      setPanelVisible(panel.visible);
      // Leaving early is not a look; the dwell timer in boardSinceLast decides what counts as seen.
      if (!panel.visible) {
        panelLeft();
      } else if (this.run) {
        // Shown again: the strip is gone if the last look already took it as seen.
        this.render(this.scanning ? { loading: true } : this.cached ? { stale: true } : {});
      }
    }, null, this.disposables);
    onDidAskRefresh(() => this.poke(0), null, this.disposables);
    // The change was taken as seen (or marked seen): draw the board again without the strip.
    onDidChangeSinceLast(
      () => {
        if (this.run) {
          this.lastKey = "";
          this.render(this.scanning ? { loading: true } : this.cached ? { stale: true } : {});
        }
      },
      null,
      this.disposables
    );
    onDidRecordHealth(() => this.poke(300), null, this.disposables);
    // A mark changes only what is drawn, so the stored scan is shown again, not redone.
    onDidChangeMarks(
      () =>
        void readMarks(this.context).then((m) => {
          if (this.run) {
            this.run.marks = m;
            this.render();
          }
        }),
      null,
      this.disposables
    );
    this.listenForChanges();
    this.watchDocuments();
    panel.onDidChangeViewState(() => this.panel.visible && this.dirty && this.schedule(0), null, this.disposables);
    // Problems changed while the tab was hidden: look again when it is shown.
    panel.onDidChangeViewState(() => this.panel.visible && !this.scanning && void this.refreshLive(), null, this.disposables);
    panel.webview.onDidReceiveMessage((m: unknown) => void this.onMessage(m), null, this.disposables);
    // Something is on screen at once: placeholders, then the last result, then the scan.
    panel.webview.html = renderSkeleton(strings(), crypto.randomBytes(16).toString("base64"));
  }

  // Marks, providers, Problems, trains, folders and settings: each draws again or asks for a scan.
  private listenForChanges(): void {
    onDidChangeProviders(() => void this.refreshOutside(), null, this.disposables);
    // The Problems panel changes often while typing: look again at most every few seconds.
    vscode.languages.onDidChangeDiagnostics(
      () => {
        // A true throttle: at most one look every 4 s, the last change always gets one.
        if (this.panel.visible && !this.liveTimer && readLiveSettings().enabled) {
          this.liveTimer = setTimeout(() => {
            this.liveTimer = undefined;
            void this.refreshLive();
          }, Math.max(0, this.liveAt + LIVE_GAP_MS - Date.now()));
        }
      },
      null,
      this.disposables
    );
    // A project version was read: draw the train name again.
    onDidChangeTrainVersions(() => !this.scanning && !this.cached && this.render(), null, this.disposables);
    vscode.workspace.onDidChangeWorkspaceFolders(() => this.poke(300), null, this.disposables);
    vscode.workspace.onDidChangeConfiguration(
      (e) => {
        if (e.affectsConfiguration("saropaWorkspace.releaseBoard.enabled") || e.affectsConfiguration("saropaWorkspace.releaseBoard.profile")) {
          this.poke(300);
        } else if (e.affectsConfiguration("saropaWorkspace.releaseBoard")) {
          // Display-only settings: draw the stored scan again, no rescan.
          this.lastKey = "";
          this.render(this.scanning ? { loading: true } : this.cached ? { stale: true } : {});
          void this.refreshOutside();
          void this.refreshLive();
        }
      },
      null,
      this.disposables
    );
  }

  private watchDocuments(): void {
    // Documents change on disk: rescan while the tab is showing, else only remember it.
    const rules = vscode.workspace.createFileSystemWatcher("**/.saropa/release-board*.json");
    const watcher = vscode.workspace.createFileSystemWatcher("**/*.{md,sql}");
    rules.onDidChange(() => this.poke(300), null, this.disposables);
    rules.onDidCreate(() => this.poke(300), null, this.disposables);
    rules.onDidDelete(() => this.poke(300), null, this.disposables);
    this.disposables.push(rules);
    const changed = (uri: vscode.Uri): void => {
      if (/[\\/](?:node_modules|\.git)[\\/]/.test(uri.path)) {
        return;
      }
      this.dirty = true;
      if (this.panel.visible) {
        this.schedule(1500);
      }
    };
    watcher.onDidChange(changed, null, this.disposables);
    watcher.onDidCreate(changed, null, this.disposables);
    watcher.onDidDelete(changed, null, this.disposables);
    this.disposables.push(watcher);
  }

  reveal(): void {
    this.panel.reveal();
  }

  // Rescan when something changed or the result is old; otherwise just show it.
  needsRefresh(): boolean {
    return this.dirty || (this.run !== undefined && hasOutsideProject(this.run.cfg)) || Date.now() - this.lastScanAt > 60 * 1000;
  }

  // A trigger from outside the page: scan now while the tab is showing, else just remember it
  // (the background scan keeps the sidebar current, and the tab rescans when shown).
  private poke(ms: number): void {
    if (this.panel.visible) {
      this.schedule(ms);
    } else {
      this.dirty = true;
    }
  }

  private schedule(ms: number): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.refresh(true), ms);
  }

  // Starts from a result the background scan just made, so a tab opened at startup does not scan again.
  seed(run: BoardRun): void {
    this.run = run;
    this.cached = false;
    this.dirty = false;
    this.lastScanAt = Date.now();
    this.render();
    void this.refreshOutside();
    void this.refreshLive();
  }

  // Paints the previous result at once, dimmed, while the scan runs.
  async showCached(): Promise<void> {
    const last = await readLastRun(this.context).catch(() => undefined);
    if (last && !this.run) {
      this.run = last;
      this.cached = true;
      this.render({ stale: true });
    }
  }

  async refresh(quiet = false): Promise<void> {
    if (this.scanning) {
      this.again = true;
      return;
    }
    this.scanning = true;
    try {
      do {
        this.again = false;
        this.dirty = false;
        await this.scanOnce(quiet);
      } while (this.again);
    } catch (e) {
      // Whatever half-finished state is on screen is settled, and the next open rescans.
      this.dirty = true;
      this.lastKey = "";
      // A half-read board is never shown as final, and the sidebar and status bar say the scan failed.
      this.render(this.cached || this.partial ? { stale: true } : {});
      setFailed(true);
      void vscode.window.showErrorMessage(l10n("releaseBoard.failed", { error: e instanceof Error ? e.message : String(e) }));
    } finally {
      this.scanning = false;
      markScanDone();
      if (this.outsidePending && !this.cached) {
        this.outsidePending = false;
        this.render();
      }
      void this.panel.webview.postMessage({ type: "busy", on: false });
    }
  }

  private async scanOnce(quiet: boolean): Promise<void> {
    void this.panel.webview.postMessage({ type: "busy", on: true });
    const run = await runBoardScan(this.context, quiet, (first) => {
      // Documents are sorted; their text is still being read for marks and severity.
      this.run = first;
      this.cached = false;
      this.partial = true;
      this.render({ loading: true });
    });
    this.run = run;
    this.cached = false;
    this.partial = false;
    setFailed(false);
    this.lastScanAt = Date.now();
    if (!run) {
      this.model = undefined;
      this.rev += 1;
      this.lastKey = "";
      this.panel.webview.html = emptyPage(l10n("releaseBoard.disabled"));
      publishBoard(undefined, undefined);
      return;
    }
    this.render();
    void this.refreshOutside();
    void this.refreshLive();
  }

  // Counts the errors and warnings in the files open documents name, off the scan's path,
  // and paints them when they arrive; a newer call wins. Marks are information only.
  private async refreshLive(): Promise<void> {
    const run = this.run;
    const model = this.model;
    if (!run || !model || this.disposed) {
      return;
    }
    const token = ++this.liveToken;
    this.liveAt = Date.now();
    const s = readLiveSettings();
    this.liveDays = s.lookbackDays;
    const next = s.enabled ? await loadLiveSignals(run, model.items, s) : {};
    if (token === this.liveToken && !this.disposed) {
      this.live = next;
      if (!this.scanning && !this.cached) {
        this.render();
      } else {
        this.outsidePending = true;
      }
    }
  }

  // Fetches what lives outside the scan and paints it when it arrives; a newer call wins.
  private async refreshOutside(): Promise<void> {
    if (!this.run || !this.model) {
      return;
    }
    const token = ++this.outsideToken;
    const files: Array<[string, string]> = [];
    for (const it of this.model.items) {
      const project = this.run.cfg.projects.find((p) => p.id === it.project);
      if (project) {
        files.push([`${it.project}/${it.path}`, vscode.Uri.joinPath(vscode.Uri.parse(project.path), it.path).fsPath]);
      }
    }
    const next = await loadOutside(files).catch(() => emptyOutside());
    if (token === this.outsideToken && !this.disposed) {
      this.outside = next;
      // While a scan runs or the stored result is on screen, the next paint carries it.
      if (!this.scanning && !this.cached) {
        this.render();
      } else {
        this.outsidePending = true;
      }
    }
  }

  private render(state: RenderState = {}): void {
    if (!this.run || this.disposed) {
      return;
    }
    const { cfg, marks } = this.run;
    // Hand marks: in progress turns an open document purple, pins join the rules file's pins.
    this.model = buildBoard(
      cfg,
      applyMarks(this.run.result.rows, marks),
      this.run.safety,
      this.run.accepted,
      this.run.result.snapshot,
      this.run.previous,
      this.run.health,
      { needs: marks.needs, rejected: marks.rejected, pins: pinnedKeys(marks), outside: this.outside, sittings: sittingsInput(this.context), tidy: tidyInput(), live: liveInput(this.live) }
    );
    const model = this.model;
    const settings = pathSettings();
    this.paths = settings
      ? model.projects.map((p) =>
          pathToGo(model, p, {
            maxSteps: settings.maxSteps,
            canRun: (kind) => {
              const def = cfg.projects.find((d) => d.id === p.id);
              return settings.showRunButtons && def !== undefined && canRunHealth(def, kind);
            },
          })
        )
      : undefined;
    // The strip and the "seen" record only for a finished board: a loading or stored paint can
    // hold unread documents, which would read as blockers that cleared.
    const finished = !state.loading && !state.stale && !this.partial;
    const since = finished ? viewFor(model) : undefined;
    if (finished && this.panel.visible) {
      panelShowed(model);
    }
    // The same board in the same state is not painted again: no flicker, no lost scroll.
    const trains = trainsFor(model, cfg);
    const key = JSON.stringify([this.model, state, this.paths, since, readHandSettings().enabled, trains]);
    if (key === this.lastKey) {
      return;
    }
    this.lastKey = key;
    // Only a finished scan shown on a visible tab is published: a loading, stale or hidden
    // paint must never replace a newer board.
    if (!state.loading && !state.stale && this.panel.visible) {
      publishBoard(this.model, this.run);
    }
    const nonce = crypto.randomBytes(16).toString("base64");
    this.rev += 1;
    this.panel.webview.html = renderBoard(this.model, strings(), nonce, this.rev, state, this.paths, since, trains);
  }

  private async onMessage(message: unknown): Promise<void> {
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
      await this.onActionMessage(msg, message as Record<string, unknown>);
    }
  }

  private async onActionMessage(msg: { type?: string; id?: number }, message: Record<string, unknown>): Promise<void> {
    if (msg.type === "tidy" && typeof message.i === "number") {
      await this.tidyMove(message.i);
    } else if (msg.type === "liveBug" && typeof message.i === "number") {
      await this.liveBug(message.i);
    } else if (msg.type === "rules") {
      await openRulesFile();
    } else if (msg.type === "accept") {
      await this.accept();
    } else if (msg.type === "open" && typeof msg.id === "number") {
      await this.openItem(msg.id);
    } else if (msg.type === "path" && typeof message.p === "number" && typeof message.s === "number") {
      await this.pathAction(message.p, message.s);
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

  private dispose(): void {
    current = undefined;
    setPanelVisible(false);
    panelLeft();
    this.disposed = true;
    this.outsideToken++;
    this.liveToken++;
    clearTimeout(this.timer);
    clearTimeout(this.liveTimer);
    this.panel.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
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
