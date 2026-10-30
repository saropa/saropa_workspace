import * as crypto from "node:crypto";
import * as vscode from "vscode";
import { applyMarks, pinnedKeys } from "../board/marks";
import { BoardRun, canRunHealth, hasOutsideProject, readLastRun, runBoardScan } from "../commands/releaseBoardCommands";
import { buildBoard, BoardModel } from "../board/boardModel";
import { trainsFor } from "./boardTrain";
import { PathToGo, pathToGo } from "../board/pathToGo";
import { RenderState, renderBoard } from "../board/boardHtml";
import { l10n } from "../i18n/l10n";
import { Outside, emptyOutside } from "../board/outside";
import { loadOutside } from "../commands/boardOutside";
import { publishBoard } from "./editorLinks";
import { loadLiveSignals, readLiveSettings } from "../commands/boardLive";
import { LiveSignals } from "../board/liveEvidence";
import { panelShowed, viewFor } from "./boardSinceLast";
import { markScanDone, setFailed, setPanelVisible } from "./boardFeed";
import { strings } from "./boardStrings";
import { FutureData, emptyFuture, loadFuture, readFutureSettings } from "../commands/boardFuture";
import { FutureView } from "../board/boardHtmlFuture";
import { FutureItem, FutureOutside, FutureSort } from "../board/futureList";
import { startupOn } from "./boardStartup";
import { readGroupBy, readProjectScope } from "../commands/boardExtraProjects";
import { hintVisible, dismissHint } from "./boardProjectsHint";
import { emptyPage, inProgressInput, liveInput, pathSettings, sittingsInput, tidyInput } from "./boardPanelActions";
import { collectEdited, readInProgressSettings } from "../commands/boardInProgress";
import { ChatPoll } from "./boardChats";

// Least time between two looks at the Problems panel.
export const LIVE_GAP_MS = 4000;

/** State and rendering shared by the board panel: the current model, paths and run, and the render counter that ignores stale page messages. */
export abstract class BoardPanelCore {
  protected model: BoardModel | undefined;
  // One Path to GO per project, in the order of model.projects: what the page shows, so a
  // click's indexes are resolved against exactly this.
  protected paths: PathToGo[] | undefined;
  protected run: BoardRun | undefined;
  // Bumped on every render; messages from an older page are ignored.
  protected rev = 0;
  // Overlapping triggers (a setting change, a file save, a Refresh click) share one scan:
  // while one runs, a new request only asks for one more pass afterwards.
  protected scanning = false;
  protected again = false;
  protected timer: ReturnType<typeof setTimeout> | undefined;
  // A document changed since the last scan; reopening or showing the tab then rescans.
  protected dirty = true;
  // What is on screen is the stored last result, not a fresh scan.
  protected cached = false;
  protected lastScanAt = 0;
  // The page shows a board whose documents are still being read; a scan that dies now leaves it so.
  protected partial = false;
  protected lastKey = "";
  // Sessions, review requests and other extensions' groups; loaded after the scan, never awaited by it.
  protected outside: Outside = emptyOutside();
  protected outsideToken = 0;
  protected disposed = false;
  protected outsidePending = false;
  // Error and warning counts for the files open documents name; loaded after the scan.
  protected live: LiveSignals = {};
  protected liveToken = 0;
  protected liveTimer: ReturnType<typeof setTimeout> | undefined;
  protected liveAt = 0;
  // The lookback in force when the signals were gathered; a bug document uses the same one.
  protected liveDays = 1;
  // Deferred and blocked documents for the Future tab; loaded after the scan, never awaited by it.
  protected future: FutureData = emptyFuture();
  protected futureToken = 0;
  // The sort chosen on the page; the setting's default until then.
  protected futureSort: FutureSort | undefined;
  // What the page was last painted with, so a click's index is resolved against exactly this.
  protected futureShown: FutureItem[] = [];
  protected futureOutsideShown: FutureOutside[] = [];
  // Documents open in this window that have unsaved edits or are changed in git, as "project/path"
  // keys (sorted), for the In progress list; looked up off the scan's path.
  protected edited: string[] = [];
  protected editedToken = 0;
  protected editedStale = false;
  protected editedTimer: ReturnType<typeof setTimeout> | undefined;
  // The look at Chat Explorer chats that feeds the "Active now" pill; never part of a scan.
  protected readonly chats = new ChatPoll(
    () => this.run?.cfg.projects.map((p) => ({ id: p.id, folder: vscode.Uri.parse(p.path).fsPath })) ?? [],
    () => this.panel.visible,
    () => (!this.scanning && !this.cached ? this.render() : (this.outsidePending = true))
  );
  protected readonly disposables: vscode.Disposable[] = [];

  constructor(
    protected readonly context: vscode.ExtensionContext,
    protected readonly panel: vscode.WebviewPanel
  ) {}

