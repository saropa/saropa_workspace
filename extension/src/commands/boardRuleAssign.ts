import * as vscode from "vscode";
import { l10n } from "../i18n/l10n";
import { AssignRefusal, AssignResult, RuleCategory, SeverityResult, addDocRule, addFolderRule, clearDocStatus, docGlob, folderGlob, ruleCategories, setDocSeverity } from "../board/ruleAssign";
import { hideDoc } from "../board/ruleHide";
import { Severity } from "../board/severity";
import { orderLists } from "../board/boardOrder";
import { manualGroupNames, setDocGroup, setProjectOrder } from "../board/groupEdit";
import { RULES_FILE } from "./boardConfigLoad";
import { pathExists } from "./boardFileSource";
import { globHits } from "./boardRules";
import { BoardRun } from "./boardScanStore";
import { applyTextChange } from "./boardRuleWrite";
import { readRules } from "./boardRuleText";
import { RulesSnapshot } from "./boardRuleUndo";

// The helpers that moved out keep their old import path here.
export { RulesRead, hasUnsavedEdits, hasUnsavedCopy, isLink, plainWriteError, readRules, sameRead } from "./boardRuleText";
export { RulesSnapshot, undoRulesWrite } from "./boardRuleUndo";
export { TextChange, applyTextChange } from "./boardRuleWrite";

// Release Board, "Documents with no rule": assign a category to a folder of documents no rule
// placed, and preview what a rule for the folder would match. The page names a folder by the
// index of the row it was shown; the caller resolves it against the model it rendered and hands
// the folder in here. Nothing is written before the user picked a category and confirmed.

// One folder row of the section.
export interface NoRuleFolder {
  project: string;
  folder: string;
  count: number;
}

// Tells the user why the file was left alone.
function refuse(reason: AssignRefusal, folder: string): void {
  if (reason === "none") {
    void vscode.window.showInformationMessage(l10n("releaseBoard.rowMenu.autoNothing", { glob: folder }));
    return;
  }
  if (reason === "same") {
    void vscode.window.showInformationMessage(l10n("releaseBoard.group.already", { glob: folder }));
    return;
  }
  const keys: Record<Exclude<AssignRefusal, "none" | "same">, string> = {
    claimed: "releaseBoard.group.claimed",
    parse: "releaseBoard.noRule.badJson",
    glob: "releaseBoard.noRule.badGlob",
    name: "releaseBoard.group.badName",
    encoding: "releaseBoard.noRule.badEncoding",
    lossy: "releaseBoard.noRule.badLossy",
    shape: "releaseBoard.noRule.badShape",
    full: "releaseBoard.reorder.full"
  };
  const key = keys[reason];
  void vscode.window.showWarningMessage(l10n(key, { file: RULES_FILE, folder }));
}

// The pick list: one entry per category the existing rules offer.
interface CategoryPick extends vscode.QuickPickItem {
  category: RuleCategory;
}

// What one rule change is made of: the pick list title, the rule file text turned into the new
// text, the glob it writes, and the words of the confirmation.
interface RuleChange {
  project: string;
  title: string;
  glob: string;
  folder: string;
  make: (before: string | undefined, category: RuleCategory) => AssignResult;
  // The confirmation text key.
  confirm: string;
}

