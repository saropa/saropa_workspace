import { promises as fsp } from "node:fs";
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
  // Plain-words reasons rows were refused or failed, for one message to the owner.
  problems: string[];
}

const RULE_OPS = new Set(["setStatus", "setSeverity", "setGroup"]);

// The project-relative path as a folder-safe one, or undefined when it would leave the folder.
const inside = (p: string): string | undefined => {
  const n = path.posix.normalize(p);
  return n === "." || n.startsWith("../") || n === ".." || path.posix.isAbsolute(n) ? undefined : n;
};

// The real file path of `rel` under the project folder, or undefined when any part of the way is a
// symbolic link or the real path leaves the folder: a write there could land outside the project.
export async function realInside(rootFs: string, rel: string): Promise<string | undefined> {
  try {
    const root = await fsp.realpath(rootFs);
    let cur = root;
    for (const seg of rel.split("/")) {
      cur = path.join(cur, seg);
      if ((await fsp.lstat(cur)).isSymbolicLink()) {
        return undefined;
      }
    }
    return (await fsp.realpath(cur)) === cur && cur.startsWith(root + path.sep) ? cur : undefined;
  } catch {
    return undefined;
  }
}

// Writes the rows: status, severity and group changes in one write of the rules file, Needs
// changes one write per document. A row that cannot be written is counted as skipped, and a failure
// partway never hides what was already written: the snapshot always holds every file written.
export async function applyRows(run: BoardRun, model: BoardModel, rows: PatchRow[]): Promise<ApplyOutcome> {
  const targets = targetsOf(model);
  const cats = ruleCategories(run.cfg);
  const out: ApplyOutcome = { applied: 0, skipped: 0, snapshot: { docs: [] }, problems: [] };
  const ruleRows = rows.filter((r) => RULE_OPS.has(r.change.op) && targets.has(r.change.item));
  if (ruleRows.length > 0) {
    try {
      let done = 0;
      let problems: string[] = [];
      const projects = [...new Set(ruleRows.map((r) => targets.get(r.change.item)?.project ?? ""))];
      const snap = await changeRules(run, projects, (before) => {
        let text = before;
        done = 0;
        problems = [];
        for (const r of ruleRows) {
          const t = targets.get(r.change.item)!;
          const e = applyRuleRow(text, r, t, cats);
          if (e.ok) {
            text = e.text;
            done++;
          } else {
            problems.push(`${t.path}: ${e.reason}`);
          }
        }
        return done > 0 ? { ok: true, text: text as string } : { ok: false, reason: "shape" };
      });
      out.problems.push(...problems);
      if (snap) {
        out.snapshot.rules = snap;
        out.applied += done;
      }
    } catch (e) {
      out.problems.push(e instanceof Error ? e.message : String(e));
    }
  }
  const byDoc = new Map<string, PatchRow[]>();
  for (const r of rows.filter((x) => !RULE_OPS.has(x.change.op) && targets.has(x.change.item))) {
    byDoc.set(r.change.item, [...(byDoc.get(r.change.item) ?? []), r]);
  }
  for (const [id, mine] of byDoc) {
    try {
      out.applied += await writeNeeds(run, targets, id, mine, out.snapshot);
    } catch (e) {
      // One document failing never stops the others, and never loses the snapshot of those written.
      const msg = e instanceof Error ? e.message : String(e);
      out.problems.push(`${targets.get(id)?.path ?? id}: ${msg}`);
      void vscode.window.showErrorMessage(l10n("releaseBoard.noRule.failed", { file: targets.get(id)?.path ?? id, error: msg }));
    }
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
  const real = await realInside(vscode.Uri.parse(def.path).fsPath, rel);
  if (!real) {
    return 0;
  }
  const uri = vscode.Uri.file(real);
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
    // A write that failed late may still have landed; keep it undoable when it did.
    if (decodeRules(await vscode.workspace.fs.readFile(uri).then((b) => b, () => new Uint8Array())) === text) {
      snapshot.docs.push({ uri, before, after: text });
      return done;
    }
    return 0;
  }
  snapshot.docs.push({ uri, before, after: text });
  return done;
}

