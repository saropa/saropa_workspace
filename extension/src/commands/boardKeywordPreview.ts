import * as vscode from "vscode";
import { mapLimit } from "../board/pool";
import { BoardItem } from "../board/boardModel";
import { Profile, SeverityDict, scoreDocument } from "../board/severity";
import { PreviewDoc, PreviewResult, addToPreview, emptyPreview, finishPreview } from "../board/severityEdit";
import { ProjectDef } from "../board/types";

// Release Board, the keyword editor's preview. The open documents of the board are read once
// when the editor opens and kept in the host; every edit is scored against them with the pure
// scoring, a few documents at a time so the window stays responsive. The page never gets a text
// or a path, only counts and titles.

// Most characters of one document that are scored.
export const PREVIEW_CHARS = 100_000;
const READ_PARALLEL = 8;
const SCORE_CHUNK = 20;

// Reads the open documents (at most `max`) and scores each under the saved dictionary. A
// document that cannot be read is left out. A document whose severity was set by hand, or that is
// pinned, cannot change with the keywords and is not read. Resolves with the documents and how
// many documents the keywords can change.
export async function loadPreviewDocs(items: readonly BoardItem[], projects: readonly ProjectDef[], names: ReadonlyMap<string, string>, current: SeverityDict, max: number): Promise<{ docs: PreviewDoc[]; total: number }> {
  const eligible = items.filter((it) => !it.severityByUser && !it.pinned);
  const read = await mapLimit(eligible.slice(0, max), READ_PARALLEL, async (it): Promise<PreviewDoc | undefined> => {
    const def = projects.find((p) => p.id === it.project);
    if (!def) {
      return undefined;
    }
    try {
      const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(vscode.Uri.parse(def.path), it.path));
      const text = Buffer.from(bytes).toString("utf8").slice(0, PREVIEW_CHARS);
      return { title: it.title.slice(0, 120), project: names.get(it.project) ?? it.project, path: it.path, text, before: scoreDocument(text, it.path, current).severity };
    } catch {
      return undefined;
    }
  });
  return { docs: read.filter((d): d is PreviewDoc => d !== undefined), total: eligible.length };
}

const yieldToHost = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

// Scores the documents under the dictionary in small batches. `stillWanted` is asked between
// batches: when it says no (a newer edit arrived) the work stops and nothing is returned.
export async function previewAsync(docs: readonly PreviewDoc[], dict: SeverityDict, profile: Profile, stillWanted: () => boolean): Promise<PreviewResult | undefined> {
  const acc = emptyPreview();
  for (let i = 0; i < docs.length; i += SCORE_CHUNK) {
    if (!stillWanted()) {
      return undefined;
    }
    addToPreview(acc, docs.slice(i, i + SCORE_CHUNK), dict, profile);
    await yieldToHost();
  }
  return stillWanted() ? finishPreview(acc) : undefined;
}