// Asks which category to give, shows the rule that would be added, asks to confirm, then adds the
// rule to the user's rules file (created when missing). Returns true when the file was written, so
// the caller scans again. A file that does not parse, has an unexpected shape, or changed while the
// user was choosing is never written.
async function writeRule(run: BoardRun, c: RuleChange): Promise<boolean> {
  const root = vscode.workspace.workspaceFolders?.[0];
  if (!root) {
    void vscode.window.showInformationMessage(l10n("releaseBoard.noFolder"));
    return false;
  }
  const def = run.cfg.projects.find((p) => p.id === c.project);
  if (def?.idMadeUnique) {
    void vscode.window.showWarningMessage(l10n("releaseBoard.noRule.unstableId", { project: def.id }));
    return false;
  }
  const categories = ruleCategories(run.cfg);
  if (categories.length === 0) {
    void vscode.window.showInformationMessage(l10n("releaseBoard.noRule.noCategories"));
    return false;
  }
  const picks: CategoryPick[] = categories.map((cat) => ({ label: cat.label, detail: l10n("releaseBoard.noRule.pickDetail", { glob: c.glob }), category: cat }));
  const chosen = await vscode.window.showQuickPick(picks, { title: c.title, placeHolder: l10n("releaseBoard.noRule.pickPlaceholder") });
  if (!chosen) {
    return false;
  }
  const project = def ?? run.cfg.projects.find((p) => p.id === c.project);
  return applyTextChange(root, {
    folder: c.folder,
    make: (before) => {
      const result = c.make(before, chosen.category);
      return result.ok ? { ok: true, text: result.text, vars: { glob: result.glob, id: result.id } } : result;
    },
    confirm: (vars) => l10n(c.confirm, { file: RULES_FILE, glob: String(vars.glob), project: project?.name ?? c.project, label: chosen.category.label }),
    button: l10n("releaseBoard.noRule.add"),
    done: (vars) => l10n("releaseBoard.noRule.added", { id: String(vars.id), glob: String(vars.glob), file: RULES_FILE }),
    refusal: refuse,
  });
}

// Changes the rules file text once for several documents at once, with every check of a single
// change: `make` turns the current text into the new one. Returns what the file held before
// (for Undo), or undefined when nothing was written.
export async function changeRules(run: BoardRun, projects: string[], make: (before: string | undefined) => { ok: true; text: string } | { ok: false; reason: AssignRefusal }): Promise<RulesSnapshot | undefined> {
  let root: vscode.WorkspaceFolder | undefined;
  for (const id of projects) {
    root = rulesRoot(run, id);
    if (!root) {
      return undefined;
    }
  }
  if (!root) {
    return undefined;
  }
  let snapshot: RulesSnapshot | undefined;
  await applyTextChange(root, {
    folder: "",
    make: (before) => {
      const r = make(before);
      return r.ok ? { ok: true, text: r.text, vars: {} } : r;
    },
    saved: (s) => (snapshot = s),
    refusal: refuse,
  });
  return snapshot;
}

// Takes one document off the board by listing its path in the rules file's `hidden` table. Goes
// through changeRules so it has every write check (unsaved copy, symlink, re-read before write) and
// returns the snapshot Undo restores, or undefined when nothing was written.
export function hideDocument(run: BoardRun, doc: { project: string; path: string }): Promise<RulesSnapshot | undefined> {
  return changeRules(run, [doc.project], (before) => hideDoc(before, doc));
}

// Gives every document of a folder a category by adding a rule for the folder.
// `winning` puts the rule ahead of the shipped rules, so it also moves documents a rule already
// placed (a row's Assign rule); without it the rule only places documents no rule matched.
export async function assignFolderRule(run: BoardRun, entry: NoRuleFolder, winning = false): Promise<boolean> {
  const glob = folderGlob(entry.folder);
  if (glob === undefined) {
    refuse("glob", entry.folder);
    return false;
  }
  return writeRule(run, {
    project: entry.project,
    glob,
    folder: entry.folder,
    title: l10n("releaseBoard.noRule.pick", { folder: entry.folder || "/", count: entry.count }),
    confirm: winning ? "releaseBoard.rowMenu.assignConfirm" : "releaseBoard.noRule.confirm",
    make: (before, category) => addFolderRule(before, { project: entry.project, folder: entry.folder, category, front: winning }),
  });
}

// Tells how many documents of the project sit under the folder, with the first few. Changes nothing.
export function previewFolder(run: BoardRun, entry: NoRuleFolder): void {
  const glob = folderGlob(entry.folder);
  if (glob === undefined) {
    refuse("glob", entry.folder);
    return;
  }
  const hits = globHits(run.result.rows, glob).filter((r) => r.project === entry.project);
  void vscode.window.showInformationMessage(
    hits.length === 0
      ? l10n("releaseBoard.previewNone", { glob })
      : l10n("releaseBoard.previewResult", { count: hits.length, glob, sample: hits.slice(0, 5).map((h) => h.path).join(", ") })
  );
}

