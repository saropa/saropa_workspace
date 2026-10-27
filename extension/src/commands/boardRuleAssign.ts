import * as vscode from "vscode";
import { l10n } from "../i18n/l10n";
import { AssignRefusal, RuleCategory, addFolderRule, folderGlob, ruleCategories } from "../board/ruleAssign";
import { RULES_FILE } from "./boardConfigLoad";
import { pathExists } from "./boardFileSource";
import { globHits } from "./boardRules";
import { BoardRun } from "./boardScanStore";

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

// The text of the rules file, or undefined when there is none.
async function readRules(uri: vscode.Uri): Promise<string | undefined> {
  if (!(await pathExists(uri))) {
    return undefined;
  }
  return Buffer.from(await vscode.workspace.fs.readFile(uri)).toString("utf8");
}

// Tells the user why the file was left alone.
function refuse(reason: AssignRefusal, folder: string): void {
  const key = reason === "parse" ? "releaseBoard.noRule.badJson" : reason === "glob" ? "releaseBoard.noRule.badGlob" : "releaseBoard.noRule.badShape";
  void vscode.window.showWarningMessage(l10n(key, { file: RULES_FILE, folder }));
}

// The pick list: one entry per category the existing rules offer.
interface CategoryPick extends vscode.QuickPickItem {
  category: RuleCategory;
}

// Asks which category the folder's documents belong to, shows the rule that would be added,
// asks to confirm, then adds the rule to the user's rules file (created when missing). Returns
// true when the file was written, so the caller scans again. A file that does not parse, has an
// unexpected shape, or changed while the user was choosing is never written.
export async function assignFolderRule(run: BoardRun, entry: NoRuleFolder): Promise<boolean> {
  const root = vscode.workspace.workspaceFolders?.[0];
  if (!root) {
    void vscode.window.showInformationMessage(l10n("releaseBoard.noFolder"));
    return false;
  }
  const glob = folderGlob(entry.folder);
  if (glob === undefined) {
    refuse("glob", entry.folder);
    return false;
  }
  const categories = ruleCategories(run.cfg);
  if (categories.length === 0) {
    void vscode.window.showInformationMessage(l10n("releaseBoard.noRule.noCategories"));
    return false;
  }
  const picks: CategoryPick[] = categories.map((c) => ({ label: c.label, detail: l10n("releaseBoard.noRule.pickDetail", { glob }), category: c }));
  const chosen = await vscode.window.showQuickPick(picks, {
    title: l10n("releaseBoard.noRule.pick", { folder: entry.folder || "/", count: entry.count }),
    placeHolder: l10n("releaseBoard.noRule.pickPlaceholder"),
  });
  if (!chosen) {
    return false;
  }
  const uri = vscode.Uri.joinPath(root.uri, RULES_FILE);
  const before = await readRules(uri);
  const result = addFolderRule(before, { project: entry.project, folder: entry.folder, category: chosen.category });
  if (!result.ok) {
    refuse(result.reason, entry.folder);
    return false;
  }
  const add = l10n("releaseBoard.noRule.add");
  const project = run.cfg.projects.find((p) => p.id === entry.project);
  const ask = l10n("releaseBoard.noRule.confirm", { file: RULES_FILE, glob: result.glob, project: project?.name ?? entry.project, label: chosen.category.label });
  if ((await vscode.window.showWarningMessage(ask, { modal: true }, add)) !== add) {
    return false;
  }
  // The file is read again just before the write: a change made while the dialogs were open wins.
  if ((await readRules(uri)) !== before) {
    void vscode.window.showWarningMessage(l10n("releaseBoard.noRule.changed", { file: RULES_FILE }));
    return false;
  }
  try {
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(root.uri, ".saropa"));
    await vscode.workspace.fs.writeFile(uri, Buffer.from(result.text, "utf8"));
  } catch (e) {
    void vscode.window.showErrorMessage(l10n("releaseBoard.noRule.failed", { file: RULES_FILE, error: e instanceof Error ? e.message : String(e) }));
    return false;
  }
  void vscode.window.showInformationMessage(l10n("releaseBoard.noRule.added", { id: result.id, glob: result.glob, file: RULES_FILE }));
  return true;
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
