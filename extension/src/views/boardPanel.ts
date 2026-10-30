import * as vscode from "vscode";
import { BoardRun, acceptBoardRun, enableDailyReport, openRulesFile, runHealthNow } from "../commands/releaseBoardCommands";
import { l10n } from "../i18n/l10n";
import { SHARED_FILE, clearSharedRejected } from "../commands/boardMarks";
import { moveToArchive } from "../commands/boardTidy";
import { findNewestReportUri } from "../commands/boardRecipeEvidence";
import { startBugDocument } from "../commands/boardLive";
import { chooseColumn, parsePlacement } from "../board/placement";
import { currentBoard } from "./boardFeed";
import { markSeenNow } from "./boardSinceLast";
import { PLACEMENT_KEY, applySuggestion, closeFailedOpen, rememberColumn, rejectProposals, undoRejected, openDocument, openExternalLink, openSittingsLine, saveSitting, documentColumn } from "./boardPanelActions";
import { BoardPanelFuture } from "./boardPanelFuture";
import { editBlocker, readFutureSettings, setFutureField, setResearchQuestion } from "../commands/boardFuture";
import { handResearch, markReviewed } from "../commands/boardFutureResearch";
import { targetsOf } from "../board/patch";
import { applyRows, changedOnDisk, remainingFiles, savePastedPatch, undoBatch } from "../commands/boardPatch";
import { DocChange, RulesSnapshot, assignFolderRule, changeDoc, previewFolder, readGroupNames, undoRulesWrite } from "../commands/boardRuleAssign";
import { SEVERITY_LEVELS, ruleCategories } from "../board/ruleAssign";
import { pickGroup } from "../commands/boardGroupPick";
import { changeNeeds, undoDocWrite } from "../commands/boardNeeds";
import { NeedsDirection, NeedsPick, pickNeeds } from "./boardNeedsPick";
import { planDrop } from "../board/boardDrop";
import { cardRows } from "../board/boardHtmlGroups";
import { ganttRows } from "../board/boardHtmlGantt";
import { pl } from "../board/boardHtmlUtil";
import { strings } from "./boardStrings";
import type { BoardItem, BoardModel } from "../board/boardModel";
import { researchQueue } from "../board/futureResearch";
import { busyMessage, busyReason } from "./boardBusy";
import { TagsEditorInput, openTagsEditor } from "./tagsEditorPanel";
import { matchedTagIds, settingsOf } from "../board/org/settings";
import { readKeywordSettings } from "../commands/boardKeywordSettings";
import { saveSeverity } from "../commands/boardSeverityEdit";
import { setStartup } from "./boardStartup";
import { handoffAct, handoffDoc, openMessage, parseRequest, scopeOfMenu } from "./boardHandoff";
import { writeGroupBy, writeProjectScope } from "../commands/boardExtraProjects";
import { GROUP_BYS } from "../board/types";
import { chooseProjects, openBoardSettings } from "./boardProjectsFlow";
import { FUTURE_SORTS, FutureItem, FutureSort, blockKeyOf, foldersFor, isFieldValue } from "../board/futureList";

// The Release Board first screen, an editor-tab webview. One instance: opening it again
// reveals it and rescans. The page is static HTML under a strict CSP; its only messages
// are "refresh", "accept", "profile", "suggest", "rules", "open <id>", "external <group,
// item>", "path <project, step>", "tidy <index>", "liveBug <index>", "handoff <scope, indexes, task, format>", "linksOpen <low>", "linksNot <index>", "linksUnreject", "handoffAct <act, scope, indexes, task, format>", "scopeMenu <entry, scope>", "futureSet <index, field, value>", "futureBlocker <index>", "futureQuestion <index, value>", "futureReviewed <index>", "futureHand", "futureOpen <index>", "futureSort <value>", "startup <boolean>", "scope <all or openOnly>", "assign <index>", "preview <index>", "keywords", "keywordsRestore" and "chatPoll", and the host resolves each id or index against the model it rendered, so the page
// can never name an arbitrary path or address.

