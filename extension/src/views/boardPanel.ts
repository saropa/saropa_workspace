import * as vscode from "vscode";
import { BoardRun, acceptBoardRun, enableDailyReport, openRulesFile, runHealthNow } from "../commands/releaseBoardCommands";
import { l10n } from "../i18n/l10n";
import { moveToArchive } from "../commands/boardTidy";
import { findNewestReportUri } from "../commands/boardRecipeEvidence";
import { startBugDocument } from "../commands/boardLive";
import { chooseColumn, parsePlacement } from "../board/placement";
import { currentBoard } from "./boardFeed";
import { markSeenNow } from "./boardSinceLast";
import { applySuggestion, openDocument, openExternalLink, openSittingsLine, saveSitting, setBoardColumnSource, documentColumn } from "./boardPanelActions";
import { BoardPanelWiring } from "./boardPanelWiring";
import { editBlocker, readFutureSettings, setFutureField, setResearchQuestion } from "../commands/boardFuture";
import { handResearch, markReviewed } from "../commands/boardFutureResearch";
import { applyRows, remainingFiles, savePastedPatch, undoBatch } from "../commands/boardPatch";
import { DocChange, RulesSnapshot, assignFolderRule, changeDoc, previewFolder, readGroupNames, undoRulesWrite } from "../commands/boardRuleAssign";
import { SEVERITY_LEVELS, ruleCategories } from "../board/ruleAssign";
import { pickGroup } from "../commands/boardGroupPick";
import { changeNeeds, undoDocWrite } from "../commands/boardNeeds";
import { NeedsDirection, NeedsPick, pickNeeds } from "./boardNeedsPick";
import { planDrop } from "../board/boardDrop";
import type { BoardItem } from "../board/boardModel";
import { researchQueue } from "../board/futureResearch";
import { busyReason } from "./boardBusy";
import { openKeywordEditor } from "./keywordEditorPanel";
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
// item>", "path <project, step>", "tidy <index>", "liveBug <index>", "handoff <scope, indexes, task, format>", "handoffAct <act, scope, indexes, task, format>", "scopeMenu <entry, scope>", "futureSet <index, field, value>", "futureBlocker <index>", "futureQuestion <index, value>", "futureReviewed <index>", "futureHand", "futureOpen <index>", "futureSort <value>", "startup <boolean>", "scope <all or openOnly>", "assign <index>", "preview <index>", "keywords", "keywordsRestore" and "chatPoll", and the host resolves each id or index against the model it rendered, so the page
// can never name an arbitrary path or address.

let current: BoardPanel | undefined;
// How long Undo stays offered after a change.
const UNDO_MS = 10_000;
const PLACEMENT_KEY = "saropaWorkspace.releaseBoard.column";