  protected abstract onMessage(message: unknown): Promise<void>;
  // The panel is gone: the module drops its reference.
  protected abstract onClosed(): void;

  reveal(): void {
    this.panel.reveal();
  }

  // Rescan when something changed or the result is old; otherwise just show it.
  needsRefresh(): boolean {
    return this.dirty || (this.run !== undefined && hasOutsideProject(this.run.cfg)) || Date.now() - this.lastScanAt > 60 * 1000;
  }

  // A trigger from outside the page: scan now while the tab is showing, else just remember it
  // (the background scan keeps the sidebar current, and the tab rescans when shown).
  protected poke(ms: number): void {
    if (this.panel.visible) {
      this.schedule(ms);
    } else {
      this.dirty = true;
    }
  }

  protected schedule(ms: number): void {
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
    void this.refreshFuture();
    void this.refreshEdited();
    this.chats.start();
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

  protected async scanOnce(quiet: boolean): Promise<void> {
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
    void this.refreshFuture();
    void this.refreshEdited();
    this.chats.start();
  }

  // Looks up which board documents are being edited in this window and paints the In progress
  // list when the answer changed; a newer call wins. Never part of a scan.
  protected async refreshEdited(): Promise<void> {
    const run = this.run;
    if (!run || this.disposed) {
      return;
    }
    const token = ++this.editedToken;
    const next = readInProgressSettings().enabled ? (await collectEdited(run.cfg).catch(() => [])).sort() : [];
    if (token !== this.editedToken || this.disposed || next.join("\0") === this.edited.join("\0")) {
      return;
    }
    this.edited = next;
    if (!this.scanning && !this.cached) {
      this.render();
    } else {
      this.outsidePending = true;
    }
  }

  // A document was opened, edited, saved or closed: look again after a quiet moment. Typing
  // fires this on every key, so only the last call in a second does the work, and a hidden tab
  // only remembers that it should.
  protected scheduleEdited(): void {
    if (!this.panel.visible) {
      this.editedStale = true;
      return;
    }
    clearTimeout(this.editedTimer);
    this.editedTimer = setTimeout(() => void this.refreshEdited(), 1000);
  }

  // Reads the deferred and blocked documents off the scan's path and paints the Future tab
  // when they arrive; a newer call wins.
  protected async refreshFuture(): Promise<void> {
    const run = this.run;
    if (!run || this.disposed) {
      return;
    }
    const token = ++this.futureToken;
    const next = readFutureSettings().enabled ? await loadFuture(run) : emptyFuture();
    if (token === this.futureToken && !this.disposed) {
      this.future = next;
      if (!this.scanning && !this.cached) {
        this.render();
      } else {
        this.outsidePending = true;
      }
    }
  }

  // Counts the errors and warnings in the files open documents name, off the scan's path,
  // and paints them when they arrive; a newer call wins. Marks are information only.
  protected async refreshLive(): Promise<void> {
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
  protected async refreshOutside(): Promise<void> {
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

  // Hides the "add more projects" hint for good and paints the page again without it.
  protected async dismissHint(): Promise<void> {
    await dismissHint(this.context);
    this.lastKey = "";
    this.render(this.scanning ? { loading: true } : this.cached ? { stale: true } : {});
  }

  protected render(requested: RenderState = {}): void {
    if (!this.run || this.disposed) {
      return;
    }
    const state: RenderState = { ...requested, startup: startupOn(this.context), scope: readProjectScope(), groupBy: readGroupBy(), sectionIcons: vscode.workspace.getConfiguration("saropaWorkspace.releaseBoard").get<boolean>("sectionIcons", true), ...(hintVisible(this.context, this.run.cfg) ? { hint: true } : {}), ...this.chats.view() };
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
      { needs: marks.needs, rejected: marks.rejected, pins: pinnedKeys(marks), outside: this.outside, sittings: sittingsInput(this.context), tidy: tidyInput(), live: liveInput(this.live), inProgress: inProgressInput(this.edited) }
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
    const fset = readFutureSettings();
    const future: FutureView | undefined = fset.enabled ? { items: this.future.items, outside: this.future.outside, sort: this.futureSort ?? fset.defaultSort, canEdit: !state.stale && !state.loading, researchParallel: fset.researchParallel } : undefined;
    this.futureShown = future?.items ?? [];
    this.futureOutsideShown = future?.outside ?? [];
    const key = JSON.stringify([this.model, state, this.paths, since, trains, future]);
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
    this.panel.webview.html = renderBoard(this.model, strings(), nonce, this.rev, state, this.paths, since, trains, future);
  }
  protected dispose(): void {
    this.onClosed();
    setPanelVisible(false);
    this.disposed = true;
    this.outsideToken++;
    this.liveToken++;
    clearTimeout(this.timer);
    clearTimeout(this.liveTimer);
    clearTimeout(this.editedTimer);
    this.editedToken++;
    this.chats.dispose();
    this.panel.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}