let current: BoardPanel | undefined;
class BoardPanel extends BoardPanelFuture {
  // Run buttons in flight (project:kind) and a review dialog that is open: a second click is ignored.
  private readonly starting = new Set<string>();
  private reviewing = false;
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
      if (msg.type === "handoff" || msg.type === "handoffAct") {
        void vscode.window.showInformationMessage(l10n("releaseBoard.handoff.stale"));
      } else if (msg.type === "drop") {
        void vscode.window.showInformationMessage(l10n("releaseBoard.drop.stale"));
      }
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
    } else if (msg.type === "handoff" || msg.type === "handoffAct") {
      const req = parseRequest(message as Record<string, unknown>);
      if (req && msg.type === "handoff") {
        handoffDoc(this.post, this.model, this.run, req);
      } else if (req) {
        await handoffAct(this.post, this.model, this.run, req, (message as { act?: unknown }).act);
      }
    } else if (msg.type === "scopeMenu" && ["hand", "tags"].includes((message as { act?: unknown }).act as string) && typeof (message as { id?: unknown }).id === "string") {
      const at = scopeOfMenu((message as { id: string }).id);
      if (at && (message as { act?: unknown }).act === "tags") {
        await this.tagsRules(this.scopeItems(at.scope, at.i));
      } else if (at) {
        this.post(openMessage(at.scope, at.i));
      }
    } else {
      await this.onActionMessage(message as Record<string, unknown>);
    }
  }

  // Draws the rows of a closed card or a "Show more" with the row renderer of the page and sends them back.
  // It always replies, with an empty result when there is nothing to draw, so the page never waits.
  private sendRows(id: string, by: unknown, from: number): void {
    const model = this.model;
    const t = strings();
    const valid = by === "group" || by === "status" || by === "severity" || by === "gantt";
    const out = !model || !valid ? undefined : by === "gantt" ? ganttRows(model, t, this.since, id, from) : cardRows(model, by, id, from, new Map(model.projects.map((p) => [p.id, p.name])), t);
    void this.panel.webview.postMessage({ type: "rows", id, by: typeof by === "string" ? by : "", from, html: out ? out.html : "", label: out ? pl(t, "rowsShown", { count: out.count }) : "", rev: this.rev });
  }

  private async onActionMessage(message: Record<string, unknown>): Promise<void> {
    if (message.type === "tidy" && typeof message.i === "number") {
      await this.tidyMove(message.i);
    } else if (message.type === "tidyReport" && typeof message.i === "number") {
      await this.tidyReport(message.i);
    } else if (message.type === "liveBug" && typeof message.i === "number") {
      await this.liveBug(message.i);
    } else if (message.type === "futureSet" || message.type === "futureBlocker" || message.type === "futureQuestion" || message.type === "futureReviewed") {
      await this.futureEdit(message);
    } else if (message.type === "futureHand") {
      await this.futureHand();
    } else if (message.type === "futureOpen") {
      await this.futureOpen(message);
    } else if (message.type === "futureSort" && FUTURE_SORTS.includes(message.value as FutureSort)) {
      this.futureSort = message.value as FutureSort;
      this.lastKey = "";
      this.render(this.cached ? { stale: true } : {});
    } else if ((message.type === "assign" || message.type === "preview") && typeof message.i === "number") {
      await this.noRule(message.type, message.i);
    } else if (message.type === "projects" || message.type === "boardSettings" || message.type === "hintDismiss") {
      await this.projectsMessage(message.type);
    } else if (message.type === "groupBy" && GROUP_BYS.some((g) => g === message.value)) {
      // The setting change draws the board again through the configuration listener.
      await writeGroupBy(GROUP_BYS.find((g) => g === message.value)!);
    } else if (message.type === "scope" && (message.value === "all" || message.value === "openOnly")) {
      await writeProjectScope(message.value);
    } else if (message.type === "rows" && typeof message.id === "string" && message.id.length <= 1000 && typeof message.from === "number") {
      this.sendRows(message.id, message.by, message.from);
    } else if (message.type === "chatPoll") {
      this.chats.toggle();
    } else if (message.type === "drop") {
      await this.drop(message);
    } else if (message.type === "rowMenu" && typeof message.id === "number" && typeof message.act === "string") {
      await this.rowMenu(message.act, message.id);
    } else if (message.type === "optsMenu" && typeof message.act === "string") {
      await this.optsMenu(message.act);
    } else if (message.type === "keywords" || message.type === "keywordsRestore") {
      await this.keywords(message.type === "keywordsRestore");
    } else if (message.type === "patchRead" && typeof message.text === "string") {
      this.patches.read(message.text, "paste");
    } else if (message.type === "patchOpen") {
      this.patches.open();
    } else if (message.type === "patchApply" && Array.isArray(message.ids)) {
      await this.patchApply(message.ids.filter((x): x is number => Number.isInteger(x)));
    } else if (message.type === "linksOpen") {
      this.patches.readLinks(message.low === true);
    } else if (message.type === "linksNot" && Number.isInteger(message.i)) {
      // One proposal turned down; the list is drawn again from the board once the mark is saved.
      const key = this.patches.rejectedKey(message.i as number);
      if (key) {
        this.patches.lastRejected = await rejectProposals(this.context, [key]);
      }
    } else if (message.type === "linksUnreject") {
      // Only what the last Reject added; the shared file's rejections are cleared on their own, with a confirmation.
      const keys = this.patches.lastRejected;
      this.patches.lastRejected = [];
      await undoRejected(this.context, keys);
      this.patches.reshowLinks();
    } else if (message.type === "linksClearShared") {
      const yes = l10n("releaseBoard.sharedRejectedYes");
      if ((await vscode.window.showWarningMessage(l10n("releaseBoard.sharedRejectedConfirm", { file: SHARED_FILE }), { modal: true }, yes)) === yes) {
        await clearSharedRejected();
      }
    } else if (message.type === "patchReject") {
      // For the proposed links the unticked rows are remembered as rejected; the ticked ones stay proposed.
      const keys = this.patches.rejectedKeys(Array.isArray(message.ids) ? message.ids.filter((x): x is number => Number.isInteger(x)) : []);
      this.patches.clear();
      this.post({ type: "patchDone", applied: 0, skipped: 0 });
      if (keys.length > 0) {
        this.patches.lastRejected = await rejectProposals(this.context, keys);
        this.dirty = true;
        await this.refresh();
      }
    } else if (message.type === "undoDismiss") {
      clearTimeout(this.undo?.timer);
      this.undo = undefined;
      this.post({ type: "undoOff" });
    } else if (message.type === "undo") {
      await this.undoChange();
    } else if (message.type === "startup") {
      await this.startup(message.value);
    } else if (message.type === "rules") {
      await openRulesFile(undefined, documentColumn());
    } else if (message.type === "accept") {
      await this.accept();
    } else if (message.type === "sinceDismiss") {
      markSeenNow(this.model);
    } else if (message.type === "open" && typeof message.id === "number") {
      await this.openItem(message.id);
    } else if (message.type === "path" && typeof message.p === "number" && typeof message.s === "number") {
      await this.pathAction(message.p, message.s);
    }
  }

  // The Projects and Settings buttons and the hint of the top bar. The page sends the kind only.
  private async projectsMessage(kind: string): Promise<void> {
    if (kind === "projects") {
      await chooseProjects();
    } else if (kind === "boardSettings") {
      await openBoardSettings();
    } else {
      await this.dismissHint();
    }
  }

  // The start-up checkbox: the page sent a boolean. On success the setting change repaints the
  // board; only a refused value or a failed write paints it again, to put the box back.
  private async startup(value: unknown): Promise<void> {
    let ok = false;
    try {
      ok = await setStartup(this.context, value);
    } catch (e) {
      void vscode.window.showErrorMessage(l10n("releaseBoard.failed", { error: e instanceof Error ? e.message : String(e) }));
    }
    if (!ok) {
      this.lastKey = "";
      this.render(this.scanning ? { loading: true } : this.cached ? { stale: true } : {});
    }
  }

  // The index is resolved against the list this panel rendered, never a path from the page.
  private async liveBug(i: number): Promise<void> {
    const u = this.model?.liveUnnamed?.[i];
    const project = this.run?.cfg.projects.find((p) => p.id === u?.project);
    if (u && project && !this.scanning && !this.cached) {
      try {
        if (await startBugDocument(vscode.Uri.parse(project.path), u, this.liveDays, documentColumn())) {
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


  // An entry of the board options menu.
  private async optsMenu(act: string): Promise<void> {
    if (act === "rules") {
      await openRulesFile(undefined, documentColumn());
    } else if (act === "handBoard") {
      this.post(openMessage("board"));
    } else if (act === "organize") {
      this.post({ ...openMessage("board"), task: "organize" });
    } else if (act === "bringBack") {
      this.post({ type: "handoffBack" });
    } else if (act === "keywords") {
      await this.keywords(false);
    } else if (act === "tagsRules") {
      await this.tagsRules();
    } else if (act === "projects" || act === "settings") {
      await this.projectsMessage(act === "settings" ? "boardSettings" : "projects");
    }
  }

  // The Tags and rules editor. It gets the model this panel painted; nothing the page names is trusted.
  // The documents of a project or group heading ("group": the group the item at `i` is in).
  private scopeItems(scope: string, i: number): BoardItem[] {
    const items = this.model?.items ?? [];
    const at = items[i];
    return !at ? [] : scope === "group" ? items.filter((x) => x.project === at.project && x.group === at.group) : items.filter((x) => x.project === at.project);
  }

  // The keyword editor, or Restore defaults. Both change what every document's severity is, and so
  // possibly the light, so each asks first (the editor on Save). The editor gets the model this
  // panel painted; nothing the page names is trusted.
  private async keywords(restore: boolean): Promise<void> {
    const run = this.run;
    const model = this.model;
    if (!readKeywordSettings().enabled) {
      void vscode.window.showInformationMessage(l10n("releaseBoard.keywords.msg.disabled"));
      return;
    }
    if (!run || !model) {
      void vscode.window.showInformationMessage(l10n("releaseBoard.keywords.msg.noBoard"));
      return;
    }
    const busy = this.busyReason();
    if (busy) {
      void vscode.window.showInformationMessage(this.busyText(busy));
      return;
    }
    if (!restore) {
      await openTagsEditor({ ...this.editorInput(run, model), tab: "severity" });
      return;
    }
    const onSaved = async (): Promise<void> => {
      this.dirty = true;
      await this.refresh();
    };
    this.assigning = true;
    try {
      if ((await saveSeverity({ kind: "restore" })) === "saved") {
        await onSaved();
      }
    } catch (e) {
      void vscode.window.showErrorMessage(l10n("releaseBoard.failed", { error: e instanceof Error ? e.message : String(e) }));
    } finally {
      this.assigning = false;
    }
  }

  // Opens the newest report behind a read-only Tidy row. The index is resolved against the list
  // this panel rendered; the report is found again in that project's reports folder.
  private async tidyReport(i: number): Promise<void> {
    const r = this.model?.tidy?.reports[i];
    const project = this.run?.cfg.projects.find((p) => p.id === r?.project);
    if (!r || !project) {
      return;
    }
    const uri = await findNewestReportUri(vscode.Uri.parse(project.path), r.kind);
    if (uri) {
      await openDocument(uri);
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
    } else if ((step.kind === "build" || step.kind === "lint" || step.kind === "tests") && step.enable) {
      const flight = `${def.id}:${step.kind}:enable`;
      if (this.starting.has(flight)) {
        return;
      }
      this.starting.add(flight);
      try {
        if (await enableDailyReport(def, step.kind)) {
          this.dirty = true;
          await this.refresh();
        }
      } finally {
        this.starting.delete(flight);
      }
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
      await openRulesFile({ project: def.id, folder: step.folder ?? "" }, documentColumn());
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
    // No column is passed, so the tab stays in the group it is in now.
    current.reveal();
    if (current.needsRefresh()) {
      await current.refresh();
    }
    return;
  }
  const column = chooseColumn({
    setting: parsePlacement(vscode.workspace.getConfiguration("saropaWorkspace.releaseBoard").get("placement")),
    stored: context.workspaceState.get(PLACEMENT_KEY),
    groupCount: vscode.window.tabGroups.all.length,
    // The active group, also when a webview or settings tab is active; undefined when nothing is open.
    activeColumn: vscode.window.tabGroups.all.some((g) => g.tabs.length > 0) ? vscode.window.tabGroups.activeTabGroup.viewColumn : undefined,
    background
  });
  const panel = vscode.window.createWebviewPanel(
    "saropaWorkspace.releaseBoard",
    l10n("releaseBoard.panel.title"),
    { viewColumn: column, preserveFocus: background },
    { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [] }
  );
  // Anything that fails while the tab is set up closes it again: no blank tab is left behind.
  try {
    rememberColumn(context, panel);
    current = new BoardPanel(context, panel);
  } catch (e) {
    current = undefined;
    closeFailedOpen(panel, e, background);
    return;
  }
  const fresh = background ? currentBoard() : undefined;
  if (fresh) {
    current.seed(fresh.run);
    return;
  }
  await current.showCached();
  await current.refresh();
}