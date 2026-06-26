import * as vscode from "vscode";
import { Shortcut } from "../model/shortcut";
import { ShortcutStore } from "../model/shortcutStore";
import { l10n } from "../i18n/l10n";

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

  const name = shortcut.label ?? (shortcut.path.split("/").pop() ?? shortcut.path);
  const existing = store.tagsInUse();
  const current = new Set(shortcut.tags ?? []);

  interface TagItem extends vscode.QuickPickItem {
    // Empty string marks the "new tag" entry; any other value is a real tag.
    tag: string;
  }
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

  const picks = await vscode.window.showQuickPick([newTagItem, ...tagItems], {
    canPickMany: true,
    title: l10n("tag.title", { name }),
    placeHolder: l10n("tag.placeholder"),
  });
  // Esc / dismiss: change nothing (distinct from selecting none, which clears).
  if (!picks) {
    return;
  }

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
      return;
    }
    for (const raw of entered.split(/[\s,]+/)) {
      const t = raw.replace(/^#/, "").trim();
      if (t.length > 0) {
        chosen.add(t.toLowerCase());
      }
    }
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
