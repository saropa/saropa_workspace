import * as vscode from "vscode";
import { l10n } from "../i18n/l10n";
import { AssignRefusal, AssignResult, RuleCategory, SeverityResult, addDocRule, addFolderRule, clearDocStatus, decodeRules, docGlob, folderGlob, ruleCategories, setDocSeverity } from "../board/ruleAssign";
import { Severity } from "../board/severity";
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

// What reading the rules file found: no file, its text, or a file that is not plain UTF-8.
export type RulesRead = { kind: "none" } | { kind: "text"; text: string } | { kind: "encoding" };

export async function readRules(uri: vscode.Uri): Promise<RulesRead> {
  if (!(await pathExists(uri))) {
    return { kind: "none" };
  }
  const text = decodeRules(await vscode.workspace.fs.readFile(uri));
  return text === undefined ? { kind: "encoding" } : { kind: "text", text };
}

export const sameRead = (a: RulesRead, b: RulesRead): boolean => a.kind === b.kind && (a.kind !== "text" || a.text === (b as { text: string }).text);

// True when the path is a symbolic link (the rules file or its folder): a write would go through it.
export async function isLink(uri: vscode.Uri): Promise<boolean> {
  try {
    return ((await vscode.workspace.fs.stat(uri)).type & vscode.FileType.SymbolicLink) !== 0;
  } catch {
    return false;
  }
}

// True when the rules file is open in an editor with unsaved edits: the write would drop them.
export function hasUnsavedCopy(uri: vscode.Uri): boolean {
  return vscode.workspace.textDocuments.some((d) => d.isDirty && d.uri.toString() === uri.toString());
}

// Tells the user why the file was left alone.
function refuse(reason: AssignRefusal, folder: string): void {
  if (reason === "none") {
    void vscode.window.showInformationMessage(l10n("releaseBoard.rowMenu.autoNothing", { glob: folder }));
    return;
  }
  const key =
    reason === "parse"
      ? "releaseBoard.noRule.badJson"
      : reason === "glob"
        ? "releaseBoard.noRule.badGlob"
        : reason === "encoding"
          ? "releaseBoard.noRule.badEncoding"
          : reason === "lossy"
            ? "releaseBoard.noRule.badLossy"
            : "releaseBoard.noRule.badShape";
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

// What a write replaced: the file text before (undefined when there was no file) and the text
// written. Undo puts `before` back, and only while the file still holds `after`.
export interface RulesSnapshot {
  before: string | undefined;
  after: string;
}

// One change to the text of the rules file, with the words that go with it. Without `confirm` the
// change is written at once and `saved` hands the caller what it replaced.
interface TextChange {
  folder: string;
  // The new text from the current one, or why it cannot be made; vars are shown in the words.
  make: (before: string | undefined) => { ok: true; text: string; vars: Record<string, string> } | { ok: false; reason: AssignRefusal };
  confirm?: (vars: Record<string, string>) => string;
  button?: string;
  done?: (vars: Record<string, string>) => string;
  saved?: (snapshot: RulesSnapshot) => void;
  refusal: (reason: AssignRefusal, folder: string) => void;
}

// True when the rules file or its folder is a symbolic link: a write would go through it.
async function linkedRules(root: vscode.WorkspaceFolder, uri: vscode.Uri): Promise<boolean> {
  return (await isLink(vscode.Uri.joinPath(root.uri, ".saropa"))) || (await isLink(uri));
}

// Writes a change to the rules file with every check: no unsaved copy open, no symbolic link,
// strict UTF-8, a confirmation that names the change (when it has one), and a second read just
// before the write. Returns true when the file was written, so the caller scans again.
async function applyTextChange(root: vscode.WorkspaceFolder, c: TextChange): Promise<boolean> {
  const uri = vscode.Uri.joinPath(root.uri, RULES_FILE);
  if (hasUnsavedCopy(uri)) {
    void vscode.window.showWarningMessage(l10n("releaseBoard.noRule.unsaved", { file: RULES_FILE }));
    return false;
  }
  if (await linkedRules(root, uri)) {
    void vscode.window.showWarningMessage(l10n("releaseBoard.noRule.symlink", { file: RULES_FILE }));
    return false;
  }
  const before = await readRules(uri);
  if (before.kind === "encoding") {
    c.refusal("encoding", c.folder);
    return false;
  }
  const result = c.make(before.kind === "text" ? before.text : undefined);
  if (!result.ok) {
    c.refusal(result.reason, c.folder);
    return false;
  }
  if (c.confirm && (await vscode.window.showWarningMessage(c.confirm(result.vars), { modal: true }, c.button ?? "")) !== c.button) {
    return false;
  }
  // The file is read again just before the write: a change made while the dialogs were open wins.
  if (hasUnsavedCopy(uri) || !sameRead(await readRules(uri), before)) {
    void vscode.window.showWarningMessage(l10n("releaseBoard.noRule.changed", { file: RULES_FILE }));
    return false;
  }
  if (await linkedRules(root, uri)) {
    void vscode.window.showWarningMessage(l10n("releaseBoard.noRule.symlink", { file: RULES_FILE }));
    return false;
  }
  try {
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(root.uri, ".saropa"));
    await vscode.workspace.fs.writeFile(uri, Buffer.from(result.text, "utf8"));
  } catch (e) {
    void vscode.window.showErrorMessage(l10n("releaseBoard.noRule.failed", { file: RULES_FILE, error: e instanceof Error ? e.message : String(e) }));
    return false;
  }
  if (c.done) {
    void vscode.window.showInformationMessage(c.done(result.vars));
  }
  c.saved?.({ before: before.kind === "text" ? before.text : undefined, after: result.text });
  return true;
}

