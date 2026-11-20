import * as vscode from "vscode";
import { l10n } from "../i18n/l10n";
import { cleanGroupName } from "../board/groupEdit";

// Release Board, row menu "Move to group...": asks which group a document goes into. The groups
// offered are the ones listed by hand in the rules file, then "New group..." (a name typed in an
// input box) and, for a document that is in a group, "Remove from group".

// The answer: a group name, undefined to take the document out of its group; or `cancelled`.
export type GroupPick = { cancelled: true } | { cancelled?: false; name: string | undefined };

interface Pick extends vscode.QuickPickItem {
  // Undefined for "Remove from group"; `fresh` for "New group...".
  name?: string;
  fresh?: true;
}

// `names` are the group names read fresh from the rules file.
export async function pickGroup(names: string[], doc: { title: string; group?: { name: string; stored?: string } }): Promise<GroupPick> {
  const picks: Pick[] = names.map((name) => ({ label: name, name, ...(doc.group && cleanGroupName(doc.group.stored ?? doc.group.name) === name ? { description: l10n("releaseBoard.group.pickCurrent") } : {}) }));
  picks.push({ label: l10n("releaseBoard.group.pickNew"), fresh: true });
  if (doc.group) {
    picks.push({ label: l10n("releaseBoard.group.pickRemove") });
  }
  const chosen = await vscode.window.showQuickPick(picks, { title: l10n("releaseBoard.group.pickTitle", { title: doc.title }) });
  if (!chosen) {
    return { cancelled: true };
  }
  if (!chosen.fresh) {
    return { name: chosen.name };
  }
  const typed = await vscode.window.showInputBox({
    prompt: l10n("releaseBoard.group.namePrompt"),
    validateInput: (v) => (cleanGroupName(v) === undefined ? l10n("releaseBoard.group.nameInvalid") : undefined)
  });
  const name = typed === undefined ? undefined : cleanGroupName(typed);
  return name === undefined ? { cancelled: true } : { name };
}
