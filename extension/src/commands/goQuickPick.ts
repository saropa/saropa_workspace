import * as vscode from "vscode";
import { Shortcut, isAnnotationShortcut } from "../model/shortcut";
import { shortcutDisplayName } from "../model/shortcutDisplayName";
import { ShortcutStore } from "../model/shortcutStore";
import { NoteStore } from "../model/noteStore";
import { FolderWatchStore, watchDisplayName, watchKindLabel } from "../model/folderWatch";
import { ScriptsTreeProvider, ScriptTreeItem } from "../views/scriptsTreeProvider";
import { ADB_COMMAND_CATALOG } from "../model/adbCommandCatalog";
import { OPEN_REMOTE_CONTROL_COMMAND } from "../views/remoteControl/remoteControlPanel";
import { telemetry } from "../exec/telemetry";
import { adbRunHistory } from "../exec/adbRunHistory";
import { l10n } from "../i18n/l10n";
import {
  GO_CATEGORIES,
  GoCategory,
  GoRow,
  GoSource,
  buildGoRows,
  goKey,
  parseGoPrefix,
} from "./goItems";

// "Saropa: Go" — the single omni-entry point from MOBILE_REMOTE_CONTROL_PLAN's UI
// restructure, item 4. One QuickPick, one flat fuzzy-matched list across shortcuts,
// recipes, scripts, notes, watches and the adb command catalog, recents on top, `>`
// drill-down into one category.
//
// Built on the same persistent-QuickPick shape as hubQuickPick.ts (createQuickPick,
// ignoreFocusOut, separators, accept-vs-hide discrimination) rather than a one-shot
// showQuickPick, because the drill-down has to re-set `items` while the picker is open.
// hubQuickPick itself is not reused: it resolves on the first accept and owns no
// onDidChangeValue, which is exactly the piece this needs.
//
// This module is deliberately thin glue. Every decision about what is IN the list —
// ordering, recency, sectioning, prefix parsing — lives in goItems.ts as pure functions
// and is unit-tested there; what is left here is loading the data and dispatching the
// chosen row.
//
// Dispatch reuses each section's OWN click command (activatePin for a shortcut or recipe,
// runScript for a library script, vscode.open for a note, openWatch for a watch), so
// choosing a row here does exactly what clicking its tree row does — no second
// implementation of "run a shortcut" to drift. An adb row opens the Mobile Remote Control
// panel plain: the panel's search box is its own filter surface and the plan explicitly
// keeps individual adb commands as data, not commands, so no new focus plumbing is added
// for this entry point.

export const GO_COMMAND = "saropaWorkspace.go";

/** The live data sources the Go list spans. Passed in so nothing is re-constructed here. */
export interface GoStores {
  readonly store: ShortcutStore;
  readonly watchStore: FolderWatchStore;
  readonly noteStore: NoteStore;
  readonly scripts: ScriptsTreeProvider;
}

export function registerGoCommand(
  context: vscode.ExtensionContext,
  stores: GoStores
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(GO_COMMAND, () => showGoQuickPick(stores))
  );
}

// ---------------------------------------------------------------------------
// data loading
// ---------------------------------------------------------------------------

// Everything the list can contain, already display-resolved. Notes are the only async
// source (a directory read), so the whole gather is async.
async function collectGoSources(stores: GoStores): Promise<GoSource[]> {
  const sources: GoSource[] = [];

  // Shortcuts and recipes both live in the shortcut store; recipes are the isRecipe
  // entries the Recipes view paints, so they are split into their own category here
  // exactly as they are split into their own tree. Annotation rows (comments and
  // separators) are inert in the tree and so are not offered.
  const shortcuts = [
    ...stores.store.getProjectShortcuts(),
    ...stores.store.getGlobalShortcuts(),
  ].filter((s) => !isAnnotationShortcut(s) && !s.isRecipe);
  for (const shortcut of shortcuts) {
    sources.push(shortcutSource("shortcut", shortcut));
  }
  for (const recipe of stores.store.getRecipeShortcuts()) {
    if (!isAnnotationShortcut(recipe)) {
      sources.push(shortcutSource("recipe", recipe));
    }
  }

  for (const script of stores.scripts.scripts) {
    sources.push({
      category: "script",
      id: script.id,
      label: script.label,
      description: script.tags.join(", "),
      detail: script.description,
    });
  }

  const notes = [
    ...(await stores.noteStore.listProjectNotes()),
    ...(await stores.noteStore.listGlobalNotes()),
  ];
  for (const note of notes) {
    sources.push({
      category: "note",
      id: note.uri.toString(),
      label: note.filename,
      description:
        note.scope === "project" ? l10n("go.scopeProject") : l10n("notes.globalRoot"),
      detail: note.uri.fsPath,
    });
  }

  for (const watch of stores.watchStore.list()) {
    sources.push({
      category: "watch",
      id: watch.id,
      label: watchDisplayName(watch),
      description: watchKindLabel(watch),
      detail: watch.target,
    });
  }

  for (const entry of ADB_COMMAND_CATALOG) {
    sources.push({
      category: "adb",
      id: entry.id,
      label: l10n(entry.labelKey),
      description: entry.commandTemplate,
      detail: l10n(entry.descriptionKey),
    });
  }

  return sources;
}

