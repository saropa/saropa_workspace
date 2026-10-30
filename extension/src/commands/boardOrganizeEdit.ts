import * as vscode from "vscode";
import { l10n } from "../i18n/l10n";
import { AssignRefusal } from "../board/ruleAssign";
import { EditOutcome, EditorState, applyState, setAssign, setGroupOverride, setUntag, stateOfText } from "../board/org/organizeEdit";
import type { GroupOverride } from "../board/org/overrides";
import { RULES_FILE } from "./boardConfigLoad";
import { RulesSnapshot, applyTextChange, readRules, undoRulesWrite } from "./boardRuleAssign";

// Release Board, saving the Tags and rules editor and the per-group and per-document overrides into the
// `organize` key of the rules file. The write goes through the same safe path as the rule writers (no unsaved copy,
// no symbolic link, strict UTF-8, a second read before the write); a change is undoable while the file still
// holds what it wrote.

const REFUSALS: Partial<Record<AssignRefusal, string>> = {
  parse: "releaseBoard.noRule.badJson",
  lossy: "releaseBoard.noRule.badLossy",
  encoding: "releaseBoard.noRule.badEncoding",
};

function refuse(reason: AssignRefusal): void {
  if (reason === "same") {
    void vscode.window.showInformationMessage(l10n("releaseBoard.tags.msg.nothing", { file: RULES_FILE }));
    return;
  }
  void vscode.window.showWarningMessage(l10n(REFUSALS[reason] ?? "releaseBoard.noRule.badShape", { file: RULES_FILE, folder: "" }));
}

// Writes the change; resolves with what the write replaced, or undefined when nothing was written.
export async function writeOrganize(make: (text: string | undefined) => EditOutcome): Promise<RulesSnapshot | undefined> {
  const root = vscode.workspace.workspaceFolders?.[0];
  if (!root) {
    void vscode.window.showInformationMessage(l10n("releaseBoard.noFolder"));
    return undefined;
  }
  let snapshot: RulesSnapshot | undefined;
  await applyTextChange(root, {
    folder: "",
    make: (before) => {
      const r = make(before);
      return !r.ok ? r : r.changed ? { ok: true, text: r.text, vars: {} } : { ok: false, reason: "same" };
    },
    saved: (s) => (snapshot = s),
    refusal: refuse,
  });
  return snapshot;
}

// Says what was saved and offers Undo; `onUndone` runs after the file was put back.
export function offerUndo(snapshot: RulesSnapshot, onUndone: () => Promise<void>): void {
  const undo = l10n("releaseBoard.tags.msg.undo");
  void vscode.window.showInformationMessage(l10n("releaseBoard.tags.msg.saved", { file: RULES_FILE }), undo).then(async (pick) => {
    if (pick === undo && (await undoRulesWrite(snapshot))) {
      void vscode.window.showInformationMessage(l10n("releaseBoard.tags.msg.undone"));
      await onUndone();
    }
  });
}

// The editor state the rules file holds now; undefined when the file cannot be read as one.
export async function currentOrganizeState(): Promise<EditorState | undefined> {
  const root = vscode.workspace.workspaceFolders?.[0];
  if (!root) {
    return undefined;
  }
  const read = await readRules(vscode.Uri.joinPath(root.uri, RULES_FILE));
  return read.kind === "encoding" ? undefined : stateOfText(read.kind === "text" ? read.text : undefined);
}

export const saveState = (state: EditorState): Promise<RulesSnapshot | undefined> => writeOrganize((t) => applyState(t, state));
export const saveGroupOverride = (groupId: string, override: GroupOverride | undefined): Promise<RulesSnapshot | undefined> => writeOrganize((t) => setGroupOverride(t, groupId, override));
export const saveAssign = (doc: { project: string; path: string }, group: string | undefined): Promise<RulesSnapshot | undefined> => writeOrganize((t) => setAssign(t, doc, group));
export const saveUntag = (doc: { project: string; path: string }, tag: string, removed: boolean): Promise<RulesSnapshot | undefined> => writeOrganize((t) => setUntag(t, doc, tag, removed));
