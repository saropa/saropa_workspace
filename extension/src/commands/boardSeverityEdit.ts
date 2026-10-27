import * as vscode from "vscode";
import { l10n } from "../i18n/l10n";
import { SeverityDict } from "../board/severity";
import { EditRefusal, EditResult, PreviewResult, SeverityDraft, applyDraft, dictOfSeverity, removeSeverity } from "../board/severityEdit";
import { RULES_FILE } from "./boardConfigLoad";
import { hasUnsavedCopy, isLink, readRules, sameRead } from "./boardRuleAssign";

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

function refuse(reason: EditRefusal): void {
  void vscode.window.showWarningMessage(l10n(REFUSALS[reason], { file: RULES_FILE, folder: "" }));
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
    }
  | { kind: "restore" };

export type SaveOutcome = "saved" | "unchanged" | "declined" | "refused";

// The words about what the change does to the open documents.
export function impactText(impact: PreviewResult | undefined, total?: number, lossy?: string): string {
  const bits: string[] = [];
  if (impact && impact.checked > 0) {
    bits.push(impact.changed === 0 ? l10n("releaseBoard.keywords.msg.impactNone") : l10n("releaseBoard.keywords.msg.impact", { changed: impact.changed, checked: impact.checked, eased: impact.eased }));
    if (total !== undefined && total > impact.checked) {
      bits.push(l10n("releaseBoard.keywords.msg.impactPartial", { checked: impact.checked, total }));
    }
  }
  if (lossy) {
    bits.push(l10n("releaseBoard.keywords.msg.lossyConfirm", { parts: lossy }));
  }
  return bits.join(" ");
}

// The dictionary the rules file holds now, or undefined when the file cannot be read as one.
export async function currentSeverityDict(): Promise<SeverityDict | undefined> {
  const root = vscode.workspace.workspaceFolders?.[0];
  if (!root) {
    return undefined;
  }
  const read = await readRules(vscode.Uri.joinPath(root.uri, RULES_FILE));
  if (read.kind === "none") {
    return dictOfSeverity(undefined);
  }
  if (read.kind === "encoding") {
    return undefined;
  }
  try {
    const doc: unknown = JSON.parse(read.text);
    return dictOfSeverity(typeof doc === "object" && doc !== null ? (doc as Record<string, unknown>).severity : undefined);
  } catch {
    return undefined;
  }
}

// Saves the change after the user confirmed. Returns "saved" when the file was written, so the
// caller scans again.
export async function saveSeverity(change: SeverityChange): Promise<SaveOutcome> {
  const root = vscode.workspace.workspaceFolders?.[0];
  if (!root) {
    void vscode.window.showInformationMessage(l10n("releaseBoard.noFolder"));
    return "refused";
  }
  const uri = vscode.Uri.joinPath(root.uri, RULES_FILE);
  if (hasUnsavedCopy(uri)) {
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
    refuse("encoding");
    return "refused";
  }
  const text = before.kind === "text" ? before.text : undefined;
  const result: EditResult = change.kind === "draft" ? applyDraft(text, change.draft) : removeSeverity(text);
  if (!result.ok) {
    refuse(result.reason);
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
  if (hasUnsavedCopy(uri) || !sameRead(await readRules(uri), before)) {
    void vscode.window.showWarningMessage(l10n("releaseBoard.noRule.changed", { file: RULES_FILE }));
    return "refused";
  }
  if (await linked()) {
    void vscode.window.showWarningMessage(l10n("releaseBoard.noRule.symlink", { file: RULES_FILE }));
    return "refused";
  }
  try {
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(root.uri, ".saropa"));
    await vscode.workspace.fs.writeFile(uri, Buffer.from(result.text, "utf8"));
  } catch (e) {
    void vscode.window.showErrorMessage(l10n("releaseBoard.noRule.failed", { file: RULES_FILE, error: e instanceof Error ? e.message : String(e) }));
    return "refused";
  }
  void vscode.window.showInformationMessage(l10n(change.kind === "draft" ? "releaseBoard.keywords.msg.saved" : "releaseBoard.keywords.msg.restored", { file: RULES_FILE }));
  return "saved";
}
