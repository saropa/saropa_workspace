import * as vscode from "vscode";
import { l10n } from "../i18n/l10n";
import { FutureItem } from "../board/futureList";
import { parseBlock } from "../board/futureBlock";
import { researchPrompt } from "../board/futureResearch";
import { copyHandPrompt, readHandSettings } from "./boardHandToChat";
import { writeBlock } from "./boardFuture";

// Release Board, Future tab, research: hands flagged documents to a chat and marks the
// result. Hand to chat only copies one prompt at a time to the clipboard, so a batch is
// handed one document after another: each prompt is copied, the owner pastes it and
// confirms, and only then does the document become "in-progress". Nothing is marked for a
// prompt the owner did not confirm.

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

// Copies one prompt per entry and asks the owner to confirm each paste. Skips a document
// that is no longer flagged "needed" or has unsaved edits (the chat would edit the file
// under them). Marks a confirmed document "in-progress" only while it is still "needed".
export async function handResearch(entries: ResearchEntry[]): Promise<HandResult> {
  const hand = readHandSettings();
  const out: HandResult = { handed: 0, stopped: false };
  if (!hand.enabled) {
    return out;
  }
  for (let n = 0; n < entries.length; n++) {
    const { item, root } = entries[n];
    const uri = vscode.Uri.joinPath(root, item.path);
    const block = await currentBlock(uri);
    if (block?.research !== "needed") {
      continue;
    }
    if (isDirty(uri)) {
      void vscode.window.showWarningMessage(l10n("releaseBoard.future.dirty", { path: item.path }));
      continue;
    }
    const text = researchPrompt({ project: item.projectName, path: item.path, title: item.title, question: block.researchQuestion, date: today() });
    await copyHandPrompt(text, uri, "never", undefined, true);
    const last = n === entries.length - 1;
    const ok = l10n(last ? "releaseBoard.future.research.pastedLast" : "releaseBoard.future.research.pasted");
    const answer = await vscode.window.showInformationMessage(l10n("releaseBoard.future.research.copied", { n: n + 1, total: entries.length, title: item.title }), { modal: true }, ok);
    if (answer !== ok) {
      out.stopped = true;
      break;
    }
    if ((await writeBlock(uri, item.path, { Research: "in-progress" }, (b) => b.research === "needed")) !== "refused") {
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
