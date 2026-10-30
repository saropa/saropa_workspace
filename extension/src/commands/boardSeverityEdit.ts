import * as vscode from "vscode";
import { l10n } from "../i18n/l10n";
import { SeverityDict } from "../board/severity";
import { EditRefusal, EditResult, PreviewResult, SeverityDraft, applyDraft, dictOfSeverity, removeSeverity } from "../board/severityEdit";
import { RULES_FILE } from "./boardConfigLoad";
import { withWriteLock, writeFileSafe } from "./boardWrite";
import { RulesSnapshot, hasUnsavedCopy, isLink, plainWriteError, readRules, sameRead } from "./boardRuleAssign";

// Release Board, saving the keyword editor into the `severity` key of the rules file. The same
// care as the rule writers: the file is parsed first, a file that is not plain UTF-8, has a key
// twice, has a too-large number, is open with unsaved edits, or sits behind a symbolic link is
// never written, the user confirms in plain words, and the file is read again just before the
// write so a change made meanwhile wins. Nothing else in the file is touched.

const REFUSALS: Record<EditRefusal, string> = {
  parse: "releaseBoard.noRule.badJson",
  shape: "releaseBoard.noRule.badShape",
  lossy: "releaseBoard.noRule.badLossy",
  encoding: "releaseBoard.noRule.badEncoding",
};

function refuse(reason: EditRefusal, folder = ""): void {
  void vscode.window.showWarningMessage(l10n(REFUSALS[reason], { file: RULES_FILE, folder }));
}

// What is saved: a draft, or the removal of the whole `severity` key.
export type SeverityChange =
  | {
      kind: "draft";
      draft: SeverityDraft;
      impact?: PreviewResult;
      // Open documents the keywords can change; more than impact.checked when the check was partial.
      total?: number;
      // The parts of the file whose unusable values the save drops or replaces, in words.
      lossy?: string;
      // The dictionary the editor was opened on. When the file holds another one at the moment
      // of the write, nothing is written.
      expected?: SeverityDict;
    }
  | { kind: "restore" };

export type SaveOutcome = "saved" | "unchanged" | "declined" | "refused";

// The words about what the change does to the open documents.
export function impactText(impact: PreviewResult | undefined, total?: number, lossy?: string): string {
  const bits: string[] = [];
  const checked = impact?.checked ?? 0;
  if (impact && checked > 0) {
    bits.push(impact.changed === 0 ? l10n("releaseBoard.keywords.msg.impactNone") : l10n("releaseBoard.keywords.msg.impact", { changed: impact.changed, checked, eased: impact.eased }));
  }
  // Some or all of the open documents were not checked: the effect on them is unknown.
  if (total !== undefined && total > checked) {
    bits.push(checked === 0 ? l10n("releaseBoard.keywords.msg.impactUnchecked", { total }) : l10n("releaseBoard.keywords.msg.impactPartial", { checked, total }));
  }
  if (lossy) {
    bits.push(l10n("releaseBoard.keywords.msg.lossyConfirm", { parts: lossy }));
  }
  return bits.join(" ");
}

// The dictionary a rules file text holds; undefined when the text does not parse.
export function dictOfText(text: string | undefined): SeverityDict | undefined {
  if (text === undefined || text.trim() === "") {
    return dictOfSeverity(undefined);
  }
  try {
    const doc: unknown = JSON.parse(text);
    return dictOfSeverity(typeof doc === "object" && doc !== null ? (doc as Record<string, unknown>).severity : undefined);
  } catch {
    return undefined;
  }
}

// The dictionary the rules file holds now, or undefined when the file cannot be read as one.
export async function currentSeverityDict(root: vscode.WorkspaceFolder | undefined = vscode.workspace.workspaceFolders?.[0]): Promise<SeverityDict | undefined> {
  if (!root) {
    return undefined;
  }
  const read = await readRules(vscode.Uri.joinPath(root.uri, RULES_FILE));
  return read.kind === "encoding" ? undefined : dictOfText(read.kind === "text" ? read.text : undefined);
}

// Saves the change after the user confirmed. Returns "saved" when the file was written, so the
// caller scans again.
// Options: `root`, the folder whose rules file is written (default: the first); `onSnapshot`, which receives what
// the write replaced and then owns the "saved" notice (the editor offers Undo with it).
export interface SaveOptions {
  root?: vscode.WorkspaceFolder;
  onSnapshot?: (snapshot: RulesSnapshot) => void;
}

