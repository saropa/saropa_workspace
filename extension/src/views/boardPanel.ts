import * as crypto from "node:crypto";
import * as vscode from "vscode";
import { onDidRecordHealth } from "../commands/boardHealth";
import { onDidChangeMarks, readMarks, updateLocalMarks } from "../commands/boardMarks";
import { applyMarks, pinnedKeys } from "../board/marks";
import { BoardRun, acceptBoardRun, canRunHealth, hasOutsideProject, openRulesFile, readLastRun, runBoardScan, runHealthNow } from "../commands/releaseBoardCommands";
import { buildBoard, BoardModel } from "../board/boardModel";
import { PathToGo, clampMaxSteps, pathToGo } from "../board/pathToGo";
import { BoardStrings, RenderState, escapeHtml, renderBoard, renderSkeleton } from "../board/boardHtml";
import { l10n } from "../i18n/l10n";
import { Outside, emptyOutside, safeUrl } from "../board/outside";
import { loadOutside, onDidChangeProviders } from "../commands/boardOutside";
import { readSittingsSettings, readSittingsChoice, saveSittingsChoice } from "../commands/boardSittings";
import { asTimeBox } from "../board/sittings";
import { publishBoard } from "./editorLinks";
import { copyHandPrompt, readHandSettings } from "../commands/boardHandToChat";
import { formatPrompt, itemTarget, lineTarget, stepTarget, HandTarget } from "../board/handToChat";
import { currentBoard, markPanelOpened, markScanDone, onDidAskRefresh, setFailed, setPanelVisible } from "./boardFeed";

// The Release Board first screen, an editor-tab webview. One instance: opening it again
// reveals it and rescans. The page is static HTML under a strict CSP; its only messages
// are "refresh", "accept", "profile", "suggest", "rules", "open <id>", "external <group,
// item>" and "path <project, step>" and "hand <kind, index>", and the host resolves each id or index against the model it rendered, so the page
// can never name an arbitrary path or address.

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
    reasonUnread: l10n("releaseBoard.panel.reasonUnread"),
    go: l10n("releaseBoard.panel.go"),
    healthLint: l10n("releaseBoard.panel.healthLint"),
    healthTests: l10n("releaseBoard.panel.healthTests"),
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
    suggestHeading: l10n("releaseBoard.panel.suggestHeading"),
    suggestNote: l10n("releaseBoard.panel.suggestNote"),
    suggestAccept: l10n("releaseBoard.panel.suggestAccept"),
    suggestReject: l10n("releaseBoard.panel.suggestReject"),
    needsRuleNote: l10n("releaseBoard.panel.needsRuleNote"),
    loading: l10n("releaseBoard.panel.loading"),
    refreshing: l10n("releaseBoard.panel.refreshing"),
    chatsTitle: l10n("releaseBoard.panel.chatsTitle", { count: "{count}" }),
    ptgNone: l10n("releaseBoard.panel.ptgNone"),
    ptgItemRed: l10n("releaseBoard.panel.ptgItemRed"),
    ptgItemPinned: l10n("releaseBoard.panel.ptgItemPinned"),
    ptgItemSeverity: l10n("releaseBoard.panel.ptgItemSeverity"),
    ptgUnblocks: l10n("releaseBoard.panel.ptgUnblocks"),
    ptgWaiter: l10n("releaseBoard.panel.ptgWaiter"),
    ptgItemFirst: l10n("releaseBoard.panel.ptgItemFirst"),
    ptgItemFirstAny: l10n("releaseBoard.panel.ptgItemFirstAny"),
    ptgBlocked: l10n("releaseBoard.panel.ptgBlocked"),
    ptgLintMissing: l10n("releaseBoard.panel.ptgLintMissing"),
    ptgLintFailing: l10n("releaseBoard.panel.ptgLintFailing"),
    ptgTestsMissing: l10n("releaseBoard.panel.ptgTestsMissing"),
    ptgTestsFailing: l10n("releaseBoard.panel.ptgTestsFailing"),
    ptgRules: l10n("releaseBoard.panel.ptgRules"),
    ptgRulesAny: l10n("releaseBoard.panel.ptgRulesAny"),
    ptgUnread: l10n("releaseBoard.panel.ptgUnread"),
    ptgAccept: l10n("releaseBoard.panel.ptgAccept"),
    ptgMore: l10n("releaseBoard.panel.ptgMore"),
    ptgOpen: l10n("releaseBoard.panel.ptgOpen"),
    ptgRunLint: l10n("releaseBoard.panel.ptgRunLint"),
    ptgRunTests: l10n("releaseBoard.panel.ptgRunTests"),
    ptgOpenRules: l10n("releaseBoard.panel.ptgOpenRules"),
    ptgAcceptBtn: l10n("releaseBoard.panel.ptgAcceptBtn"),
    sittingsButton: l10n("releaseBoard.sittings.button"),
    sittingsHeading: l10n("releaseBoard.sittings.heading"),
    sittingsPick: l10n("releaseBoard.sittings.pick"),
    sittingsNone: l10n("releaseBoard.sittings.none"),
    sittingsMore: l10n("releaseBoard.sittings.more", { count: "{count}" }),
    sittingsNeedOther: l10n("releaseBoard.sittings.needOther", { count: "{count}" }),
    sittingsTooLong: l10n("releaseBoard.sittings.tooLong", { count: "{count}" }),
    sittingsUntagged: l10n("releaseBoard.sittings.untagged", { count: "{count}" }),
    sittingsUntaggedNote: l10n("releaseBoard.sittings.untaggedNote"),
    timeAny: l10n("releaseBoard.sittings.timeAny"),
    timeMinutes: l10n("releaseBoard.sittings.timeMinutes", { count: "{count}" }),
    stepMinutes: l10n("releaseBoard.sittings.stepMinutes", { count: "{count}" }),
    handToChat: readHandSettings().enabled ? l10n("releaseBoard.handToChat.button") : "",
    handToChatTip: l10n("releaseBoard.handToChat.tip"),
  };
}

