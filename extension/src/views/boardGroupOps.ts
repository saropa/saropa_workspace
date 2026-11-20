import * as vscode from "vscode";
import { RULES_FILE } from "../commands/boardConfigLoad";
import { writeOrganize } from "../commands/boardOrganizeEdit";
import { RulesSnapshot } from "../commands/boardRuleAssign";
import { addTagText, mergeGroupsText, sharedWords } from "../board/org/groupOps";
import { LIMITS } from "../board/org/organizeEditCore";
import type { BoardItem, GroupView } from "../board/boardModel";
import { l10n } from "../i18n/l10n";

// The group-heading entries that act on the documents of a group (decision 45). Like the look entries, the page sends
// only the entry name and a heading's item index; the group, its documents and every value come from the host.
export const GROUP_OP_ACTS = ["gMerge", "gTag"] as const;
export type GroupOpAct = (typeof GROUP_OP_ACTS)[number];

export const isGroupOpAct = (act: unknown): act is GroupOpAct => (GROUP_OP_ACTS as readonly unknown[]).includes(act);

// What a successful change reports back to the panel: the undo snapshot and the text for the Undo bar.
export interface GroupOpResult {
  snapshot: RulesSnapshot;
  label: string;
}

// A pattern the tag editor accepts: one word, letters and digits with inner hyphens or apostrophes.
const PATTERN_WORD = /^[\p{L}\p{N}][\p{L}\p{N}'-]*$/u;

// The documents of one group in one project, as the pure edits want them.
const membersOf = (items: readonly BoardItem[], project: string, group: GroupView): BoardItem[] => items.filter((x) => x.project === project && x.group?.id === group.id);

// Merges the group of a heading into another group of the same project: every document moves by hand and the emptied
// group's own look is dropped, in one write with one Undo. Canceled or refused: nothing changes, undefined returned.
async function mergeGroup(items: readonly BoardItem[], at: BoardItem, source: GroupView): Promise<GroupOpResult | undefined> {
  const members = membersOf(items, at.project, source);
  // One entry per other group, with how many documents it holds, so the person sees what they merge into.
  const counts = new Map<string, { group: GroupView; n: number }>();
  for (const x of items) {
    if (x.project === at.project && x.group && x.group.id !== source.id) {
      const seen = counts.get(x.group.id);
      counts.set(x.group.id, { group: x.group, n: (seen?.n ?? 0) + 1 });
    }
  }
  if (counts.size === 0) {
    void vscode.window.showInformationMessage(l10n("releaseBoard.groupOps.mergeNone", { name: source.name, project: at.project }));
    return undefined;
  }
  const picked = await vscode.window.showQuickPick(
    [...counts.values()].map(({ group, n }) => ({ label: `${group.emoji ? `${group.emoji} ` : ""}${group.name}`, description: l10n("releaseBoard.groupOps.mergeCount", { n }), id: group.id })),
    { title: l10n("releaseBoard.groupOps.mergeTitle", { name: source.name, n: members.length }) },
  );
  if (picked === undefined) {
    return undefined;
  }
  const snapshot = await writeOrganize((text) => mergeGroupsText(text, members, source.id, picked.id));
  return snapshot === undefined ? undefined : { snapshot, label: l10n("releaseBoard.groupOps.mergeUndo", { name: source.name, target: picked.label, n: members.length, file: RULES_FILE }) };
}

// Turns the words a group's documents share into a new tag: asks for the tag name, then for the words (prefilled with
// the shared ones), and saves it into the rules file like a tag made in the editor.
async function tagFromGroup(items: readonly BoardItem[], at: BoardItem, source: GroupView): Promise<GroupOpResult | undefined> {
  const suggested = sharedWords(membersOf(items, at.project, source));
  const label = await vscode.window.showInputBox({
    title: l10n("releaseBoard.groupOps.tagTitle", { name: source.name }),
    value: source.name.slice(0, LIMITS.label),
    validateInput: (v) => (v.trim() === "" || v.length > LIMITS.label ? l10n("releaseBoard.groupOps.tagNameInvalid", { max: LIMITS.label }) : undefined),
  });
  if (label === undefined) {
    return undefined;
  }
  const words = await vscode.window.showInputBox({
    title: l10n("releaseBoard.groupOps.tagWordsTitle", { name: label.trim() }),
    prompt: l10n(suggested.length > 0 ? "releaseBoard.groupOps.tagWordsPrompt" : "releaseBoard.groupOps.tagWordsNone"),
    value: suggested.join(", "),
    validateInput: (v) => (parseWords(v) === undefined ? l10n("releaseBoard.groupOps.tagWordsInvalid", { max: LIMITS.pattern }) : undefined),
  });
  const patterns = words === undefined ? undefined : parseWords(words);
  if (patterns === undefined) {
    return undefined;
  }
  const emoji = source.emoji ?? "";
  const snapshot = await writeOrganize((text) => addTagText(text, { label, patterns, emoji }));
  return snapshot === undefined ? undefined : { snapshot, label: l10n("releaseBoard.groupOps.tagUndo", { label: label.trim(), words: patterns.join(", "), file: RULES_FILE }) };
}

// The words typed, split on commas and spaces, lower case and without repeats; undefined when there is none or one is
// not a word the tag editor would accept (so the box can refuse it before a write is tried).
function parseWords(text: string): string[] | undefined {
  const words = [...new Set(text.split(/[\s,]+/).filter(Boolean).map((w) => w.toLowerCase()))];
  return words.length > 0 && words.length <= LIMITS.patterns && words.every((w) => w.length <= LIMITS.pattern && PATTERN_WORD.test(w)) ? words : undefined;
}

// Runs one group-operation entry for the group of the heading item `at`.
export async function editGroupOp(act: GroupOpAct, items: readonly BoardItem[], at: BoardItem): Promise<GroupOpResult | undefined> {
  const group = at.group;
  if (!group) {
    return undefined;
  }
  return act === "gMerge" ? mergeGroup(items, at, group) : tagFromGroup(items, at, group);
}