// Puts the rules file back to what an inline change replaced (removing it when there was none).
// Only while the file still holds exactly what that change wrote, with the same checks as a write:
// a later edit by hand, by another change or in an open editor is never overwritten.
export async function undoRulesWrite(s: RulesSnapshot): Promise<boolean> {
  const root = vscode.workspace.workspaceFolders?.[0];
  if (!root) {
    return false;
  }
  const uri = vscode.Uri.joinPath(root.uri, RULES_FILE);
  if (hasUnsavedCopy(uri)) {
    void vscode.window.showWarningMessage(l10n("releaseBoard.noRule.unsaved", { file: RULES_FILE }));
    return false;
  }
  if (await linkedRules(root, uri)) {
    void vscode.window.showWarningMessage(l10n("releaseBoard.noRule.symlink", { file: RULES_FILE }));
    return false;
  }
  const now = await readRules(uri);
  if (now.kind !== "text" || now.text !== s.after) {
    void vscode.window.showWarningMessage(l10n("releaseBoard.undo.changed", { file: RULES_FILE }));
    return false;
  }
  try {
    if (s.before === undefined) {
      await vscode.workspace.fs.delete(uri);
    } else {
      await vscode.workspace.fs.writeFile(uri, Buffer.from(s.before, "utf8"));
    }
  } catch (e) {
    void vscode.window.showErrorMessage(l10n("releaseBoard.noRule.failed", { file: RULES_FILE, error: e instanceof Error ? e.message : String(e) }));
    return false;
  }
  return true;
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
// severity (undefined takes the entry away), or both back to automatic.
export type DocChange = { kind: "status"; category: RuleCategory } | { kind: "severity"; level: Severity | undefined } | { kind: "auto" };

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

// Changes one document's status or severity in the rules file at once, with no dialog: the same
// checks as every rules write. A status is a rule for the exact path placed ahead of the rule that
// placed it; a severity is an entry for the exact path that wins over the computed one. Returns
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
  await applyTextChange(root, {
    folder: doc.path,
    make: (before) => {
      const r =
        change.kind === "status"
          ? addDocRule(before, { project: doc.project, path: doc.path, category: change.category })
          : change.kind === "severity"
            ? setDocSeverity(before, { project: doc.project, path: doc.path, severity: change.level })
            : autoText(before, doc);
      return r.ok ? { ok: true, text: r.text, vars: {} } : r;
    },
    saved: (s) => (snapshot = s),
    refusal: refuse,
  });
  return snapshot;
}

