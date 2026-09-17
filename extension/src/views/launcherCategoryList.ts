import { LauncherItem } from "./launcherItems";
import { l10n } from "../i18n/l10n";

// The Launcher webview's left panel category list (PLAN_Launcher_Restructure.md, build order
// step 3): "All" plus one entry per pane, in the same fixed order paneModel()
// (src/views/launcher/launcherScriptCore.ts) already renders panes in. Kept vscode-free —
// unlike launcherViewData.ts, which composes this with vscode.workspace state — so it
// unit-tests directly under Node's test runner, the same way launcherAdbItem.ts's adapter
// does (see src/test/launcherAdbItem.test.ts).

// One row the left panel renders: a category id (a pane id, or "all"), its localized label,
// how many items currently file under it, and the codicon id to draw beside it.
export interface LauncherCategoryEntry {
  readonly id: LauncherItem["pane"] | "all";
  readonly label: string;
  readonly count: number;
  readonly icon: string;
}

// The canonical pane order, mirrored from paneModel()'s grouping order (mine, recipes,
// watches, files, scripts, notes, mobileRemote) so the left-panel list and the center pane
// order can never silently drift apart. Exported so the widening of LauncherItem["pane"]
// (already done in step 2) has exactly one place left to also widen for this list.
export const LAUNCHER_PANE_ORDER: readonly LauncherItem["pane"][] = [
  "mine",
  "recipes",
  "watches",
  "files",
  "scripts",
  "notes",
  "mobileRemote",
];

// Section glyphs mirror the header's own per-pane stat icons (buildHeader, in
// launcherViewData.ts) so a left-panel row and its header chip read as the same category.
const PANE_ICON: Record<LauncherItem["pane"], string> = {
  mine: "star-full",
  recipes: "lightbulb",
  watches: "eye",
  files: "files",
  scripts: "library",
  notes: "note",
  mobileRemote: "device-mobile",
};

// Reuses the exact section-label keys buildHeader()/launcherView.ts's `strings` payload
// already send to the client (launcher.mineSection etc.) rather than inventing new copy.
const PANE_LABEL_KEY: Record<LauncherItem["pane"], string> = {
  mine: "launcher.mineSection",
  recipes: "launcher.recipesSection",
  watches: "launcher.watchesSection",
  files: "launcher.filesSection",
  scripts: "launcher.scriptsSection",
  notes: "launcher.notesSection",
  mobileRemote: "launcher.mobileRemoteSection",
};

// How many items file under one pane. Extracted so buildHeader() (launcherViewData.ts) and
// buildCategoryList() below share the one counting implementation instead of each keeping its
// own copy of the same `items.reduce` loop.
export function countItemsByPane(
  items: readonly LauncherItem[],
  pane: LauncherItem["pane"]
): number {
  return items.reduce((n, it) => (it.pane === pane ? n + 1 : n), 0);
}

// Build the left panel's category list. "All" is always first, with the grand total — the
// left panel's default selection — followed by one entry per LAUNCHER_PANE_ORDER pane,
// including a pane with zero items: unlike the card grid (which hides an empty group as
// noise), this list is a navigation aid, and a 0 count ("Scripts (0)") is still useful
// information rather than something to hide.
export function buildCategoryList(items: readonly LauncherItem[]): LauncherCategoryEntry[] {
  const entries: LauncherCategoryEntry[] = [
    { id: "all", label: l10n("launcher.allCategory"), count: items.length, icon: "list-flat" },
  ];
  for (const pane of LAUNCHER_PANE_ORDER) {
    entries.push({
      id: pane,
      label: l10n(PANE_LABEL_KEY[pane]),
      count: countItemsByPane(items, pane),
      icon: PANE_ICON[pane],
    });
  }
  return entries;
}
