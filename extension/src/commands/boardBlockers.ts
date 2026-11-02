import * as vscode from "vscode";
import { l10n } from "../i18n/l10n";
import type { BoardItem, BoardProject } from "../board/boardModel";
import { pl } from "../board/boardHtmlUtil";
import { Snapshot, applyAnswer, applyBlock, candidatesOf, restoreSnapshot } from "../board/blockersAsk";
import { MarksFile, markKey } from "../board/marks";
import { strings } from "../views/boardStrings";
import { readLocalMarks, readMarks, readSharedMarks, updateLocalMarks } from "./boardMarks";

// "Which items block the next release?", VS Code layer. The list is the host's own multi-select
// picker built from its own model, so nothing but a project index or an item id comes from the page.
// A save is one write of the local marks file; a failed write changes nothing and offers no Undo.

// What the panel offers after a save: the Undo bar text and the way back.
export interface BlockersUndo {
  label: string;
  restore: () => Promise<boolean>;
}

interface Pick extends vscode.QuickPickItem {
  path: string;
}

// The picker: every offered item with its current mark ticked. Undefined when dismissed; an empty
// set when confirmed with nothing ticked (a valid answer).
async function pickBlockers(items: readonly BoardItem[], fresh: boolean): Promise<Set<string> | undefined> {
  const t = strings();
  const picks: Pick[] = items.map((i) => ({ label: i.title, description: i.severity ? pl(t, "sev." + i.severity) : "", detail: i.path, picked: i.pinned, path: i.path }));
  const chosen = await vscode.window.showQuickPick(picks, { canPickMany: true, matchOnDetail: true, title: l10n(fresh ? "releaseBoard.blockers.titleFresh" : "releaseBoard.blockers.title") });
  return chosen ? new Set(chosen.map((c) => c.path)) : undefined;
}

// Puts the marks back as the snapshot holds them, in one write.
function undoOf(context: vscode.ExtensionContext, project: string, snap: Snapshot): () => Promise<boolean> {
  return async () => {
    await updateLocalMarks(context, (f: MarksFile) => restoreSnapshot(f, project, snap));
    return true;
  };
}

// Asks which of a project's items block the next release and saves the answer. `fresh` offers only the
// new extreme and critical items of an answered project. Undefined when dismissed, empty or not written.
export async function chooseBlockers(context: vscode.ExtensionContext, project: BoardProject, marks: MarksFile, fresh: boolean): Promise<BlockersUndo | undefined> {
  const items = candidatesOf(project.items, fresh, marks.answered[project.id]?.seen);
  if (items.length === 0) {
    void vscode.window.showInformationMessage(l10n("releaseBoard.blockers.none"));
    return undefined;
  }
  const picked = await pickBlockers(items, fresh);
  if (!picked) {
    return undefined;
  }
  const shared = await readSharedMarks();
  const now = Date.now();
  let before: Snapshot | undefined;
  await updateLocalMarks(context, (local) => {
    const r = applyAnswer(local, shared, project.id, items.map((i) => i.path), picked, fresh, now);
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
export async function toggleBlock(context: vscode.ExtensionContext, item: BoardItem): Promise<BlockersUndo | undefined> {
  const on = !item.pinned;
  // A pin that comes from the rules file's globs is not a hand mark and cannot be switched off here.
  if (!on && (await readMarks(context)).marks[markKey(item.project, item.path)]?.pinned !== true) {
    void vscode.window.showInformationMessage(l10n("releaseBoard.blockers.globPinned", { title: item.title }));
    return undefined;
  }
  const shared = await readSharedMarks();
  let before: Snapshot | undefined;
  await updateLocalMarks(context, (local) => {
    const r = applyBlock(local, shared, item.project, item.path, on);
    before = r.before;
    return r.next;
  });
  if (!before || ((await readMarks(context)).marks[markKey(item.project, item.path)]?.pinned === true) !== on) {
    return undefined;
  }
  return { label: l10n(on ? "releaseBoard.undo.blockOn" : "releaseBoard.undo.blockOff", { title: item.title }), restore: undoOf(context, item.project, before) };
}
