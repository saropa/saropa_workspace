import * as vscode from "vscode";
import { l10n } from "../i18n/l10n";
import { mapLimit } from "../board/pool";
import { withTimeout } from "../board/timeout";
import { BlockChanges, BlockKey, setBlockFields } from "../board/futureBlock";
import { FutureInput, FutureItem, FutureOutside, FutureSort, MAX_FUTURE_BYTES, MAX_FUTURE_ITEMS, asFutureSort, buildFuture, findOutside, futureSource, moveTarget } from "../board/futureList";
import { BoardRun } from "./boardScanStore";
import { pathExists } from "./boardFileSource";

// Release Board, Future tab: the settings, the reads and the one write. The tab lists
// deferred and blocked documents; a write touches only the header block at the top of one
// document, and a file moves between deferred/ and blocked/ only after a confirmation.

// What the tab lists.
export interface FutureData {
  items: FutureItem[];
  outside: FutureOutside[];
}

export const emptyFuture = (): FutureData => ({ items: [], outside: [] });

// The tab's settings.
export interface FutureSettings {
  enabled: boolean;
  defaultSort: FutureSort;
}

export function readFutureSettings(): FutureSettings {
  const c = vscode.workspace.getConfiguration("saropaWorkspace.releaseBoard.future");
  return { enabled: c.get<boolean>("enabled", true), defaultSort: asFutureSort(c.get<string>("defaultSort", "score")) };
}

// Documents outside a deferred folder that list later work, per project.
const OUTSIDE_FILES = ["ROADMAP.md", "plans/MASTER_PLAN.md"];
const READ_PARALLEL = 12;
const LOAD_MS = 20_000;

// The text of a file; "" when it is larger than the cap, undefined when it cannot be read.
async function readCapped(uri: vscode.Uri): Promise<string | undefined> {
  try {
    const st = await vscode.workspace.fs.stat(uri);
    if (st.size > MAX_FUTURE_BYTES) {
      return "";
    }
    return Buffer.from(await vscode.workspace.fs.readFile(uri)).toString("utf8");
  } catch {
    return undefined;
  }
}

async function load(run: BoardRun): Promise<FutureData> {
  const defs = new Map(run.cfg.projects.map((p) => [p.id, p]));
  const picks = run.result.rows.filter((r) => futureSource(r.path) !== undefined && defs.has(r.project)).slice(0, MAX_FUTURE_ITEMS);
  const read = await mapLimit(picks, READ_PARALLEL, async (r): Promise<FutureInput | undefined> => {
    const def = defs.get(r.project)!;
    const text = await readCapped(vscode.Uri.joinPath(vscode.Uri.parse(def.path), r.path));
    return text === undefined ? undefined : { project: def.id, projectName: def.name ?? def.id, path: r.path, text };
  });
  const outside: FutureOutside[] = [];
  for (const def of run.cfg.projects) {
    const found = await mapLimit(OUTSIDE_FILES, 2, async (p): Promise<FutureOutside[]> => {
      const text = await readCapped(vscode.Uri.joinPath(vscode.Uri.parse(def.path), p));
      return text ? findOutside({ project: def.id, projectName: def.name ?? def.id, path: p, text }) : [];
    });
    outside.push(...found.flat());
  }
  return { items: buildFuture(read.filter((x): x is FutureInput => x !== undefined)), outside };
}

// Reads the deferred and blocked documents of the scan. Bounded in count, size and time;
// a failure gives an empty tab, never an error on the board.
export async function loadFuture(run: BoardRun): Promise<FutureData> {
  return withTimeout(load(run), LOAD_MS).catch(() => emptyFuture());
}

function isDirty(uri: vscode.Uri): boolean {
  return vscode.workspace.textDocuments.some((d) => d.isDirty && d.uri.toString() === uri.toString());
}

function warn(key: string, path: string): void {
  void vscode.window.showWarningMessage(l10n(key, { path }));
}

// Writes the block changes into one document. Refuses a document with unsaved edits or one
// that is not plain UTF-8 (rewriting it would change other bytes). True when the file changed.
export async function writeBlock(uri: vscode.Uri, path: string, changes: BlockChanges): Promise<boolean> {
  if (isDirty(uri)) {
    warn("releaseBoard.future.dirty", path);
    return false;
  }
  try {
    const bytes = await vscode.workspace.fs.readFile(uri);
    const text = Buffer.from(bytes).toString("utf8");
    if (Buffer.compare(Buffer.from(text, "utf8"), Buffer.from(bytes)) !== 0) {
      warn("releaseBoard.future.notUtf8", path);
      return false;
    }
    const next = setBlockFields(text, changes);
    if (next === text) {
      return false;
    }
    await vscode.workspace.fs.writeFile(uri, Buffer.from(next, "utf8"));
    return true;
  } catch (e) {
    void vscode.window.showErrorMessage(l10n("releaseBoard.failed", { error: e instanceof Error ? e.message : String(e) }));
    return false;
  }
}

// Sets one characteristic or the flag of a listed document. A flag that moves it between
// "deferred" and "blocked" offers the move afterwards; nothing moves without a yes.
export async function setFutureField(root: vscode.Uri, item: FutureItem, key: BlockKey, value: string): Promise<boolean> {
  const uri = vscode.Uri.joinPath(root, item.path);
  const changed = await writeBlock(uri, item.path, { [key]: value });
  if (key === "Importance") {
    const toBlocked = value === "not-feasible";
    const to = (toBlocked && item.source === "deferred") || (!toBlocked && item.source === "blocked") ? moveTarget(item.path, toBlocked) : undefined;
    if (to) {
      return (await offerMove(root, item.path, to)) || changed;
    }
  }
  return changed;
}

// Asks for the blocker line and writes it. An empty answer removes the line.
export async function editBlocker(root: vscode.Uri, item: FutureItem): Promise<boolean> {
  const answer = await vscode.window.showInputBox({ prompt: l10n("releaseBoard.future.blockerPrompt"), value: item.blocker ?? "" });
  if (answer === undefined) {
    return false;
  }
  const line = answer.trim();
  return writeBlock(vscode.Uri.joinPath(root, item.path), item.path, { Blocker: line === "" ? null : line });
}

// Moves one document after a confirmation that names the source and destination. Refuses
// when the destination exists or the document has unsaved edits. True when it moved.
async function offerMove(root: vscode.Uri, from: string, to: string): Promise<boolean> {
  const src = vscode.Uri.joinPath(root, from);
  const dst = vscode.Uri.joinPath(root, to);
  if (isDirty(src)) {
    warn("releaseBoard.future.dirty", from);
    return false;
  }
  if (await pathExists(dst)) {
    warn("releaseBoard.future.targetExists", to);
    return false;
  }
  const move = l10n("releaseBoard.future.move");
  const answer = await vscode.window.showWarningMessage(l10n("releaseBoard.future.confirmMove", { from, to }), { modal: true }, move);
  if (answer !== move) {
    return false;
  }
  // The dialog can stay open: check again right before the move.
  if (isDirty(src) || (await pathExists(dst))) {
    warn("releaseBoard.future.targetExists", to);
    return false;
  }
  try {
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(dst, ".."));
    const edit = new vscode.WorkspaceEdit();
    edit.renameFile(src, dst, { overwrite: false });
    return await vscode.workspace.applyEdit(edit);
  } catch (e) {
    void vscode.window.showErrorMessage(l10n("releaseBoard.failed", { error: e instanceof Error ? e.message : String(e) }));
    return false;
  }
}
