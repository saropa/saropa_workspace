import * as vscode from "vscode";
import { Pin } from "../model/pin";
import { PinStore } from "../model/pinStore";
import { l10n } from "../i18n/l10n";

// WOW #17 — assign mode tags to a pin. A multi-select QuickPick of the tags
// already in use (so reuse is one click and tags stay consistent), pre-checking
// the pin's current tags, plus a "new tag" entry that prompts for one or more
// fresh tags. The chosen set replaces the pin's tags via store.setPinTags, which
// canonicalizes (lowercase / trim / de-dup) — so unchecking clears, checking adds.
//
// Auto and recipe pins are recomputed each refresh, not stored, so they cannot
// carry a tag; that is surfaced rather than silently failing, matching how
// configureAppearance / configureSchedule guard the same pins.
export async function tagPin(store: PinStore, pin: Pin): Promise<void> {
  if (pin.isAuto || pin.isRecipe) {
    vscode.window.showWarningMessage(l10n("tag.autoUnsupported"));
    return;
  }

  const name = pin.label ?? (pin.path.split("/").pop() ?? pin.path);
  const existing = store.tagsInUse();
  const current = new Set(pin.tags ?? []);

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

  await store.setPinTags(pin, Array.from(chosen));
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
