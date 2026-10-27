import * as vscode from "vscode";
import { Shortcut } from "../model/shortcut";
import { shortcutDisplayName } from "../model/shortcutDisplayName";
import { ShortcutStore } from "../model/shortcutStore";
import { l10n } from "../i18n/l10n";

/** One row of the tag picker; an empty `tag` marks the "new tag" entry. */
interface TagItem extends vscode.QuickPickItem {
  // Empty string marks the "new tag" entry; any other value is a real tag.
  tag: string;
}

/**
 * Multi-select picker over the tags already in use, with the shortcut's own tags
 * ticked and a "new tag" row on top. Returns undefined when dismissed.
 */
function pickTags(
  store: ShortcutStore,
  shortcut: Shortcut,
  name: string
): Thenable<TagItem[] | undefined> {
  const existing = store.tagsInUse();
  const current = new Set(shortcut.tags ?? []);
  const newTagItem: TagItem = {
    label: l10n("tag.addNew"),
    tag: "",
    alwaysShow: true,
  };
  const tagItems: TagItem[] = existing.map((t) => ({
    label: `$(tag) ${t}`,
    tag: t,
    picked: current.has(t),
  }));
  return vscode.window.showQuickPick([newTagItem, ...tagItems], {
    canPickMany: true,
    title: l10n("tag.title", { name }),
    placeHolder: l10n("tag.placeholder"),
  });
}

/**
 * Turns the picked rows into the final tag set. When "new tag" was picked, asks
 * for one or more tags (space/comma separated) and folds them in. Returns
 * undefined when that prompt is dismissed, so nothing is saved.
 */
async function resolveChosenTags(
  picks: readonly TagItem[],
  name: string
): Promise<Set<string> | undefined> {
  const chosen = new Set(picks.filter((p) => p.tag).map((p) => p.tag));
  // "New tag..." picked: prompt for one or more tags (space/comma separated) and
  // fold them into the chosen set before saving.
  if (picks.some((p) => p.tag === "")) {
    const entered = await vscode.window.showInputBox({
      title: l10n("tag.title", { name }),
      prompt: l10n("tag.newPrompt"),
      placeHolder: l10n("tag.newPlaceholder"),
    });
    if (entered === undefined) {
      return undefined;
    }
    for (const raw of entered.split(/[\s,]+/)) {
      const t = raw.replace(/^#/, "").trim();
      if (t.length > 0) {
        chosen.add(t.toLowerCase());
      }
    }
  }
  return chosen;
}

// WOW #17 — assign mode tags to a shortcut. A multi-select QuickPick of the tags
// already in use (so reuse is one click and tags stay consistent), pre-checking
// the shortcut's current tags, plus a "new tag" entry that prompts for one or more
// fresh tags. The chosen set replaces the shortcut's tags via store.setShortcutTags, which
// canonicalizes (lowercase / trim / de-dup) — so unchecking clears, checking adds.
//
// Auto and recipe shortcuts are recomputed each refresh, not stored, so they cannot
// carry a tag; that is surfaced rather than silently failing, matching how
// configureAppearance / configureSchedule guard the same shortcuts.
export async function tagShortcut(store: ShortcutStore, shortcut: Shortcut): Promise<void> {
  if (shortcut.isAuto || shortcut.isRecipe) {
    vscode.window.showWarningMessage(l10n("tag.autoUnsupported"));
    return;
  }

  const name = shortcutDisplayName(shortcut);
  const picks = await pickTags(store, shortcut, name);
  // Esc / dismiss: change nothing (distinct from selecting none, which clears).
  if (!picks) {
    return;
  }

  const chosen = await resolveChosenTags(picks, name);
  if (!chosen) {
    return;
  }

  await store.setShortcutTags(shortcut, Array.from(chosen));
  vscode.window.showInformationMessage(
    chosen.size > 0
      ? l10n("tag.saved", {
          name,
          tags: Array.from(chosen)
            .map((t) => `#${t}`)
            .join(" "),
        })
      : l10n("tag.cleared", { name })
  );
}
