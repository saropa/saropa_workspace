import * as vscode from "vscode";
import { ShortcutStore } from "../model/shortcutStore";
import { ShortcutScope, RoutineMember, isAnnotationShortcut } from "../model/shortcut";
import { SharedShortcut } from "../import/shareLink";
import { l10n } from "../i18n/l10n";
import { asShortcut } from "./shortcutArgResolution";

// "New routine from selection". Split out of shortcutExecution.ts, which re-exports
// newRoutineFromSelection so existing imports keep working.

/**
 * Turns the selected tree rows into routine members, in selection order.
 * Duplicates, nested routines and comment/separator rows are dropped.
 */
function collectRoutineMembers(arg: unknown, args: unknown[]): RoutineMember[] {
  // A view/item context-menu command receives (clickedItem, allSelectedItems[]). Fall
  // back to the single clicked item when no multi-selection array is passed.
  const rawItems = Array.isArray(args) && args.length > 0 ? args : arg !== undefined ? [arg] : [];
  const members: RoutineMember[] = [];
  const seen = new Set<string>();
  for (const raw of rawItems) {
    const shortcut = asShortcut(raw);
    if (!shortcut) {
      continue;
    }
    // Routines do not nest, and an annotation shortcut (comment / separator) has nothing
    // to run — neither belongs in a member list.
    if (shortcut.action?.kind === "routine" || isAnnotationShortcut(shortcut)) {
      continue;
    }
    const key = shortcut.recipeId ?? shortcut.id;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    members.push(
      shortcut.recipeId
        ? { recipeId: shortcut.recipeId, label: shortcut.label }
        : { pinId: shortcut.id, label: shortcut.label }
    );
  }
  return members;
}

// "New routine from selection": compose the multi-selected shortcuts into one routine
// shortcut that runs them in sequence. Members reference each shortcut by recipeId
// (preferred — it survives promote/reload) or shortcut id (a non-recipe stored shortcut),
// skipping routines (no nesting) and de-duping. The auto-offered Morning routine is the
// convenient default; this lets any set of recipe shortcuts be hand-composed.
export async function newRoutineFromSelection(store: ShortcutStore, arg: unknown, args: unknown[]): Promise<void> {
  const members = collectRoutineMembers(arg, args);
  if (members.length < 2) {
    vscode.window.showWarningMessage(l10n("routine.new.needTwo"));
    return;
  }

  const name = await vscode.window.showInputBox({
    title: l10n("routine.new.title"),
    prompt: l10n("routine.new.prompt", { count: members.length }),
    value: l10n("routine.new.defaultName"),
    validateInput: (v) => (v.trim().length > 0 ? undefined : l10n("routine.new.nameEmpty")),
  });
  if (name === undefined) {
    return;
  }

  const shared: SharedShortcut = {
    v: 1,
    label: name.trim(),
    action: { kind: "routine", members },
    icon: "run-all",
    color: "charts.green",
  };
  const scope: ShortcutScope = (vscode.workspace.workspaceFolders?.length ?? 0) > 0 ? "project" : "global";
  const added = await store.importShortcut(shared, scope);
  vscode.window.showInformationMessage(
    added
      ? l10n("routine.new.saved", { name: name.trim(), count: members.length })
      : l10n("routine.new.notSaved")
  );
}
