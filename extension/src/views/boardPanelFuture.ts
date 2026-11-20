import * as vscode from "vscode";
import { l10n } from "../i18n/l10n";
import { openDocument } from "./boardPanelActions";
import { editBlocker, readFutureSettings, setFutureField, setResearchQuestion } from "../commands/boardFuture";
import { handResearch, markReviewed } from "../commands/boardFutureResearch";
import { researchQueue } from "../board/futureResearch";
import { FutureItem, blockKeyOf, foldersFor, isFieldValue } from "../board/futureList";
import { BoardPanelEdits } from "./boardPanelEdits";

// Why this class exists: the Future tab handlers (set a field, hand to chat, open a document) were split out
// of BoardPanel to keep it under the quality gate's file-length cap. They use only the shared core state.
export abstract class BoardPanelFuture extends BoardPanelEdits {
  // A Future tab edit (with its dialogs) is under way: a second one is ignored.
  protected editing = false;

  // The listed document and its project folder for an index the page sent; the index is
  // resolved against the Future list this panel painted, never a path from the page.
  protected futureTarget(i: unknown): { item: FutureItem; root: vscode.Uri } | undefined {
    const item = typeof i === "number" ? this.futureShown[i] : undefined;
    const def = this.run?.cfg.projects.find((p) => p.id === item?.project);
    return item && def ? { item, root: vscode.Uri.parse(def.path) } : undefined;
  }

  // Sets one flag or characteristic, or the blocker line, of a listed document. The page is
  // painted again afterwards whatever the outcome, so its controls show what the file holds.
  protected async futureEdit(message: Record<string, unknown>): Promise<void> {
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
  protected async futureHand(): Promise<void> {
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
  protected async futureOpen(message: Record<string, unknown>): Promise<void> {
    const item = typeof message.i === "number" ? this.futureShown[message.i] : undefined;
    const outside = typeof message.o === "number" ? this.futureOutsideShown[message.o] : undefined;
    const hit = item ?? outside;
    const def = this.run?.cfg.projects.find((p) => p.id === hit?.project);
    if (hit && def) {
      const pos = outside ? new vscode.Position(Math.max(0, outside.line - 1), 0) : undefined;
      await openDocument(vscode.Uri.joinPath(vscode.Uri.parse(def.path), hit.path), pos ? new vscode.Range(pos, pos) : undefined);
    }
  }
}
