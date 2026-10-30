import * as vscode from "vscode";
import { l10n } from "../i18n/l10n";
import { AssignRefusal } from "../board/ruleAssign";
import { EditOutcome, EditorState, Loaded, applyState, loadText, setAssign, setGroupOverride, setUntag, stateOfText } from "../board/org/organizeEdit";
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

// The folder the rules file belongs to: the one the editor was pointed at, else the first workspace folder.
export const rulesFolder = (): vscode.WorkspaceFolder | undefined => vscode.workspace.workspaceFolders?.[0];

function refuse(reason: AssignRefusal, root: vscode.WorkspaceFolder): void {
  if (reason === "same") {
    void vscode.window.showInformationMessage(l10n("releaseBoard.tags.msg.nothing", { file: RULES_FILE }));
    return;
  }
  void vscode.window.showWarningMessage(l10n(REFUSALS[reason] ?? "releaseBoard.noRule.badShape", { file: RULES_FILE, folder: root.name }));
}

// A change built from the text, which may also say the file is no longer what the editor was opened on.
export type OrgOutcome = EditOutcome | { ok: false; reason: "stale" };

// Writes the change; resolves with what the write replaced, or undefined when nothing was written.
export async function writeOrganize(make: (text: string | undefined) => OrgOutcome, root: vscode.WorkspaceFolder | undefined = rulesFolder()): Promise<RulesSnapshot | undefined> {
  if (!root) {
    void vscode.window.showInformationMessage(l10n("releaseBoard.noFolder"));
    return undefined;
  }
  let snapshot: RulesSnapshot | undefined;
  let stale = false;
  await applyTextChange(root, {
    folder: "",
    make: (before) => {
      const r = make(before);
      if (!r.ok && r.reason === "stale") {
        stale = true;
        return { ok: false, reason: "same" };
      }
      return !r.ok ? r : r.changed ? { ok: true, text: r.text, vars: {} } : { ok: false, reason: "same" };
    },
    saved: (s) => (snapshot = s),
    refusal: (reason) => (stale ? void vscode.window.showWarningMessage(l10n("releaseBoard.tags.msg.changedSinceOpen", { file: RULES_FILE, folder: root.name })) : refuse(reason, root)),
  });
  return snapshot;
}

// Says what was saved, and where, and offers Undo; `onUndone` runs after the file was put back.
export function offerUndo(snapshot: RulesSnapshot, onUndone: () => Promise<void>, folder = ""): void {
  const undo = l10n("releaseBoard.tags.msg.undo");
  void vscode.window.showInformationMessage(l10n("releaseBoard.tags.msg.saved", { file: RULES_FILE, folder }), undo).then(async (pick) => {
    if (pick === undo && (await undoRulesWrite(snapshot))) {
      void vscode.window.showInformationMessage(l10n("releaseBoard.tags.msg.undone"));
      await onUndone();
    }
  });
}

// What the editor starts from: the state, the parts a save would drop, and the text it came from; or why the
// file cannot be edited (the reason is also what the words are chosen by).
export type OrganizeRead = ({ ok: true; text: string | undefined } & Loaded) | { ok: false; reason: AssignRefusal | "nofolder" };

export async function readOrganize(root: vscode.WorkspaceFolder | undefined = rulesFolder()): Promise<OrganizeRead> {
  if (!root) {
    return { ok: false, reason: "nofolder" };
  }
  const read = await readRules(vscode.Uri.joinPath(root.uri, RULES_FILE));
  if (read.kind === "encoding") {
    return { ok: false, reason: "encoding" };
  }
  const text = read.kind === "text" ? read.text : undefined;
  const loaded = loadText(text);
  return loaded.ok ? { ok: true, text, state: loaded.state, lossy: loaded.lossy } : loaded;
}

// Tells the user why the editor cannot start (no folder, or the file as it is cannot be edited).
export function explainUnreadable(reason: AssignRefusal | "nofolder", root: vscode.WorkspaceFolder | undefined): void {
  if (reason === "nofolder" || !root) {
    void vscode.window.showInformationMessage(l10n("releaseBoard.noFolder"));
    return;
  }
  refuse(reason, root);
}

// `expected`: the state the editor was opened on (or last saved); when the file holds another one now, nothing is written.
export const saveState = (state: EditorState, expected?: EditorState, root?: vscode.WorkspaceFolder): Promise<RulesSnapshot | undefined> =>
  writeOrganize((t) => (expected && JSON.stringify(stateOfText(t)) !== JSON.stringify(expected) ? { ok: false, reason: "stale" } : applyState(t, state)), root);
export const saveGroupOverride = (groupId: string, override: GroupOverride | undefined): Promise<RulesSnapshot | undefined> => writeOrganize((t) => setGroupOverride(t, groupId, override));
export const saveAssign = (doc: { project: string; path: string }, group: string | undefined): Promise<RulesSnapshot | undefined> => writeOrganize((t) => setAssign(t, doc, group));
export const saveUntag = (doc: { project: string; path: string }, tag: string, removed: boolean): Promise<RulesSnapshot | undefined> => writeOrganize((t) => setUntag(t, doc, tag, removed));