function shortcutSource(category: GoCategory, shortcut: Shortcut): GoSource {
  return {
    category,
    id: shortcut.id,
    label: shortcutDisplayName(shortcut),
    description: shortcut.description,
    detail: shortcut.path,
  };
}

// The merged recency list, most-recent-first. Shortcut/recipe recency comes from the same
// telemetry store the Recent tree group reads; adb recency from adbRunHistory (a separate
// store on purpose — see its header). Scripts, notes and watches record no runs, so they
// carry no recency and simply sort in their own section order.
//
// A telemetry id names a shortcut OR a recipe (both are store entries), and the recency
// key is category-scoped, so each id contributes both keys adjacently — only the one that
// actually resolves to a source is used, and a recent recipe keeps its true position
// rather than sorting behind every recent shortcut. The adb history is appended after:
// both stores are already bounded and de-duplicated and the Recent section is capped, so
// a timestamp-exact cross-store merge would buy ordering nuance inside a six-row list.
function collectRecency(): string[] {
  const keys: string[] = [];
  for (const id of telemetry.list()) {
    keys.push(goKey("shortcut", id), goKey("recipe", id));
  }
  for (const id of adbRunHistory.recent()) {
    keys.push(goKey("adb", id));
  }
  return keys;
}

// ---------------------------------------------------------------------------
// the picker
// ---------------------------------------------------------------------------

// A QuickPickItem that remembers which source it came from, so accept can dispatch
// without matching back by label.
interface GoQuickPickItem extends vscode.QuickPickItem {
  source?: GoSource;
}

function toQuickPickItem(row: GoRow): GoQuickPickItem {
  return {
    label: row.label,
    description: row.description,
    detail: row.detail,
    kind:
      row.kind === "separator"
        ? vscode.QuickPickItemKind.Separator
        : vscode.QuickPickItemKind.Default,
    source: row.source,
  };
}

function goLabels(): { recent: string; categories: Record<GoCategory, string> } {
  return {
    recent: l10n("go.sectionRecent"),
    categories: {
      shortcut: l10n("go.sectionShortcuts"),
      recipe: l10n("go.sectionRecipes"),
      script: l10n("go.sectionScripts"),
      note: l10n("go.sectionNotes"),
      watch: l10n("go.sectionWatches"),
      adb: l10n("go.sectionAdb"),
    },
  };
}

async function showGoQuickPick(stores: GoStores): Promise<void> {
  const sources = await collectGoSources(stores);
  const recent = collectRecency();
  const labels = goLabels();

  const qp = vscode.window.createQuickPick<GoQuickPickItem>();
  qp.title = l10n("go.title");
  qp.placeholder = l10n("go.placeholder", {
    categories: GO_CATEGORIES.map((c) => `>${c}`).join(" "),
  });
  qp.ignoreFocusOut = true;
  qp.matchOnDescription = true;
  qp.matchOnDetail = true;
  qp.items = buildGoRows(sources, labels, { recent }).map(toQuickPickItem);

  // The drill-down. `>adb screenshot` narrows the list to adb and leaves "screenshot" in
  // the box for VS Code's own fuzzy match to apply, so no filtering is re-implemented
  // here. Rewriting qp.value re-enters this handler, which the value guard absorbs.
  let currentCategory: GoCategory | undefined;
  qp.onDidChangeValue((value) => {
    const prefix = parseGoPrefix(value);
    const nextCategory = prefix?.category;
    if (nextCategory !== currentCategory) {
      currentCategory = nextCategory;
      qp.items = buildGoRows(sources, labels, {
        recent,
        category: nextCategory,
      }).map(toQuickPickItem);
    }
    if (prefix && value !== prefix.remainder) {
      // Strip the token once the category is resolved, so the remaining text is what the
      // fuzzy matcher sees and the section header is what says which category is active.
      qp.value = prefix.remainder;
    }
  });

  // Unlike hubQuickPick.ts this resolves nothing to a caller, so accept and hide need no
  // discrimination: accept dispatches and then hides, and hide always disposes.
  qp.onDidAccept(() => {
    const picked = qp.selectedItems[0];
    qp.hide();
    if (picked?.source) {
      void runGoSource(picked.source, stores);
    }
  });
  qp.onDidHide(() => qp.dispose());
  qp.show();
}

// ---------------------------------------------------------------------------
// dispatch
// ---------------------------------------------------------------------------

// Run/open the chosen entry through the exact command its own tree row carries.
async function runGoSource(source: GoSource, stores: GoStores): Promise<void> {
  switch (source.category) {
    case "shortcut":
    case "recipe": {
      const shortcut = stores.store.findShortcut(source.id);
      if (shortcut) {
        await vscode.commands.executeCommand("saropaWorkspace.activatePin", shortcut);
      }
      return;
    }
    case "script": {
      const script = stores.scripts.findScript(source.id);
      if (script) {
        // runScript reads item.script, so hand it the same tree item the Scripts view
        // passes rather than a look-alike literal.
        await vscode.commands.executeCommand(
          "saropaWorkspace.runScript",
          new ScriptTreeItem(script)
        );
      }
      return;
    }
    case "note":
      await vscode.commands.executeCommand("vscode.open", vscode.Uri.parse(source.id));
      return;
    case "watch":
      await vscode.commands.executeCommand("saropaWorkspace.openWatch", source.id);
      return;
    case "adb":
      await vscode.commands.executeCommand(OPEN_REMOTE_CONTROL_COMMAND);
      return;
  }
}