// Keeps a copy of a pasted patch in the hand-off folder of the first project it touched (a folder
// the hand-off already keeps out of git), so the change can be traced and reverted later. Best effort.
export async function savePastedPatch(run: BoardRun, model: BoardModel, rows: PatchRow[], text: string): Promise<void> {
  try {
    const targets = targetsOf(model);
    const project = targets.get(rows[0]?.change.item ?? "")?.project;
    const def = run.cfg.projects.find((p) => p.id === project);
    if (!def) {
      return;
    }
    const dir = vscode.Uri.joinPath(vscode.Uri.parse(def.path), HANDOFF_DIR);
    if (await isLink(vscode.Uri.joinPath(vscode.Uri.parse(def.path), ".saropa")) || (await isLink(dir))) {
      return;
    }
    await vscode.workspace.fs.createDirectory(dir);
    const ignore = vscode.Uri.joinPath(dir, ".gitignore");
    if (!(await pathExists(ignore))) {
      await vscode.workspace.fs.writeFile(ignore, Buffer.from("*\n", "utf8"));
    }
    await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(dir, `pasted-${new Date().toISOString().replace(/[:.]/g, "-")}.patch.json`), Buffer.from(text, "utf8"));
  } catch {
    // The apply already happened; a missing copy never undoes it.
  }
}

// Puts a batch back, as much as can be. A file already holding its old text counts as done, a file
// that changed since the batch is left alone and named, and one failing never stops the others. What
// was restored is dropped from the snapshot, so running Undo again only handles what is left.
// Returns true when everything was restored.
export async function undoBatch(s: BatchSnapshot): Promise<boolean> {
  let ok = true;
  for (const d of [...s.docs]) {
    try {
      const now = hasUnsavedCopy(d.uri) || (await isLink(d.uri)) || !(await pathExists(d.uri)) ? undefined : decodeRules(await vscode.workspace.fs.readFile(d.uri));
      if (now !== d.before) {
        if (now !== d.after) {
          void vscode.window.showWarningMessage(l10n("releaseBoard.undo.changed", { file: path.posix.basename(d.uri.path) }));
          ok = false;
          continue;
        }
        await vscode.workspace.fs.writeFile(d.uri, Buffer.from(d.before, "utf8"));
      }
      s.docs.splice(s.docs.indexOf(d), 1);
    } catch (e) {
      ok = false;
      void vscode.window.showErrorMessage(l10n("releaseBoard.noRule.failed", { file: path.posix.basename(d.uri.path), error: e instanceof Error ? e.message : String(e) }));
    }
  }
  if (s.rules) {
    try {
      if (await undoRulesWrite(s.rules)) {
        delete s.rules;
      } else {
        ok = false;
      }
    } catch {
      ok = false;
    }
  }
  return ok;
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

// At most this many result files already in the folders are looked at when the watcher starts.
const START_SCAN = 20;

// Watches the hand-off folders for result files and passes the text of each readable one on, with its
// modified time. `onGone` hears of a deleted one. `scan` looks once at the newest files already there.
export function watchResults(roots: () => vscode.Uri[], onResult: (text: string, name: string, mtime: number) => void, onGone?: (name: string) => void): vscode.Disposable & { scan(): void } {
  const watcher = vscode.workspace.createFileSystemWatcher(`**/${HANDOFF_DIR}/*.result.json`);
  const seen = async (uri: vscode.Uri, mtime?: number): Promise<void> => {
    try {
      const time = mtime ?? (await vscode.workspace.fs.stat(uri)).mtime;
      const text = await readResultFile(uri, roots());
      if (text !== undefined) {
        onResult(text, path.posix.basename(uri.path), time);
      }
    } catch {
      // The file went away between the event and the read.
    }
  };
  const scan = (): void => {
    void (async () => {
      const found: Array<{ uri: vscode.Uri; mtime: number }> = [];
      for (const root of roots()) {
        try {
          const dir = vscode.Uri.joinPath(root, HANDOFF_DIR);
          for (const [name] of await vscode.workspace.fs.readDirectory(dir)) {
            if (RESULT_FILE.test(name)) {
              const uri = vscode.Uri.joinPath(dir, name);
              found.push({ uri, mtime: (await vscode.workspace.fs.stat(uri)).mtime });
            }
          }
        } catch {
          // No hand-off folder in this project.
        }
      }
      for (const f of found.sort((a, b) => b.mtime - a.mtime).slice(0, START_SCAN)) {
        await seen(f.uri, f.mtime);
      }
    })();
  };
  watcher.onDidCreate((u) => void seen(u));
  watcher.onDidChange((u) => void seen(u));
  watcher.onDidDelete((u) => onGone?.(path.posix.basename(u.path)));
  return { dispose: () => watcher.dispose(), scan };
}
