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
// launcherCategoryList.test.ts's "pane order matches LAUNCHER_SCRIPT_CORE's own paneModel()"
// test is what actually catches the two orderings drifting apart at runtime; the guard below
// only catches a widened pane being left OUT of this array entirely.
//
// `as const satisfies readonly LauncherItem["pane"][]` (rather than the plain `: readonly
// LauncherItem["pane"][]` annotation this used to carry) keeps the array's literal element
// types — needed by the exhaustiveness check right below — while still checking every
// element is a valid pane id. A plain typed array's declared element type does not shrink or
// grow with the union it's declared over, so nothing about this line alone would fail to
// compile if LauncherItem["pane"] gained an 8th member and this array were not updated —
// unlike the Record-typed PANE_ICON/PANE_LABEL_KEY below, which DO catch a missing entry.
export const LAUNCHER_PANE_ORDER = [
  "mine",
  "recipes",
  "watches",
  "files",
  "scripts",
  "notes",
  "mobileRemote",
] as const satisfies readonly LauncherItem["pane"][];

// Compile-time exhaustiveness guard for LAUNCHER_PANE_ORDER, mirroring EVERY_PANE_HAS_AN_ENTRY
// (launcherViewData.ts) but for an array rather than a Record. `T[number]` is the union of
// LAUNCHER_PANE_ORDER's own literal elements (preserved by the `as const` above); if a
// widened LauncherItem["pane"] member is ever missing from the array, that union stops
// equaling the full pane union, `LauncherItem["pane"] extends T[number]` becomes `false`, and
// the `true` assigned below is no longer assignable to it — `npm run check-types` then fails
// pointing straight at this line. Never read at runtime; exists purely for the compiler.
type EveryPaneCovered<T extends readonly LauncherItem["pane"][]> =
  LauncherItem["pane"] extends T[number] ? true : false;
const _paneOrderCoversEveryPane: EveryPaneCovered<typeof LAUNCHER_PANE_ORDER> = true;
void _paneOrderCoversEveryPane;

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
//
// Judgment call (review finding, build-order step 3): these counts are the host's raw,
// pre-chip-filtering truth (every item that files under a pane, full stop). The header's own
// count badge (applyFilter(), launcherScriptRender.ts) counts only chip-visible cards, so
// with a header hide/show chip toggled off the two CAN legitimately disagree (e.g. left panel
// "All 57" vs. header "9") — that is intentional, not a bug: this list answers "how much is
// there", the header answers "how much am I currently showing". Documented at both counting
// sites (see applyFilter()'s matching comment) so the discrepancy reads as a deliberate
// choice rather than an oversight.
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
