import * as vscode from "vscode";
import { l10n } from "../i18n/l10n";
import type { BoardItem, BoardProject } from "../board/boardModel";
import { Snapshot, applyAnswer, applyBlock, restoreSnapshot } from "../board/blockersAsk";
import { MarksFile, markKey } from "../board/marks";
import { readLocalMarks, readMarks, readSharedMarks, updateLocalMarks } from "./boardMarks";

// "Which items block the next release?", VS Code layer. The list is the host's own multi-select
// picker built from its own model, so nothing but a project index or an item id comes from the page.
// A save is one write of the local marks file; a failed write changes nothing and offers no Undo.

// What the panel offers after a save: the Undo bar text and the way back.
export interface BlockersUndo {
  label: string;
  restore: () => Promise<boolean>;
}

// Puts the marks back as the snapshot holds them, in one write.
function undoOf(context: vscode.ExtensionContext, project: string, snap: Snapshot): () => Promise<boolean> {
  return async () => {
    await updateLocalMarks(context, (f: MarksFile) => restoreSnapshot(f, project, snap));
    return true;
  };
}

// Saves a blocker answer from the paths the inline picker returned. Paths the rules file pins are never
// written, whatever the page sent. Undefined when the write was refused (file too big), so no Undo is offered.
export async function applyBlockersAnswer(context: vscode.ExtensionContext, project: BoardProject, items: readonly BoardItem[], fixedPaths: ReadonlySet<string>, pickedPaths: ReadonlySet<string>, fresh: boolean): Promise<BlockersUndo | undefined> {
  const offer = items.filter((i) => !fixedPaths.has(i.path));
  const picked = new Set([...pickedPaths].filter((p) => !fixedPaths.has(p)));
  const shared = await readSharedMarks();
  const now = Date.now();
  let before: Snapshot | undefined;
  await updateLocalMarks(context, (local) => {
    const r = applyAnswer(local, shared, project.id, offer.map((i) => i.path), picked, fresh, now);
    before = r.before;
    return r.next;
  });
  // A write that was refused (file too big) leaves the old answer: say nothing more and offer no Undo.
  if (!before || (await readLocalMarks(context)).answered[project.id]?.at !== now) {
    return undefined;
  }
  return { label: l10n("releaseBoard.undo.blockers", { project: project.name, count: picked.size }), restore: undoOf(context, project.id, before) };
}

// Marks one document as blocking the next release, or takes the mark away (the row menu's checkbox).
export async function toggleBlock(context: vscode.ExtensionContext, item: BoardItem, projectItems: readonly BoardItem[] = []): Promise<BlockersUndo | undefined> {
  const on = !item.pinned;
  // A pin that comes from the rules file's globs is not a hand mark and cannot be switched off here.
  if (!on && (await readMarks(context)).marks[markKey(item.project, item.path)]?.pinned !== true) {
    void vscode.window.showInformationMessage(l10n("releaseBoard.blockers.globPinned", { title: item.title }));
    return undefined;
  }
  const shared = await readSharedMarks();
  let before: Snapshot | undefined;
  await updateLocalMarks(context, (local) => {
    const r = applyBlock(local, shared, item.project, item.path, on, projectItems);
    before = r.before;
    return r.next;
  });
  if (!before || ((await readMarks(context)).marks[markKey(item.project, item.path)]?.pinned === true) !== on) {
    return undefined;
  }
  return { label: l10n(on ? "releaseBoard.undo.blockOn" : "releaseBoard.undo.blockOff", { title: item.title }), restore: undoOf(context, item.project, before) };
}
