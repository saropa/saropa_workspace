import * as vscode from "vscode";
import { BoardRun, openRulesFile } from "../commands/releaseBoardCommands";
import { l10n } from "../i18n/l10n";
import { openDocument, documentColumn } from "./boardPanelActions";
import { targetsOf } from "../board/patch";
import { applyRows, changedOnDisk, remainingFiles, savePastedPatch, undoBatch } from "../commands/boardPatch";
import { DocChange, assignFolderRule, changeDoc, previewFolder, readGroupNames, undoRulesWrite } from "../commands/boardRuleAssign";
import { SEVERITY_LEVELS, ruleCategories } from "../board/ruleAssign";
import { pickGroup } from "../commands/boardGroupPick";
import { changeNeeds, undoDocWrite } from "../commands/boardNeeds";
import { NeedsDirection, NeedsPick, pickNeeds } from "./boardNeedsPick";
import { planDrop } from "../board/boardDrop";
import type { BoardItem, BoardModel } from "../board/boardModel";
import { busyMessage, busyReason } from "./boardBusy";
import { TagsEditorInput, openTagsEditor } from "./tagsEditorPanel";
import { matchedTagIds, settingsOf } from "../board/org/settings";
import { openMessage } from "./boardHandoff";
import { BoardPanelWiring } from "./boardPanelWiring";

// How long Undo stays offered after a change.
const UNDO_MS = 10_000;

// Why this class exists: the Release Board panel was over the quality gate's file-length cap, so the
// write-with-Undo handlers (row menu, drop, needs, doc and inline changes, patch apply, Undo) live here and
// BoardPanel keeps the message router. State stays on the core class; this layer adds only the
// in-flight guard and the Undo window.
export abstract class BoardPanelEdits extends BoardPanelWiring {
  // A rule is being assigned to a folder (with its dialogs): a second click is ignored.
  protected assigning = false;

