import * as vscode from "vscode";
import { l10n } from "../i18n/l10n";
import { FutureItem } from "../board/futureList";
import { parseBlock } from "../board/futureBlock";
import { buildHandoff, fromResearch, handoffFile, handoffId } from "../board/handoff";
import { HandoffFiles, deliver, readHandoffSettings } from "./boardHandoff";
import { writeBlock } from "./boardFuture";

// Release Board, Future tab, research: hands flagged documents to an AI as one hand-off and
// marks the result. The hand-off document is saved and its line copied; the owner passes it
// on and confirms once, and only then do the documents become "in-progress". Nothing is
// marked for a hand-off the owner did not confirm.

// One document to hand over: the listed item and its project folder.
export interface ResearchEntry {
  item: FutureItem;
  root: vscode.Uri;
}

// What a hand-off did.
export interface HandResult {
  // Documents marked "in-progress".
  handed: number;
  // True when the owner stopped before the end.
  stopped: boolean;
}

// Today in local time, YYYY-MM-DD.
export function today(d: Date = new Date()): string {
  const two = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
}

function isDirty(uri: vscode.Uri): boolean {
  return vscode.workspace.textDocuments.some((d) => d.isDirty && d.uri.toString() === uri.toString());
}

// The document's current block, read fresh: the page may be out of date.
async function currentBlock(uri: vscode.Uri): Promise<ReturnType<typeof parseBlock> | undefined> {
  try {
    return parseBlock(Buffer.from(await vscode.workspace.fs.readFile(uri)).toString("utf8"));
  } catch {
    return undefined;
  }
}

// Saves one research hand-off for the entries and copies it, then asks the owner to confirm
// once. Skips a document that is no longer flagged "needed" or has unsaved edits (the AI would
// edit the file under them). Marks the documents "in-progress" only while each is still "needed".
export async function handResearch(entries: ResearchEntry[]): Promise<HandResult> {
  const out: HandResult = { handed: 0, stopped: false };
  const docs: Array<{ entry: ResearchEntry; uri: vscode.Uri; question?: string }> = [];
  for (const entry of entries) {
    const uri = vscode.Uri.joinPath(entry.root, entry.item.path);
    const block = await currentBlock(uri);
    if (block?.research !== "needed") {
      continue;
    }
    if (isDirty(uri)) {
      void vscode.window.showWarningMessage(l10n("releaseBoard.future.dirty", { path: entry.item.path }));
      continue;
    }
    docs.push({ entry, uri, question: block.researchQuestion });
  }
  if (docs.length === 0) {
    return out;
  }
  const now = new Date();
  const files: HandoffFiles[] = [];
  for (const pid of [...new Set(docs.map((d) => d.entry.item.project))]) {
    const mine = docs.filter((d) => d.entry.item.project === pid);
    const { projects, items } = fromResearch(mine.map(({ entry, question }) => ({ project: entry.item.project, projectName: entry.item.projectName, root: entry.root.path.replace(/\/+$/, "").split("/").pop() ?? "", path: entry.item.path, title: entry.item.title, importance: entry.item.importance, question })));
    const id = handoffId(now, pid, "research");
    const built = buildHandoff({ id, task: "research", scope: { kind: "research", count: items.length }, date: today(now), projects, items, file: handoffFile(id, "md") });
    files.push({ root: mine[0].entry.root, id, ...built });
  }
  const file = files.map((f) => handoffFile(f.id, "md")).join(", ");
  await deliver("copy", files, "md", readHandoffSettings());
  const ok = l10n("releaseBoard.future.research.pasted");
  const answer = await vscode.window.showInformationMessage(l10n("releaseBoard.future.research.copied", { count: docs.length, file }), { modal: true }, ok);
  if (answer !== ok) {
    out.stopped = true;
    return out;
  }
  for (const { entry, uri } of docs) {
    if ((await writeBlock(uri, entry.item.path, { Research: "in-progress" }, (b) => b.research === "needed")) !== "refused") {
      out.handed += 1;
    }
  }
  return out;
}

// Marks the research on one document reviewed, after the owner confirms. Only a document
// whose research is still "ready" in the file changes. True when the file was written.
export async function markReviewed(root: vscode.Uri, item: FutureItem): Promise<boolean> {
  const uri = vscode.Uri.joinPath(root, item.path);
  const yes = l10n("releaseBoard.future.research.markReviewed");
  const answer = await vscode.window.showWarningMessage(l10n("releaseBoard.future.research.confirmReviewed", { path: item.path }), { modal: true }, yes);
  if (answer !== yes) {
    return false;
  }
  return (await writeBlock(uri, item.path, { Research: "reviewed" }, (b) => b.research === "ready")) === "written";
}