// Path to GO settings, read from the editor settings. Undefined when the feature is off.
function pathSettings(): { maxSteps: number; showRunButtons: boolean } | undefined {
  const c = vscode.workspace.getConfiguration("saropaWorkspace.releaseBoard.pathToGo");
  if (!c.get<boolean>("enabled", true)) {
    return undefined;
  }
  return { maxSteps: clampMaxSteps(c.get<number>("maxSteps", 8)), showRunButtons: c.get<boolean>("showRunButtons", true) };
}

function emptyPage(text: string): string {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"></head><body style="font-family:var(--vscode-font-family);color:var(--vscode-foreground);padding:16px"><p>${escapeHtml(text)}</p></body></html>`;
}

class BoardPanel {
  private model: BoardModel | undefined;
  // One Path to GO per project, in the order of model.projects: what the page shows, so a
  // click's indexes are resolved against exactly this.
  private paths: PathToGo[] | undefined;
  // Run buttons in flight (project:kind) and a review dialog that is open: a second click is ignored.
  private readonly starting = new Set<string>();
  private reviewing = false;
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
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly panel: vscode.WebviewPanel
  ) {
    panel.onDidDispose(() => this.dispose(), null, this.disposables);
    // While the tab is showing it owns the scan: the sidebar's refresh button asks it.
    markPanelOpened();
    setPanelVisible(panel.visible);
    panel.onDidChangeViewState(() => setPanelVisible(panel.visible), null, this.disposables);
    onDidAskRefresh(() => this.poke(0), null, this.disposables);
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
    onDidChangeProviders(() => void this.refreshOutside(), null, this.disposables);
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
        }
      },
      null,
      this.disposables
    );
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
    panel.onDidChangeViewState(() => this.panel.visible && this.dirty && this.schedule(0), null, this.disposables);
    panel.webview.onDidReceiveMessage((m: unknown) => void this.onMessage(m), null, this.disposables);
    // Something is on screen at once: placeholders, then the last result, then the scan.
    panel.webview.html = renderSkeleton(strings(), crypto.randomBytes(16).toString("base64"));
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
      { needs: marks.needs, rejected: marks.rejected, pins: pinnedKeys(marks), outside: this.outside, sittings: this.sittings() }
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
    // The same board in the same state is not painted again: no flicker, no lost scroll.
    const key = JSON.stringify([this.model, state, this.paths, readHandSettings().enabled]);
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
    this.panel.webview.html = renderBoard(this.model, strings(), nonce, this.rev, state, this.paths);
  }

  // The Sittings choice (remembered per machine, else the settings' defaults) with the
  // settings' limits; undefined when the feature is off.
  private sittings(): { selection: { have: string[]; timeBox: ReturnType<typeof asTimeBox>; maxSteps: number }; onlyOwner: boolean } | undefined {
    const s = readSittingsSettings();
    if (!s.enabled) {
      return undefined;
    }
    const choice = readSittingsChoice(this.context) ?? { have: s.defaultHave, timeBox: s.defaultTimeBox };
    return { selection: { have: choice.have, timeBox: choice.timeBox, maxSteps: s.maxSteps }, onlyOwner: s.onlyOwnerDocuments };
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
      // Only a suggestion the page was actually shown can be acted on.
      const shown = this.model?.suggestions.find((s) => s.key === msg.key);
      if (shown) {
        await updateLocalMarks(this.context, (local) => {
          if (msg.value === "reject") {
            local.rejected = [...new Set([...local.rejected, shown.key])];
          } else {
            local.needs[shown.fromKey] = [...new Set([...(local.needs[shown.fromKey] ?? []), `${shown.toProject}:${shown.toPath}`])];
          }
          return local;
        });
      }
    } else if (msg.type === "external" && typeof (message as { g?: unknown }).g === "number" && typeof (message as { i?: unknown }).i === "number") {
      // Only a link the page was actually shown can be opened, and only over https.
      const m = message as { g: number; i: number };
      const url = safeUrl(this.model?.outside[m.g]?.items[m.i]?.url);
      if (url) {
        await vscode.env.openExternal(vscode.Uri.parse(url));
      }
    } else if (msg.type === "sitting") {
      // Only toggles the page was shown can be chosen; the remembered choice repaints the board.
      const m = message as { have?: unknown; box?: unknown };
      const known = new Set(this.model?.sittings?.contexts.map((c) => c.id));
      const have = Array.isArray(m.have) ? m.have.filter((x): x is string => typeof x === "string" && known.has(x)) : [];
      await saveSittingsChoice(this.context, { have, timeBox: asTimeBox(m.box) });
      this.lastKey = "";
      this.render(this.cached ? { stale: true } : {});
    } else if (msg.type === "step" && typeof (message as { i?: unknown }).i === "number") {
      // A line the page was shown opens its document at the step's line.
      const line = this.model?.sittings?.lines[(message as { i: number }).i];
      const project = this.run?.cfg.projects.find((p) => p.id === line?.project);
      if (line && project) {
        const uri = vscode.Uri.joinPath(vscode.Uri.parse(project.path), line.path);
        const pos = new vscode.Position(Math.max(0, line.line - 1), 0);
        try {
          await vscode.window.showTextDocument(uri, { preview: true, selection: new vscode.Range(pos, pos) });
        } catch (e) {
          void vscode.window.showErrorMessage(l10n("releaseBoard.failed", { error: e instanceof Error ? e.message : String(e) }));
        }
      }
    } else if (msg.type === "hand") {
      await this.hand(message as { k?: unknown; i?: unknown; p?: unknown; s?: unknown });
    } else if (msg.type === "rules") {
      await openRulesFile();
    } else if (msg.type === "accept") {
      await this.accept();
    } else if (msg.type === "open" && typeof msg.id === "number") {
      await this.openItem(msg.id);
    } else if (msg.type === "path" && typeof (message as { p?: unknown }).p === "number" && typeof (message as { s?: unknown }).s === "number") {
      const m = message as { p: number; s: number };
      await this.pathAction(m.p, m.s);
    }
  }

  // Hand to chat: the page names an item, a step or a Sittings line by index; the prompt is
  // built from the model this panel rendered and copied to the clipboard.
  private async hand(m: { k?: unknown; i?: unknown; p?: unknown; s?: unknown }): Promise<void> {
    const settings = readHandSettings();
    const model = this.model;
    if (!settings.enabled || !model) {
      return;
    }
    let target: HandTarget | undefined;
    let file: { project: string; path: string } | undefined;
    if (m.k === "item" && typeof m.i === "number" && model.items[m.i]) {
      const it = model.items[m.i];
      target = itemTarget(model, it);
      file = it;
    } else if (m.k === "line" && typeof m.i === "number" && model.sittings?.lines[m.i]) {
      const l = model.sittings.lines[m.i];
      target = lineTarget(model, l);
      file = l;
    } else if (m.k === "step" && typeof m.p === "number" && typeof m.s === "number") {
      const project = model.projects[m.p];
      const step = this.paths?.[m.p]?.steps[m.s];
      if (project && step) {
        target = stepTarget(model, project, step);
        const item = step.kind === "item" && step.itemId !== undefined ? model.items[step.itemId] : undefined;
        file = item;
      }
    }
    if (!target) {
      return;
    }
    const def = this.run?.cfg.projects.find((p) => p.id === file?.project);
    const doc = def && file ? vscode.Uri.joinPath(vscode.Uri.parse(def.path), file.path) : undefined;
    try {
      await copyHandPrompt(formatPrompt(target, settings.detail), doc, settings.openChat);
    } catch (e) {
      void vscode.window.showErrorMessage(l10n("releaseBoard.failed", { error: e instanceof Error ? e.message : String(e) }));
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
      const uri = vscode.Uri.joinPath(vscode.Uri.parse(project.path), item.path);
      try {
        await vscode.window.showTextDocument(uri, { preview: true });
      } catch (e) {
        void vscode.window.showErrorMessage(l10n("releaseBoard.failed", { error: e instanceof Error ? e.message : String(e) }));
      }
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
    this.disposed = true;
    this.outsideToken++;
    clearTimeout(this.timer);
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