  // A folder row of "Documents with no rule". The index is resolved against the list this panel
  // rendered. Assigning asks for a category and a confirmation before the rules file is written,
  // then scans again; a preview only reports.
  protected async noRule(kind: "assign" | "preview", i: number): Promise<void> {
    const entry = this.model?.needsRule[i];
    const run = this.run;
    if (!entry || !run) {
      return;
    }
    const busy = this.busyReason();
    if (busy) {
      void vscode.window.showInformationMessage(this.busyText(busy));
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

  // The words for a busy key; a pending Undo names its Dismiss button and how many files remain.
  protected busyText(key: string): string {
    return busyMessage(key, this.undo?.remaining?.() ?? []);
  }

  protected busyReason(): string | undefined {
    return this.baseBusy() ?? (this.undo && this.undo.timer === undefined ? "releaseBoard.undo.pending" : undefined);
  }

  // Busy for a reason other than a half-finished Undo (which only Undo itself may continue).
  protected baseBusy(): string | undefined {
    return busyReason({ assigning: this.assigning, scanning: this.scanning, cached: this.cached });
  }

  // Sends a message to the page.
  protected readonly post = (m: unknown): void => {
    void this.panel.webview.postMessage(m);
  };

  // An entry of the menu on a document row. The page sent the entry name and the item's index;
  // the document is the one this panel painted at that index.
  protected async rowMenu(act: string, id: number): Promise<void> {
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
    } else if (act === "tags") {
      await this.tagsRules([item]);
    } else if (act === "waits" || act === "blocks") {
      await this.needsChange(act, item, run);
    } else if (act === "assign") {
      const busy = this.busyReason();
      if (busy) {
        void vscode.window.showInformationMessage(this.busyText(busy));
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
      void vscode.window.showInformationMessage(this.busyText(busy ?? "releaseBoard.failed"));
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
  private async writeNeeds(run: BoardRun, pick: NeedsPick, moved?: { item: BoardItem; ctl: number }): Promise<void> {
    const snapshot = await changeNeeds(run, pick.doc, pick.change);
    if (snapshot) {
      this.offerUndo(pick.label, () => undoDocWrite(snapshot));
      this.dirty = true;
      // A keyboard or button chain that is saved: the repaint focuses the pressed row's control again.
      if (moved) {
        this.moved = { project: moved.item.project, path: moved.item.path, ctl: moved.ctl, say: pick.label };
      }
      await this.refresh();
    }
  }

  // A row dropped on a status band, a group or another row's Waits on slot: saved at once with Undo,
  // through the same writes as the row menu and with no preview. The page named rows, groups and
  // bands by id only; planDrop resolves them against the model this panel painted.
  protected async drop(message: Record<string, unknown>): Promise<void> {
    const run = this.run;
    if (!run || !this.model) {
      return;
    }
    const plan = planDrop(message, this.model, { rows: run.result.rows, projects: run.cfg.projects, categories: ruleCategories(run.cfg), groups: run.cfg.groups });
    if (!plan.ok) {
      // A row dropped where it already is gets no notice.
      if (plan.key === "releaseBoard.reorder.firstSay" || plan.key === "releaseBoard.reorder.lastSay") {
        // Alt+Up on the first row, Alt+Down on the last: said aloud by the page, no notice.
        this.post({ type: "say", text: l10n(plan.key, plan.vars) });
      } else if (plan.key !== "") {
        void vscode.window.showInformationMessage(l10n(plan.key, plan.vars));
      }
      return;
    }
    const busy = this.busyReason();
    if (busy) {
      void vscode.window.showInformationMessage(busy === "releaseBoard.rowMenu.busyDialog" ? l10n("releaseBoard.drop.busy") : this.busyText(busy));
      return;
    }
    const ctl = typeof message.ctl === "number" && Number.isInteger(message.ctl) && message.ctl >= 0 && message.ctl < 50 ? message.ctl : 0;
    if (plan.kind === "waits") {
      this.assigning = true;
      try {
        await this.writeNeeds(run, { doc: { project: plan.from.project, path: plan.from.path }, change: { kind: "add", target: plan.target, to: { project: plan.onto.project, path: plan.onto.path } }, label: l10n("releaseBoard.needs.undoAdd", { title: plan.from.title, name: plan.onto.title }) }, message.zone === "chain" ? { item: this.model.items[message.id as number], ctl } : undefined);
      } catch (e) {
        void vscode.window.showErrorMessage(l10n("releaseBoard.failed", { error: e instanceof Error ? e.message : String(e) }));
      } finally {
        this.assigning = false;
      }
    } else {
      const keyboard = message.zone === "move" && plan.kind === "order";
      await this.inlineChange(run, plan.item, plan.kind === "status" ? { kind: "status", category: plan.category } : plan.kind === "order" ? { kind: "order", paths: plan.paths } : { kind: "group", name: plan.name }, plan.item.id, keyboard ? ctl : undefined);
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
  private async inlineChange(run: BoardRun, item: BoardItem, change: DocChange, id: number, focusCtl?: number): Promise<void> {
    const busy = this.busyReason();
    if (busy) {
      void vscode.window.showInformationMessage(this.busyText(busy));
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
                : change.kind === "order"
                  ? l10n("releaseBoard.undo.order", { title: item.title })
                  : l10n("releaseBoard.undo.auto", { title: item.title });
        this.offerUndo(label, () => undoRulesWrite(snapshot));
        this.dirty = true;
        // A keyboard move that is saved: the repaint focuses the row again and announces it (a refused one never does).
        if (focusCtl !== undefined) {
          this.moved = { project: item.project, path: item.path, ctl: focusCtl, say: l10n("releaseBoard.reorder.moved", { title: item.title }) };
        }
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
  protected offerUndo(label: string, restore: () => Promise<boolean>, remaining?: () => string[]): void {
    clearTimeout(this.undo?.timer);
    const timer = setTimeout(() => {
      this.undo = undefined;
      void this.panel.webview.postMessage({ type: "undoOff" });
    }, UNDO_MS);
    this.undo = { label, restore, remaining, timer };
  }

  // The Undo button: puts the changed file back, then scans again. The file is only touched while it
  // still holds what the change wrote.
  protected async undoChange(): Promise<void> {
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
  protected async patchApply(ids: number[]): Promise<void> {
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
      // Proposed links were built from the last scan: a document edited on disk since then is left out.
      let rows = picked.rows;
      let dropped = picked.dropped;
      if (picked.source === "links") {
        const changed = await changedOnDisk(run, targetsOf(model), rows);
        rows = rows.filter((r) => !changed.has(r.change.item));
        dropped += picked.rows.length - rows.length;
      }
      if (dropped > 0) {
        void vscode.window.showInformationMessage(l10n("releaseBoard.patch.dropped", { count: dropped }));
      }
      const out = await applyRows(run, model, rows);
      const skipped = ids.length - out.applied;
      if (out.problems.length > 0) {
        void vscode.window.showWarningMessage(l10n("releaseBoard.patch.problems", { count: out.problems.length, list: out.problems.slice(0, 5).join("; ") }));
      }
      // Whatever was written can be undone, even when a later row failed.
      const wrote = out.snapshot.rules !== undefined || out.snapshot.docs.length > 0;
      if (wrote) {
        this.offerUndo(picked.source === "links" ? l10n("releaseBoard.patch.undoLinks", { count: out.applied }) : l10n("releaseBoard.patch.undo", { count: out.applied, id: picked.name }), () => undoBatch(out.snapshot), () => remainingFiles(out.snapshot));
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

  // `from`: the documents "Edit tags" was chosen on; the tags that match them are highlighted.
  protected async tagsRules(from: readonly BoardItem[] = []): Promise<void> {
    const run = this.run;
    const model = this.model;
    if (!run || !model) {
      void vscode.window.showInformationMessage(l10n("releaseBoard.keywords.msg.noBoard"));
      return;
    }
    await openTagsEditor({ ...this.editorInput(run, model), ...(from.length > 0 ? { focus: matchedTagIds(from, settingsOf(run.cfg.organize).tags) } : {}) });
  }

  // What the Tags and rules editor needs from this board. `onSaved` scans again and hands back the new documents,
  // so an editor that stays open after a save keeps previewing against what the board shows now.
  protected editorInput(run: BoardRun, model: BoardModel): TagsEditorInput {
    const from = (r: BoardRun, m: BoardModel) => ({ cfg: r.cfg, items: m.items, projectNames: new Map(m.projects.map((p) => [p.id, p.name])), profile: m.profile });
    const onSaved = async (): Promise<ReturnType<typeof from> | undefined> => {
      this.dirty = true;
      await this.refresh();
      return this.run && this.model ? from(this.run, this.model) : undefined;
    };
    return { ...from(run, model), onSaved };
  }

  protected async openItem(id: number): Promise<void> {
    const item = this.model?.items[id];
    const project = this.run?.cfg.projects.find((p) => p.id === item?.project);
    if (item && project) {
      await openDocument(vscode.Uri.joinPath(vscode.Uri.parse(project.path), item.path));
    }
  }
}