// The names of the groups listed by hand, read from the rules file now (not from the last scan).
export async function readGroupNames(): Promise<string[]> {
  const root = vscode.workspace.workspaceFolders?.[0];
  if (!root) {
    return [];
  }
  const read = await readRules(vscode.Uri.joinPath(root.uri, RULES_FILE));
  if (read.kind !== "text") {
    return [];
  }
  try {
    const cfg = JSON.parse(read.text) as unknown;
    return manualGroupNames(typeof cfg === "object" && cfg !== null ? cfg : {});
  } catch {
    return [];
  }
}

// The first workspace folder, or a message when there is none; and the project's idMadeUnique check.
function rulesRoot(run: BoardRun, projectId: string): vscode.WorkspaceFolder | undefined {
  const root = vscode.workspace.workspaceFolders?.[0];
  if (!root) {
    void vscode.window.showInformationMessage(l10n("releaseBoard.noFolder"));
    return undefined;
  }
  const def = run.cfg.projects.find((p) => p.id === projectId);
  if (def?.idMadeUnique) {
    void vscode.window.showWarningMessage(l10n("releaseBoard.noRule.unstableId", { project: def.id }));
    return undefined;
  }
  return root;
}

// What the row menu changes for one document: its status (a category of the existing rules), its
// severity, both back to automatic, or its group (a name, or undefined to take it out of its group).
export type DocChange = { kind: "status"; category: RuleCategory } | { kind: "severity"; level: Severity } | { kind: "auto" } | { kind: "group"; name: string | undefined } | { kind: "order"; paths: string[] };

// The text with the status rules and the severity entry the board wrote for the document taken away.
function autoText(before: string | undefined, doc: { project: string; path: string }): SeverityResult {
  const sev = setDocSeverity(before, { project: doc.project, path: doc.path, severity: undefined });
  const afterSev = sev.ok ? sev.text : before;
  const st = clearDocStatus(afterSev, { project: doc.project, path: doc.path });
  if (sev.ok || st.ok) {
    return { ok: true, text: st.ok ? st.text : (afterSev as string) };
  }
  // Both found nothing to take away, or the file could not be read as rules.
  return sev.reason === "none" && st.reason === "none" ? { ok: false, reason: "none" } : st.reason === "none" ? sev : st;
}

// Changes one document's status, severity or group in the rules file at once, with no dialog: the same
// checks as every rules write. A status is a rule for the exact path placed ahead of the rule that
// placed it; a severity is an entry for the exact path that wins over the computed one; a group lists the exact
// path (a document taken out of a group the board found is listed in "ungrouped"); an order lists a
// group's paths in their new order in the project's order list. Returns
// what the file held before (for Undo), or undefined when nothing was written.
export async function changeDoc(run: BoardRun, doc: { project: string; path: string }, change: DocChange): Promise<RulesSnapshot | undefined> {
  if (docGlob(doc.path) === undefined) {
    refuse("glob", doc.path);
    return undefined;
  }
  const root = rulesRoot(run, doc.project);
  if (!root) {
    return undefined;
  }
  let snapshot: RulesSnapshot | undefined;
  // Only a path checked missing on disk leaves the order list; one merely absent from the scan stays.
  const gone = new Set<string>();
  const def = run.cfg.projects.find((p) => p.id === doc.project);
  if (change.kind === "order" && def) {
    const moved = new Set(change.paths);
    for (const p of orderLists(run.cfg.order)[doc.project] ?? []) {
      if (!moved.has(p) && !(await pathExists(vscode.Uri.joinPath(vscode.Uri.parse(def.path), p)))) {
        gone.add(p);
      }
    }
  }
  await applyTextChange(root, {
    folder: doc.path,
    make: (before) => {
      const r =
        change.kind === "status"
          ? addDocRule(before, { project: doc.project, path: doc.path, category: change.category })
          : change.kind === "severity"
            ? setDocSeverity(before, { project: doc.project, path: doc.path, severity: change.level })
            : change.kind === "group"
              ? setDocGroup(before, { project: doc.project, path: doc.path, group: change.name })
              : change.kind === "order"
                ? setProjectOrder(before, { project: doc.project, paths: change.paths, gone })
                : autoText(before, doc);
      return r.ok ? { ok: true, text: r.text, vars: {} } : r;
    },
    saved: (s) => (snapshot = s),
    refusal: refuse,
  });
  return snapshot;
}
