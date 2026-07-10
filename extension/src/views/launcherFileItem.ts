import { fileTypeIcon } from "./fileTypeTokens";
import { l10n } from "../i18n/l10n";
import type { LauncherItem } from "./launcherItems";

// The plain inputs the host distills a ProjectFileInfo into. `relative` is preformatted
// host-side (formatRelativeTime needs the wall clock, kept out of this pure module);
// `isShortcut` comes from the store lookup the host already does for the tree row.
export interface FileItemInput {
  // Absolute fsPath: the card id, the drawer detail line, and the open target the host
  // validates the open message against.
  readonly path: string;
  readonly fileName: string;
  readonly version?: string;
  readonly relative: string;
  readonly isShortcut: boolean;
  // The category that surfaced this file (Project / Android / iOS / Web …) and its
  // codicon, both supplied by the host. They drive the files pane's collapsible
  // group header so the launcher groups by area exactly as the sidebar tree does.
  // Passed in (not derived here) so this module stays free of the vscode-importing
  // model that owns the glyph map.
  readonly category: string;
  readonly categoryGlyph: string;
}

// Build the launcher card for one surfaced project file (README / CHANGELOG / manifest /
// platform config). The glyph + tint come from the SAME fileTypeIcon map the tree row uses;
// the category drives the files pane's group header so the launcher groups by area exactly as
// the sidebar tree does. The secondary line mirrors the Project Files sidebar row: version
// (when known) leads, then freshness, then a "· shortcut" tag when the file is already a
// project shortcut. Openable, not runnable — a primary click expands the drawer; its Open
// opens the file in the editor.
export function fileLauncherItem(f: FileItemInput): LauncherItem {
  const token = fileTypeIcon(f.fileName) ?? {
    icon: "file",
    color: "charts.foreground",
  };
  const base = f.version
    ? l10n("projectFiles.descVersioned", { version: f.version, when: f.relative })
    : f.relative;
  const sub = f.isShortcut ? l10n("projectFiles.descPinned", { base }) : base;

  return {
    id: f.path,
    label: f.fileName,
    sub,
    desc: f.path,
    pane: "files",
    // The group header IS the category name (the pane title already says "Project
    // files", so the header need not repeat it). The id is namespaced by category so
    // its collapse state is stable and never collides with another pane's group id.
    // The webview renders these flat when only one category is present (no lone
    // header over the pane title) and grouped once a second category appears.
    section: f.category,
    groupId: "files:" + f.category,
    groupIcon: f.categoryGlyph,
    groupColor: "charts.green",
    icon: token.icon,
    color: token.color,
    kind: "file",
    runnable: false,
    openable: true,
    // A surfaced project file has a concrete on-disk path; expose the drawer's Copy path
    // button so the user can grab the location without opening the file. The host resolves
    // the path from the card id (which is the absolute fsPath for a project file).
    copyable: true,
    menu: [],
  };
}