class BoardPanel extends BoardPanelWiring {
  // Run buttons in flight (project:kind) and a review dialog that is open: a second click is ignored.
  private readonly starting = new Set<string>();
  private reviewing = false;
  // A Future tab edit (with its dialogs) is under way: a second one is ignored.
  private editing = false;
  // A tidy move (with its confirmation) is under way: a second click is ignored.
  private moving = false;
  // A rule is being assigned to a folder (with its dialogs): a second click is ignored.
  private assigning = false;

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
    } else if (msg.type === "scopeMenu" && (message as { act?: unknown }).act === "hand" && typeof (message as { id?: unknown }).id === "string") {
      const at = scopeOfMenu((message as { id: string }).id);
      if (at) {
        this.post(openMessage(at.scope, at.i));
      }
    } else {
      await this.onActionMessage(message as Record<string, unknown>);
    }
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
    } else if (message.type === "patchReject") {
      this.patches.clear();
      this.post({ type: "patchDone", applied: 0, skipped: 0 });
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
      } else if (message.type === "futureQuestion") {
        if (typeof message.value === "string") {
          await setResearchQuestion(target.root, target.item, message.value);
        }
      } else if (message.type === "futureReviewed") {
        if (target.item.research === "ready") {
          await markReviewed(target.root, target.item);
        }
      } else if (key && isFieldValue(field, message.value)) {
        await setFutureField(target.root, target.item, key, message.value, this.run ? foldersFor(this.run.cfg, target.item.project) : undefined);
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

  // Hands the next batch of flagged documents to a chat, one prompt each. The batch is
  // chosen here from the list this panel painted and the setting, never from the page.
  private async futureHand(): Promise<void> {
    const run = this.run;
    if (!run || this.cached || this.editing || this.scanning) {
      return;
    }
    this.editing = true;
    try {
      const sort = this.futureSort ?? readFutureSettings().defaultSort;
      const { batch, queued } = researchQueue(this.futureShown, sort, readFutureSettings().researchParallel);
      const entries = batch.flatMap((i) => {
        const item = this.futureShown[i];
        const def = run.cfg.projects.find((p) => p.id === item.project);
        return def ? [{ item, root: vscode.Uri.parse(def.path) }] : [];
      });
      const done = await handResearch(entries);
      if (done.handed > 0) {
        void vscode.window.showInformationMessage(l10n(queued > 0 ? "releaseBoard.future.research.handedQueued" : "releaseBoard.future.research.handed", { count: done.handed, queued }));
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

  // A folder row of "Documents with no rule". The index is resolved against the list this panel
  // rendered. Assigning asks for a category and a confirmation before the rules file is written,
  // then scans again; a preview only reports.
  private async noRule(kind: "assign" | "preview", i: number): Promise<void> {
    const entry = this.model?.needsRule[i];
    const run = this.run;
    if (!entry || !run) {
      return;
    }
    const busy = this.busyReason();
    if (busy) {
      void vscode.window.showInformationMessage(l10n(busy));
      return;
    }
    if (kind === "preview") {
      previewFolder(run, entry);
      return;
    }
    this.assigning = true;
    try {
      if (await assignFolderRule(run, entry)) {
        this.dirty = true;
        await this.refresh();
      }
    } catch (e) {
      void vscode.window.showErrorMessage(l10n("releaseBoard.failed", { error: e instanceof Error ? e.message : String(e) }));
    } finally {
      this.assigning = false;
    }
  }

  private busyReason(): string | undefined {
    return this.baseBusy() ?? (this.undo && this.undo.timer === undefined ? "releaseBoard.undo.pending" : undefined);
  }

  // Busy for a reason other than a half-finished Undo (which only Undo itself may continue).
  private baseBusy(): string | undefined {
    return busyReason({ assigning: this.assigning, scanning: this.scanning, cached: this.cached });
  }

  // Sends a message to the page.
  private readonly post = (m: unknown): void => {
    void this.panel.webview.postMessage(m);
  };

  // An entry of the menu on a document row. The page sent the entry name and the item's index;
  // the document is the one this panel painted at that index.
  private async rowMenu(act: string, id: number): Promise<void> {
    const item = this.model?.items[id];
    const run = this.run;
    if (!item || !run) {
      this.post({ type: "clearPending", id });
      return;
    }
    const folder = item.path.includes("/") ? item.path.slice(0, item.path.lastIndexOf("/")) : "";
    if (act === "open") {
      await this.openItem(id);
    } else if (act === "hand") {
      this.post(openMessage("item", id));
    } else if (act === "rules") {
      await openRulesFile({ project: item.project, folder }, documentColumn());
    } else if (act === "group") {
      // The picker is the host's own dialog: nothing but the entry name comes from the page.
      const picked = await pickGroup(await readGroupNames(), item);
      if (!picked.cancelled) {
        await this.inlineChange(run, item, { kind: "group", name: picked.name }, id);
      }
    } else if (act === "waits" || act === "blocks") {
      await this.needsChange(act, item, run);
    } else if (act === "assign") {
      const busy = this.busyReason();
      if (busy) {
        void vscode.window.showInformationMessage(l10n(busy));
        return;
      }
      this.assigning = true;
      try {
        if (await assignFolderRule(run, { project: item.project, folder, count: 1 }, true)) {
          this.dirty = true;
          await this.refresh();
        }
      } catch (e) {
        void vscode.window.showErrorMessage(l10n("releaseBoard.failed", { error: e instanceof Error ? e.message : String(e) }));
      } finally {
        this.assigning = false;
      }
    } else {
      // A row the page marked as pending is released at once when nothing is written.
      const change = this.docChange(act, item, run);
      if (change) {
        await this.inlineChange(run, item, change, id);
      } else {
        this.post({ type: "clearPending", id });
      }
    }
  }

  // Waits on... and Blocks...: the picker, then one Needs line added or taken out of a document at
  // once, with Undo. The page shows nothing pending: the board is painted again after the write.
  private async needsChange(dir: NeedsDirection, item: BoardItem, run: BoardRun): Promise<void> {
    const busy = this.busyReason();
    if (busy || !this.model) {
      void vscode.window.showInformationMessage(l10n(busy ?? "releaseBoard.failed"));
      return;
    }
    this.assigning = true;
    try {
      const pick = await pickNeeds(run, this.model, item, dir);
      if (pick) {
        await this.writeNeeds(run, pick);
      }
    } catch (e) {
      void vscode.window.showErrorMessage(l10n("releaseBoard.failed", { error: e instanceof Error ? e.message : String(e) }));
    } finally {
      this.assigning = false;
    }
  }

  // Writes one Needs change at once and offers Undo; the board is painted again after the write.
  private async writeNeeds(run: BoardRun, pick: NeedsPick): Promise<void> {
    const snapshot = await changeNeeds(run, pick.doc, pick.change);
    if (snapshot) {
      this.offerUndo(pick.label, () => undoDocWrite(snapshot));
      this.dirty = true;
      await this.refresh();
    }
  }

  // A row dropped on a status band, a group or another row's Waits on slot: saved at once with Undo,
  // through the same writes as the row menu and with no preview. The page named rows, groups and
  // bands by id only; planDrop resolves them against the model this panel painted.
  private async drop(message: Record<string, unknown>): Promise<void> {
    const run = this.run;
    if (!run || !this.model) {
      return;
    }
    const plan = planDrop(message, this.model, { rows: run.result.rows, projects: run.cfg.projects, categories: ruleCategories(run.cfg) });
    if (!plan.ok) {
      void vscode.window.showInformationMessage(l10n(plan.key, plan.vars));
      return;
    }
    const busy = this.busyReason();
    if (busy) {
      void vscode.window.showInformationMessage(l10n(busy === "releaseBoard.rowMenu.busyDialog" ? "releaseBoard.drop.busy" : busy));
      return;
    }
    if (plan.kind === "waits") {
      this.assigning = true;
      try {
        await this.writeNeeds(run, { doc: { project: plan.from.project, path: plan.from.path }, change: { kind: "add", target: plan.target, to: { project: plan.onto.project, path: plan.onto.path } }, label: l10n("releaseBoard.needs.undoAdd", { title: plan.from.title, name: plan.onto.title }) });
      } catch (e) {
        void vscode.window.showErrorMessage(l10n("releaseBoard.failed", { error: e instanceof Error ? e.message : String(e) }));
      } finally {
        this.assigning = false;
      }
    } else {
      await this.inlineChange(run, plan.item, plan.kind === "status" ? { kind: "status", category: plan.category } : { kind: "group", name: plan.name }, plan.item.id);
    }
  }

  // The change a status or severity entry of the row menu stands for, checked against the model
  // this panel painted: a status is a category of the rules, a level is one of the five, Raise and
  // Lower move the document's severity one level. Anything else is not a change.
  private docChange(act: string, item: BoardItem, run: BoardRun): DocChange | undefined {
    if (act === "auto") {
      return { kind: "auto" };
    }
    if (/^status:\d{1,3}$/.test(act)) {
      const category = ruleCategories(run.cfg)[Number(act.slice(7))];
      return category ? { kind: "status", category } : undefined;
    }
    const at = item.severity ? SEVERITY_LEVELS.indexOf(item.severity) : -1;
    const level = act.startsWith("sev:") ? SEVERITY_LEVELS.find((l) => l === act.slice(4)) : act === "raise" && at > 0 ? SEVERITY_LEVELS[at - 1] : act === "lower" && at >= 0 ? SEVERITY_LEVELS[at + 1] : undefined;
    return level ? { kind: "severity", level } : undefined;
  }

  // Saves one status or severity change at once and offers Undo for ten seconds. The page shows the
  // row as pending until the scan after the write paints it again.
  private async inlineChange(run: BoardRun, item: BoardItem, change: DocChange, id: number): Promise<void> {
    const busy = this.busyReason();
    if (busy) {
      void vscode.window.showInformationMessage(l10n(busy));
      this.post({ type: "clearPending", id });
      return;
    }
    this.assigning = true;
    try {
      const snapshot = await changeDoc(run, item, change);
      if (snapshot) {
        const label =
          change.kind === "status"
            ? l10n("releaseBoard.undo.status", { title: item.title, label: change.category.label })
            : change.kind === "severity"
              ? l10n("releaseBoard.undo.severity", { title: item.title, level: change.level })
              : change.kind === "group"
                ? l10n(change.name === undefined ? "releaseBoard.undo.groupRemove" : "releaseBoard.undo.group", { title: item.title, name: change.name ?? "" })
                : l10n("releaseBoard.undo.auto", { title: item.title });
        this.offerUndo(label, () => undoRulesWrite(snapshot));
        this.dirty = true;
        await this.refresh();
      } else {
        // Refused or not written: changeDoc already said why.
        this.post({ type: "clearPending", id });
      }
    } catch (e) {
      void vscode.window.showErrorMessage(l10n("releaseBoard.failed", { error: e instanceof Error ? e.message : String(e) }));
      this.post({ type: "clearPending", id });
    } finally {
      this.assigning = false;
    }
  }

  // Keeps what the last change replaced for ten seconds; the page's bar is taken away when it ends.
  // A batch passes remaining(), the files not yet put back, for the message after a partial Undo.
  private offerUndo(label: string, restore: () => Promise<boolean>, remaining?: () => string[]): void {
    clearTimeout(this.undo?.timer);
    const timer = setTimeout(() => {
      this.undo = undefined;
      void this.panel.webview.postMessage({ type: "undoOff" });
    }, UNDO_MS);
    this.undo = { label, restore, remaining, timer };
  }

  // The Undo button: puts the changed file back, then scans again. The file is only touched while it
  // still holds what the change wrote.
  private async undoChange(): Promise<void> {
    const undo = this.undo;
    if (!undo) {
      return;
    }
    if (this.baseBusy()) {
      this.post({ type: "undoOn" });
      return;
    }
    // The 10-second expiry must not take the bar away while this Undo runs.
    clearTimeout(undo.timer);
    delete undo.timer;
    // The Undo stays available until it succeeds, so a refused one can be tried again.
    this.assigning = true;
    let done = false;
    try {
      done = await undo.restore();
    } catch (e) {
      void vscode.window.showErrorMessage(l10n("releaseBoard.failed", { error: e instanceof Error ? e.message : String(e) }));
    } finally {
      this.assigning = false;
    }
    if (!done) {
      // Part of the batch is still in place: the bar stays (no expiry) until all of it is back or the
      // owner dismisses the bar, and the owner is told exactly which files remain.
      if (undo.remaining) {
        void vscode.window.showWarningMessage(l10n("releaseBoard.undo.remaining", { list: undo.remaining().join(", ") }));
      }
      this.post({ type: "undoOn" });
      this.dirty = true;
      this.lastKey = "";
      await this.refresh();
      return;
    }
    clearTimeout(undo.timer);
    this.undo = undefined;
    this.dirty = true;
    this.lastKey = "";
    await this.refresh();
  }

  // Writes the rows the owner ticked in one step and offers one Undo for all of them. Rows the board
  // no longer offers are left out and counted as skipped.
  private async patchApply(ids: number[]): Promise<void> {
    const picked = this.patches.pick(ids);
    const run = this.run;
    const model = this.model;
    const busy = this.busyReason();
    if (!picked || !run || !model || busy) {
      void vscode.window.showInformationMessage(l10n(busy ?? "releaseBoard.patch.nothing"));
      this.post({ type: "patchDone", applied: 0, skipped: ids.length });
      return;
    }
    this.assigning = true;
    try {
      if (picked.dropped > 0) {
        void vscode.window.showInformationMessage(l10n("releaseBoard.patch.dropped", { count: picked.dropped }));
      }
      const out = await applyRows(run, model, picked.rows);
      const skipped = ids.length - out.applied;
      if (out.problems.length > 0) {
        void vscode.window.showWarningMessage(l10n("releaseBoard.patch.problems", { count: out.problems.length, list: out.problems.slice(0, 5).join("; ") }));
      }
      // Whatever was written can be undone, even when a later row failed.
      const wrote = out.snapshot.rules !== undefined || out.snapshot.docs.length > 0;
      if (wrote) {
        this.offerUndo(l10n("releaseBoard.patch.undo", { count: out.applied, id: picked.name }), () => undoBatch(out.snapshot), () => remainingFiles(out.snapshot));
        if (picked.source === "paste") {
          await savePastedPatch(run, model, picked.rows, picked.text);
        }
        this.patches.clear();
        this.dirty = true;
        await this.refresh();
      }
      this.post({ type: "patchDone", applied: out.applied, skipped });
    } catch (e) {
      void vscode.window.showErrorMessage(l10n("releaseBoard.failed", { error: e instanceof Error ? e.message : String(e) }));
      this.post({ type: "patchDone", applied: 0, skipped: ids.length });
    } finally {
      this.assigning = false;
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
    } else if (act === "projects" || act === "settings") {
      await this.projectsMessage(act === "settings" ? "boardSettings" : "projects");
    }
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
      void vscode.window.showInformationMessage(l10n(busy));
      return;
    }
    const onSaved = async (): Promise<void> => {
      this.dirty = true;
      await this.refresh();
    };
    if (!restore) {
      await openKeywordEditor({ cfg: run.cfg, items: model.items, projectNames: new Map(model.projects.map((p) => [p.id, p.name])), profile: model.profile, onSaved });
      return;
    }
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
  // Remember where the tab is, also after the user drags it to another group.
  let lastColumn = panel.viewColumn;
  const remember = (): void => {
    if (panel.viewColumn !== undefined) {
      lastColumn = panel.viewColumn;
      void context.workspaceState.update(PLACEMENT_KEY, lastColumn);
    }
  };
  remember();
  panel.onDidChangeViewState(remember);
  setBoardColumnSource(() => panel.viewColumn);
  panel.onDidDispose(() => {
    setBoardColumnSource(() => undefined);
    void context.workspaceState.update(PLACEMENT_KEY, lastColumn);
  });
  current = new BoardPanel(context, panel);
  const fresh = background ? currentBoard() : undefined;
  if (fresh) {
    current.seed(fresh.run);
    return;
  }
  await current.showCached();
  await current.refresh();
}