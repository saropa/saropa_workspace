import * as vscode from "vscode";
import { RULES_FILE } from "../commands/boardConfigLoad";
import { writeOrganize } from "../commands/boardOrganizeEdit";
import { RulesSnapshot } from "../commands/boardRuleAssign";
import { COLOUR_NAMES, LIMITS, cleanGroupOverride, groupOverrides, setGroupOverride } from "../board/org/organizeEdit";
import type { GroupOverride } from "../board/org/overrides";
import type { GroupView } from "../board/boardModel";
import { l10n } from "../i18n/l10n";

// The group-heading menu entries that change how a group looks (decision 45). The page sends only the entry name
// and a heading's item index; the group and every value come from the host, never from the page.
export const GROUP_LOOK_ACTS = ["gRename", "gEmoji", "gColour", "gAuto"] as const;
export type GroupLookAct = (typeof GROUP_LOOK_ACTS)[number];

export const isGroupLookAct = (act: unknown): act is GroupLookAct => (GROUP_LOOK_ACTS as readonly unknown[]).includes(act);

// What a successful change reports back to the panel: the undo snapshot and the text for the Undo bar.
export interface GroupLookResult {
  snapshot: RulesSnapshot;
  label: string;
}

// Asks for the new value of one part of the look. `undefined` means the person canceled (nothing is written);
// a patch with an undefined field means "remove this part" (an emptied emoji box). "auto" drops the whole override.
async function ask(act: GroupLookAct, g: GroupView): Promise<{ patch: GroupOverride; clear?: keyof GroupOverride } | "auto" | undefined> {
  if (act === "gAuto") {
    return "auto";
  }
  if (act === "gRename") {
    const name = await vscode.window.showInputBox({
      title: l10n("releaseBoard.groupLook.renameTitle", { name: g.name }),
      value: g.name,
      // The same cap and non-empty rule the rules-file reader enforces, so a refused value never reaches the write.
      validateInput: (v) => (cleanGroupOverride({ name: v }) === undefined ? l10n("releaseBoard.groupLook.nameInvalid", { max: LIMITS.groupName }) : undefined),
    });
    return name === undefined ? undefined : { patch: { name: name.trim() } };
  }
  if (act === "gEmoji") {
    const emoji = await vscode.window.showInputBox({
      title: l10n("releaseBoard.groupLook.emojiTitle", { name: g.name }),
      value: g.emoji ?? "",
      prompt: l10n("releaseBoard.groupLook.emojiPrompt"),
      validateInput: (v) => (cleanGroupOverride({ emoji: v }) === undefined ? l10n("releaseBoard.groupLook.emojiInvalid", { max: LIMITS.emoji }) : undefined),
    });
    // An emptied box removes the emoji override so the board's own emoji returns.
    return emoji === undefined ? undefined : emoji.trim() === "" ? { patch: {}, clear: "emoji" } : { patch: { emoji: emoji.trim() } };
  }
  const picked = await vscode.window.showQuickPick(COLOUR_NAMES.map((label) => ({ label })), { title: l10n("releaseBoard.groupLook.colorTitle", { name: g.name }) });
  return picked === undefined ? undefined : { patch: { colour: picked.label } };
}

// Changes one part of a group's look (or puts it back to automatic) and saves it at once. The patch is merged into
// the override read from the file inside the write, so a name set earlier is not lost when only the emoji changes.
// Returns undefined when canceled or when the write was refused (the write already told the person why).
export async function editGroupLook(act: GroupLookAct, g: GroupView): Promise<GroupLookResult | undefined> {
  const change = await ask(act, g);
  if (change === undefined) {
    return undefined;
  }
  const snapshot = await writeOrganize((text) => {
    if (change === "auto") {
      return setGroupOverride(text, g.id, undefined);
    }
    const next: GroupOverride = { ...groupOverrides(text)[g.id], ...change.patch };
    if (change.clear !== undefined) {
      delete next[change.clear];
    }
    return setGroupOverride(text, g.id, next);
  });
  return snapshot === undefined ? undefined : { snapshot, label: l10n(change === "auto" ? "releaseBoard.groupLook.undoAuto" : "releaseBoard.groupLook.undoSet", { name: g.name, file: RULES_FILE }) };
}
