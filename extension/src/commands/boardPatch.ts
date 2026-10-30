import * as path from "node:path";
import * as vscode from "vscode";
import { l10n } from "../i18n/l10n";
import { BoardModel } from "../board/boardModel";
import { HANDOFF_DIR } from "../board/handoff";
import { MAX_PATCH_CHARS, PatchRow, targetsOf } from "../board/patch";
import { addNeedsLine, applyRuleRow, needsSpellings, needsWrite, removeNeedsLine } from "../board/patchApply";
import { decodeRules, ruleCategories } from "../board/ruleAssign";
import { pathExists } from "./boardFileSource";
import { RulesSnapshot, changeRules, hasUnsavedCopy, isLink, undoRulesWrite } from "./boardRuleAssign";
import { BoardRun } from "./boardScanStore";

// Release Board, bring back an AI reply: writes the changes the owner ticked and takes them
// back again. Nothing is written for a row that was not ticked, and a file is only changed
// while it still holds what was read: a document with unsaved edits, behind a symbolic link or
// not plain UTF-8 is left alone, and what could not be written is counted, not hidden.

// One document the batch rewrote: its text before and after.
export interface DocSnapshot {
  uri: vscode.Uri;
  before: string;
  after: string;
}

// Everything one batch wrote, for one Undo: the rules file and the documents.
export interface BatchSnapshot {
  rules?: RulesSnapshot;
  docs: DocSnapshot[];
}

export interface ApplyOutcome {
  applied: number;
  skipped: number;
  snapshot: BatchSnapshot;
}

const RULE_OPS = new Set(["setStatus", "setSeverity", "setGroup"]);

// The project-relative path as a folder-safe one, or undefined when it would leave the folder.
const inside = (p: string): string | undefined => {
  const n = path.posix.normalize(p);
  return n === "." || n.startsWith("../") || n === ".." || path.posix.isAbsolute(n) ? undefined : n;
};

// Writes the rows: status, severity and group changes in one write of the rules file, Needs
// changes one write per document. A row that cannot be written is counted as skipped.
export async function applyRows(run: BoardRun, model: BoardModel, rows: PatchRow[]): Promise<ApplyOutcome> {
  const targets = targetsOf(model);
  const cats = ruleCategories(run.cfg);
  const out: ApplyOutcome = { applied: 0, skipped: 0, snapshot: { docs: [] } };
  const ruleRows = rows.filter((r) => RULE_OPS.has(r.change.op) && targets.has(r.change.item));
  if (ruleRows.length > 0) {
    let done = 0;
    const projects = [...new Set(ruleRows.map((r) => targets.get(r.change.item)?.project ?? ""))];
    const snap = await changeRules(run, projects, (before) => {
      let text = before;
      done = 0;
      for (const r of ruleRows) {
        const e = applyRuleRow(text, r, targets.get(r.change.item)!, cats);
        if (e.ok) {
          text = e.text;
          done++;
        }
      }
      return done > 0 ? { ok: true, text: text as string } : { ok: false, reason: "shape" };
    });
    if (snap) {
      out.snapshot.rules = snap;
      out.applied += done;
    }
  }
  const byDoc = new Map<string, PatchRow[]>();
  for (const r of rows.filter((x) => !RULE_OPS.has(x.change.op) && targets.has(x.change.item))) {
    byDoc.set(r.change.item, [...(byDoc.get(r.change.item) ?? []), r]);
  }
  for (const [id, mine] of byDoc) {
    const done = await writeNeeds(run, targets, id, mine, out.snapshot);
    out.applied += done;
  }
  out.skipped = rows.length - out.applied;
  return out;
}

