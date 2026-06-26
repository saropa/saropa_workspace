import * as vscode from "vscode";
import { l10n } from "../i18n/l10n";

// Saved editor layouts (WOW #19): a named snapshot of which text editors are open
// and in which grid column, so a feature's working set ("Hero.tsx left,
// hero.module.css right, types.ts bottom") is one click to restore instead of six
// drags every morning. Stored in globalState so a layout follows the user across
// workspaces (the files are referenced by absolute/uri path, which is the useful
// behavior for a per-machine favorite set).
const LAYOUTS_KEY = "saropaWorkspace.editorLayouts";

// One captured editor: its document uri and the 1-based grid column it lived in.
// Columns are normalized to a contiguous 1..N range at save time (see saveLayout)
// so the restored grid has no empty gaps even if the user had closed a middle group.
interface LayoutTab {
  uri: string;
  viewColumn: number;
}

interface SavedLayout {
  name: string;
  // Number of side-by-side grid columns to recreate before reopening the tabs.
  columns: number;
  tabs: LayoutTab[];
}

// Read the saved layouts, tolerating a missing/garbage value (returns []). The
// shape is validated loosely — a corrupt entry is dropped rather than thrown — so a
// hand-edited globalState can never brick the command.
function readLayouts(context: vscode.ExtensionContext): SavedLayout[] {
  const raw = context.globalState.get<unknown>(LAYOUTS_KEY);
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.filter(
    (entry): entry is SavedLayout =>
      typeof entry === "object" &&
      entry !== null &&
      typeof (entry as SavedLayout).name === "string" &&
      Array.isArray((entry as SavedLayout).tabs)
  );
}

// Capture the current text-editor grid as a named layout. Only text tabs are
// captured (TabInputText): diffs, notebooks, and webviews have no single
// reopenable document, so they are skipped rather than guessed at — the count in
// the toast reflects what was actually saved. Saving under an existing name
// overwrites it, so re-saving a tweaked layout is the natural update path.
export async function saveLayout(
  context: vscode.ExtensionContext
): Promise<void> {
  const tabs: LayoutTab[] = [];
  const columns = new Set<number>();
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      // Only plain text editors carry a reopenable single document uri.
      if (tab.input instanceof vscode.TabInputText) {
        tabs.push({ uri: tab.input.uri.toString(), viewColumn: group.viewColumn });
        columns.add(group.viewColumn);
      }
    }
  }
  if (tabs.length === 0) {
    vscode.window.showWarningMessage(l10n("layout.empty"));
    return;
  }
  // Normalize columns to contiguous 1..N. A user who closed the middle group leaves
  // columns like {1,3}; remapping to {1,2} keeps the recreated grid gap-free and the
  // reopen target valid against the N groups created on restore.
  const sortedColumns = [...columns].sort((a, b) => a - b);
  const columnIndex = new Map(sortedColumns.map((col, i) => [col, i + 1]));
  for (const tab of tabs) {
    tab.viewColumn = columnIndex.get(tab.viewColumn) ?? 1;
  }

  const name = await vscode.window.showInputBox({
    prompt: l10n("layout.namePrompt"),
    placeHolder: l10n("layout.namePlaceholder"),
  });
  if (!name) {
    return;
  }
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    return;
  }
  // Overwrite a same-named layout rather than duplicating it.
  const layouts = readLayouts(context).filter((l) => l.name !== trimmed);
  layouts.push({ name: trimmed, columns: sortedColumns.length, tabs });
  await context.globalState.update(LAYOUTS_KEY, layouts);
  vscode.window.showInformationMessage(
    l10n("layout.saved", { name: trimmed, count: tabs.length })
  );
}

// Restore a saved layout: recreate its grid columns, then reopen each captured
// document in its column. A document that no longer resolves (file moved/deleted,
// untitled buffer gone) is skipped and counted, so the toast tells the user exactly
// how complete the restore was instead of failing silently or aborting the rest.
export async function restoreLayout(
  context: vscode.ExtensionContext
): Promise<void> {
  const layouts = readLayouts(context);
  if (layouts.length === 0) {
    vscode.window.showWarningMessage(l10n("layout.none"));
    return;
  }
  const items = layouts.map((layout) => ({
    label: layout.name,
    description: l10n("layout.itemDetail", {
      count: layout.tabs.length,
      columns: layout.columns,
    }),
    iconPath: new vscode.ThemeIcon("editor-layout"),
    layout,
  }));
  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: l10n("layout.placeholder"),
  });
  if (!picked) {
    return;
  }
  const layout = picked.layout;
  // Recreate the grid first so the reopen targets (viewColumn N) exist. orientation
  // 0 is horizontal (side-by-side columns), which matches how the columns were
  // captured; an empty group object means "default size".
  await vscode.commands.executeCommand("vscode.setEditorLayout", {
    orientation: 0,
    groups: Array.from({ length: Math.max(layout.columns, 1) }, () => ({})),
  });

  let opened = 0;
  let failed = 0;
  for (const tab of layout.tabs) {
    try {
      const doc = await vscode.workspace.openTextDocument(
        vscode.Uri.parse(tab.uri)
      );
      await vscode.window.showTextDocument(doc, {
        viewColumn: tab.viewColumn,
        preview: false,
      });
      opened++;
    } catch {
      // The document no longer opens (moved/deleted/untitled): skip it but keep
      // restoring the rest, and report the gap below.
      failed++;
    }
  }
  if (failed > 0) {
    vscode.window.showInformationMessage(
      l10n("layout.restoredPartial", { name: layout.name, opened, failed })
    );
  } else {
    vscode.window.showInformationMessage(
      l10n("layout.restored", { name: layout.name, opened })
    );
  }
}