export async function saveSeverity(change: SeverityChange, opts: SaveOptions = {}): Promise<SaveOutcome> {
  const root = opts.root ?? vscode.workspace.workspaceFolders?.[0];
  if (!root) {
    void vscode.window.showInformationMessage(l10n("releaseBoard.noFolder"));
    return "refused";
  }
  return withWriteLock(vscode.Uri.joinPath(root.uri, RULES_FILE), () => saveSeverityNow(change, opts, root));
}

async function saveSeverityNow(change: SeverityChange, opts: SaveOptions, root: vscode.WorkspaceFolder): Promise<SaveOutcome> {
  const uri = vscode.Uri.joinPath(root.uri, RULES_FILE);
  if (await hasUnsavedCopy(uri)) {
    void vscode.window.showWarningMessage(l10n("releaseBoard.noRule.unsaved", { file: RULES_FILE }));
    return "refused";
  }
  const linked = async (): Promise<boolean> => (await isLink(vscode.Uri.joinPath(root.uri, ".saropa"))) || (await isLink(uri));
  if (await linked()) {
    void vscode.window.showWarningMessage(l10n("releaseBoard.noRule.symlink", { file: RULES_FILE }));
    return "refused";
  }
  const before = await readRules(uri);
  if (before.kind === "encoding") {
    refuse("encoding", root.name);
    return "refused";
  }
  const text = before.kind === "text" ? before.text : undefined;
  // The check the user saw ran against the dictionary the editor was opened on. The text the
  // write is built from must still hold that dictionary.
  if (change.kind === "draft" && change.expected && JSON.stringify(dictOfText(text)) !== JSON.stringify(change.expected)) {
    void vscode.window.showWarningMessage(l10n("releaseBoard.keywords.msg.changedSinceOpen", { file: RULES_FILE }));
    return "refused";
  }
  const result: EditResult = change.kind === "draft" ? applyDraft(text, change.draft) : removeSeverity(text);
  if (!result.ok) {
    refuse(result.reason, root.name);
    return "refused";
  }
  if (!result.changed) {
    void vscode.window.showInformationMessage(l10n("releaseBoard.keywords.msg.nothing", { file: RULES_FILE }));
    return "unchanged";
  }
  const button = l10n(change.kind === "draft" ? "releaseBoard.keywords.msg.saveButton" : "releaseBoard.keywords.msg.restoreButton");
  const ask = change.kind === "draft" ? l10n("releaseBoard.keywords.msg.confirmSave", { file: RULES_FILE, impact: impactText(change.impact, change.total, change.lossy) }) : l10n("releaseBoard.keywords.msg.confirmRestore", { file: RULES_FILE });
  if ((await vscode.window.showWarningMessage(ask, { modal: true }, button)) !== button) {
    return "declined";
  }
  // The file is read again just before the write: a change made while the dialog was open wins.
  if ((await hasUnsavedCopy(uri)) || !sameRead(await readRules(uri), before)) {
    void vscode.window.showWarningMessage(l10n("releaseBoard.noRule.changed", { file: RULES_FILE }));
    return "refused";
  }
  if (await linked()) {
    void vscode.window.showWarningMessage(l10n("releaseBoard.noRule.symlink", { file: RULES_FILE }));
    return "refused";
  }
  let madeDir = false;
  try {
    const dir = vscode.Uri.joinPath(root.uri, ".saropa");
    try {
      await vscode.workspace.fs.stat(dir);
    } catch {
      madeDir = true;
    }
    await vscode.workspace.fs.createDirectory(dir);
    await writeFileSafe(uri, Buffer.from(result.text, "utf8"));
  } catch (e) {
    void vscode.window.showErrorMessage(plainWriteError(e, RULES_FILE));
    return "refused";
  }
  if (opts.onSnapshot && change.kind === "draft") {
    opts.onSnapshot({ before: text, after: result.text, ...(madeDir ? { madeDir } : {}), folder: root.uri.toString() });
  } else {
    void vscode.window.showInformationMessage(l10n(change.kind === "draft" ? "releaseBoard.keywords.msg.saved" : "releaseBoard.keywords.msg.restored", { file: RULES_FILE }));
  }
  return "saved";
}
