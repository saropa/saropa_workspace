import * as vscode from "vscode";
import { l10n } from "../i18n/l10n";
import type { BoardItem, BoardProject } from "../board/boardModelParts";
import { pl } from "../board/boardHtmlUtil";
import { BATCH, OrderEntry, Question, emptyOrder, forgetItem, nextQuestion, nextQuestionFor, tidyOrder, withAnswer } from "../board/orderAsk";
import { folderOf, hardEdges, orderItemsOf } from "../board/orderModel";
import { MarksFile, setOrder } from "../board/marks";
import { strings } from "../views/boardStrings";
import type { BlockersUndo } from "./boardBlockers";
import { readLocalMarks, readMarks, updateLocalMarks } from "./boardMarks";

// "Which comes first?", VS Code layer. Every question is the host's own picker built from its own model, so the
// page sends only a project index or an item id. A batch is at most BATCH questions, then one write of the local
// marks file and one Undo. Escape ends the batch and keeps the answers already given. Documents are never edited.

interface Pick extends vscode.QuickPickItem {
  first?: string;
  skip?: true;
}

// The picker of one question. Returns the id chosen to come first, "skip", or undefined when dismissed.
async function pickFirst(q: Question, n: number, byPath: ReadonlyMap<string, BoardItem>, byFolder: ReadonlyMap<string, { name: string; count: number }>): Promise<{ first?: string } | "skip" | undefined> {
  const t = strings();
  const one = (id: string): Pick => {
    if (q.kind === "folder") {
      const f = byFolder.get(id);
      return { label: f?.name ?? id, description: l10n("releaseBoard.order.folderCount", { count: f?.count ?? 0 }), first: id };
    }
    const i = byPath.get(id);
    return { label: i?.title ?? id, description: [i?.severity ? pl(t, "sev." + i.severity) : "", i?.group?.name ?? ""].filter(Boolean).join(" · "), detail: id, first: id };
  };
  const picks: Pick[] = [one(q.a), one(q.b), { label: l10n("releaseBoard.order.skip"), description: l10n("releaseBoard.order.skipTip"), skip: true }];
  const chosen = await vscode.window.showQuickPick(picks, { title: l10n(q.kind === "folder" ? "releaseBoard.order.titleFolder" : "releaseBoard.order.titleItem", { n, total: BATCH }), ignoreFocusOut: true, matchOnDetail: true });
  return chosen ? (chosen.skip ? "skip" : { first: chosen.first }) : undefined;
}

// Undo: puts the project's order entry back as it was in the local file, in one write.
function undoOf(context: vscode.ExtensionContext, project: string, before: OrderEntry | null): () => Promise<boolean> {
  return async () => {
    await updateLocalMarks(context, (f: MarksFile) => setOrder(f, project, before ?? undefined));
    return true;
  };
}

// Writes `next` as the project's entry and checks it landed. Undefined when the write was refused (file too big).
async function save(context: vscode.ExtensionContext, project: BoardProject, next: OrderEntry, label: (lost: number) => string, lost: number): Promise<BlockersUndo | undefined> {
  let before: OrderEntry | null | undefined;
  await updateLocalMarks(context, (local) => {
    before = local.order[project.id] ?? null;
    return setOrder(local, project.id, next);
  });
  const now = (await readLocalMarks(context)).order[project.id];
  const same = JSON.stringify(now ?? null) === JSON.stringify(next.pairs.length + next.skipped.length + next.folders.length === 0 ? null : next);
  return before === undefined || !same ? undefined : { label: label(lost), restore: undoOf(context, project.id, before) };
}

// What the page can name: the documents a project has (so pairs of removed documents are dropped on write).
export type KnownDocs = (path: string) => boolean;

// Asks up to BATCH questions about the blockers of a project and saves the answers in one write. `again` forgets the
// skips first (the project menu); `focus` asks only about where that document goes (the row menu), after removing
// its earlier answers. Undefined when nothing was answered or the write was refused.
export async function orderBlockers(context: vscode.ExtensionContext, project: BoardProject, all: readonly BoardItem[], known: KnownDocs, opts: { again?: boolean; focus?: BoardItem } = {}): Promise<BlockersUndo | undefined> {
  const flagged = orderItemsOf(project.items);
  if (flagged.length < 2) {
    void vscode.window.showInformationMessage(l10n("releaseBoard.order.none"));
    return undefined;
  }
  const byPath = new Map(project.items.map((i) => [i.path, i]));
  const byFolder = new Map<string, { name: string; count: number }>();
  for (const i of project.items.filter((x) => x.blocks)) {
    const f = byFolder.get(folderOf(i)) ?? { name: i.group?.name ?? l10n("releaseBoard.order.noFolder"), count: 0 };
    byFolder.set(folderOf(i), { name: f.name, count: f.count + 1 });
  }
  const hard = hardEdges(all, project.items);
  const start = (await readMarks(context)).order[project.id] ?? emptyOrder();
  let entry: OrderEntry = opts.focus ? forgetItem(start, opts.focus.path) : opts.again ? { ...start, skipped: [] } : start;
  let given = 0;
  for (let n = 1; n <= BATCH; n++) {
    const q = opts.focus ? nextQuestionFor(flagged, entry, opts.focus.path, hard) : nextQuestion(flagged, entry, hard);
    if (!q) {
      break;
    }
    const answer = await pickFirst(q, n, byPath, byFolder);
    if (answer === undefined) {
      break;
    }
    entry = withAnswer(entry, q, answer === "skip" ? undefined : answer.first);
    given++;
  }
  // Dismissed at the first question: nothing is saved, not even the forgotten answers.
  if (given === 0) {
    return undefined;
  }
  const { entry: tidy, lost } = tidyOrder(entry, hard, known);
  return save(context, project, tidy, (dropped) => l10n(dropped > 0 ? "releaseBoard.order.undoLost" : "releaseBoard.order.undo", { project: project.name, count: given, lost: dropped }), lost);
}

// Takes the order answers about one document away (the row menu's "Forget order answers"), with Undo.
export async function forgetOrder(context: vscode.ExtensionContext, project: BoardProject, item: BoardItem): Promise<BlockersUndo | undefined> {
  const start = (await readMarks(context)).order[project.id];
  const next = start ? forgetItem(start, item.path) : undefined;
  if (!start || !next || JSON.stringify(next) === JSON.stringify(start)) {
    void vscode.window.showInformationMessage(l10n("releaseBoard.order.nothingToForget", { title: item.title }));
    return undefined;
  }
  return save(context, project, next, () => l10n("releaseBoard.order.undoForget", { title: item.title }), 0);
}