// Rewrites the Needs lines of one document; returns how many rows were written.
async function writeNeeds(run: BoardRun, targets: ReturnType<typeof targetsOf>, id: string, rows: PatchRow[], snapshot: BatchSnapshot): Promise<number> {
  const me = targets.get(id)!;
  const def = run.cfg.projects.find((p) => p.id === me.project);
  const rel = inside(me.path);
  if (!def || !rel) {
    return 0;
  }
  const uri = vscode.Uri.joinPath(vscode.Uri.parse(def.path), rel);
  if (hasUnsavedCopy(uri) || (await isLink(uri)) || !(await pathExists(uri))) {
    return 0;
  }
  const before = decodeRules(await vscode.workspace.fs.readFile(uri));
  if (before === undefined) {
    return 0;
  }
  let text = before;
  let done = 0;
  for (const r of rows) {
    const other = targets.get(r.change.on ?? "");
    if (!other) {
      continue;
    }
    const e = r.change.op === "addNeeds" ? addNeedsLine(text, needsWrite(me, other)) : removeNeedsLine(text, needsSpellings(me, other));
    if (e.ok) {
      text = e.text;
      done++;
    }
  }
  if (done === 0 || hasUnsavedCopy(uri) || decodeRules(await vscode.workspace.fs.readFile(uri)) !== before) {
    return 0;
  }
  try {
    await vscode.workspace.fs.writeFile(uri, Buffer.from(text, "utf8"));
  } catch (e) {
    void vscode.window.showErrorMessage(l10n("releaseBoard.noRule.failed", { file: me.path, error: e instanceof Error ? e.message : String(e) }));
    return 0;
  }
  snapshot.docs.push({ uri, before, after: text });
  return done;
}

// Puts every file of a batch back. Nothing is touched unless every document still holds exactly
// what the batch wrote; the rules file is checked the same way by its own undo. Returns true
// when everything was restored.
export async function undoBatch(s: BatchSnapshot): Promise<boolean> {
  for (const d of s.docs) {
    const now = hasUnsavedCopy(d.uri) || (await isLink(d.uri)) || !(await pathExists(d.uri)) ? undefined : decodeRules(await vscode.workspace.fs.readFile(d.uri));
    if (now !== d.after) {
      void vscode.window.showWarningMessage(l10n("releaseBoard.undo.changed", { file: path.posix.basename(d.uri.path) }));
      return false;
    }
  }
  if (s.rules && !(await undoRulesWrite(s.rules))) {
    return false;
  }
  for (const d of s.docs) {
    await vscode.workspace.fs.writeFile(d.uri, Buffer.from(d.before, "utf8"));
  }
  return true;
}

// A result file name: a hand-off id (or any safe name) plus ".result.json".
export const RESULT_FILE = /^[\w.-]{1,160}\.result\.json$/;

// The text of a result file the watcher saw, or undefined when it is not one to read: not directly
// in a project's hand-off folder, not named like a result, too large, a symbolic link, or not plain UTF-8.
export async function readResultFile(uri: vscode.Uri, roots: vscode.Uri[]): Promise<string | undefined> {
  const name = path.posix.basename(uri.path);
  const isOurs = roots.some((r) => uri.path === `${r.path.replace(/\/+$/, "")}/${HANDOFF_DIR}/${name}`);
  if (!isOurs || !RESULT_FILE.test(name) || (await isLink(uri))) {
    return undefined;
  }
  try {
    if ((await vscode.workspace.fs.stat(uri)).size > MAX_PATCH_CHARS) {
      return undefined;
    }
    return decodeRules(await vscode.workspace.fs.readFile(uri));
  } catch {
    return undefined;
  }
}

// Watches the hand-off folders for result files and passes the text of each readable one on.
export function watchResults(roots: () => vscode.Uri[], onResult: (text: string, name: string) => void): vscode.Disposable {
  const watcher = vscode.workspace.createFileSystemWatcher(`**/${HANDOFF_DIR}/*.result.json`);
  const seen = (uri: vscode.Uri): void => {
    void readResultFile(uri, roots()).then((text) => text !== undefined && onResult(text, path.posix.basename(uri.path)));
  };
  watcher.onDidCreate(seen);
  watcher.onDidChange(seen);
  return watcher;
}
