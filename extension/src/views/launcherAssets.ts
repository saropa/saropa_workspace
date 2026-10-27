// Inlined CSS for the "Saropa Workspace" Panel webview, kept in its own module so
// launcherView.ts stays the controller/host side. Injected under the view's per-load nonce;
// loads no remote resource (the one local resource is the codicon font, loaded host-side via
// asWebviewUri). All colors/spacing bind to --vscode-* theme variables so the surface matches
// the editor in light/dark/high-contrast. The client script (LAUNCHER_SCRIPT) lives in its
// own module (launcherScript.ts) so this file stays under the line cap.
//
// Header: a two-part bar (.head-bar) — the project block on the leading edge, the compact
// search group on the trailing edge. The project block reads as one line: the folder name,
// then the declared version + a small informational stat (scheduled rituals) inline beside
// it. A loading indicator is shown until the first data message arrives.
// The name paints synchronously from the host's initial HTML; the version + stat arrive in
// the first data message (they need the disk scan) and are written by renderHeader.
//
// Build order step 7 (PLAN_Launcher_Restructure.md) removed the per-pane stat CHIPS that
// used to live here (mine/recipes/watches/files/scripts/mobileRemote/notes counts, each a
// clickable show/hide toggle with its own hidden-state machine) — the left panel's category
// list (step 3) already shows the same per-category counts via a strictly better single-
// select mechanism, so the chips were pure duplication once that landed. The gear button and
// the temporary right-panel-toggle button that used to sit beside the search group are also
// gone, replaced by native view/title icons (saropaWorkspace.openSettings,
// saropaWorkspace.launcher.showRightPanel/hideRightPanel — split into a complementary pair so
// the icon itself reflects the panel's shown/hidden state, a review-flagged accessibility
// fix). Search itself was NOT part of that cleanup — see launcherViewShell.ts's header markup
// comment for why it has no native replacement.
//
// Layout (the design the launcher earns over a TreeView): the Panel is wide and short, so
// the surface splits into responsive panes that sit side by side when wide and stack when
// narrow. Each pane holds collapsible groups; each group holds a responsive card grid.
// Every card wears a tinted codicon matching its file type / action kind (the same token
// map the sidebar tree uses). A primary click EXPANDS a card's drawer (full name, path,
// description, and Open/Run buttons) rather than opening — browsing is non-destructive;
// the ▶ button still runs in one click. A right-click opens a flat, separator-grouped menu
// mirroring the sidebar's actions, routed to the same host commands by shortcut id.
//
// Search is client-side: the host posts the full item set once per change and the script
// filters live on every keystroke; while a query is active, collapsed groups reveal their
// matches so a result is never hidden behind a fold. Pane visibility follows the left
// panel's category selection (step 3) — "All" shows every pane, a specific category shows
// only its own; inner groups collapse independently, with posture persisted across reloads
// via the webview's getState/setState.

import { LEFT_PANEL_LIMITS, RIGHT_PANEL_LIMITS } from "./launcher/launcherSplitLogic";
import { LAUNCHER_STYLE_CONTROLS } from "./launcherAssetsControls";

/** Stylesheet for the launcher webview. */
export const LAUNCHER_STYLE = `
/* The one place the card-button label size and box padding live. Every card action
   button (.run, .btn) reads these variables, so a retune is a single edit and the two
   styles cannot drift apart. Native <button>s do not inherit the body font, so each rule
   also sets font-family: inherit alongside the size. The padding is asymmetric (1px more
   on top): the buttons pair a codicon with smaller-than-em label text whose cap-height
   rides above the icon's optical center, so a symmetric box read as text-sits-high. */
:root {
  color-scheme: light dark;
  --launcher-btn-font: 0.88em;
  --launcher-btn-pad: 4px 9px 3px;
  /* The drawer buttons' codicon size (the codicon font's own default, pinned here so the
     expanded head button can read the same value instead of relying on that default). */
  --launcher-btn-icon: 16px;
}
* { box-sizing: border-box; }
body {
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size);
  color: var(--vscode-foreground);
  background: var(--vscode-editor-background);
  margin: 0;
  padding: 8px 10px 14px;
}
header {
  position: sticky; top: 0; z-index: 3;
  background: var(--vscode-editor-background);
  padding-bottom: 8px;
}
/* The header is a two-part bar: the project block (name + version + counts) on the
   leading edge, and the compact search group on the trailing edge. The Panel is wide,
   so space-between puts them at opposite ends and the space the developer noted beside
   the search is filled with the project summary. It wraps when the Panel is narrow, the
   search dropping below the project line, so neither block is crushed. */
.head-bar {
  display: flex; align-items: center; justify-content: space-between;
  gap: 8px 16px; flex-wrap: wrap;
}
/* The project block grows to take the freed width and lays its parts on ONE line — the
   folder name, then the version + counts inline beside it — so the header reads as a single
   summary row rather than a stacked name-over-meta block. min-width:0 lets a long folder
   name ellipsize instead of forcing overflow. */
.project {
  flex: 1 1 auto; min-width: 0;
  display: flex; flex-direction: row; align-items: baseline; gap: 12px;
}
.project-name {
  flex: 0 1 auto;
  font-weight: 600; font-size: 1.05em;
  color: var(--vscode-foreground);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.project-name.no-project {
  cursor: pointer; text-decoration: underline;
  color: var(--vscode-textLink-foreground);
}
.project-name.no-project:hover {
  color: var(--vscode-textLink-activeForeground);
}
/* The version + counts, inline on the project line. nowrap + overflow keeps it a single row
   beside the name; min-width:0 lets it shrink (clipping the trailing stats) before it pushes
   the search box off the bar. Each item is an icon + value. */
.project-meta {
  flex: 1 1 auto; min-width: 0;
  display: flex; flex-wrap: nowrap; align-items: baseline; gap: 4px 10px;
  overflow: hidden;
  color: var(--vscode-descriptionForeground); font-size: 0.85em;
}
.meta-item { display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; }
.meta-item .codicon { font-size: 13px; }
.meta-item.loading { color: var(--vscode-descriptionForeground); }
.meta-item.version { color: var(--vscode-foreground); }
/* Cap the search group's width: the Panel is very wide, and a wide input left the search bar
   stretched across the whole surface, crowding out the project summary. flex 0 1 keeps it a
   compact group (icon + input + count) on the trailing edge that may shrink but not grow past
   the cap. */
/* position:relative anchors the count badge, which is absolutely positioned INSIDE the
   input's trailing edge rather than sitting as a separate column beside it — the box owns
   its own count so the header reads tighter. */
.search { display: flex; align-items: center; gap: 6px; flex: 0 1 260px; max-width: 260px; position: relative; }
.search .codicon { color: var(--vscode-input-placeholderForeground); flex: none; }
#q {
  flex: 1;
  font-family: inherit; font-size: inherit;
  color: var(--vscode-input-foreground);
  background: var(--vscode-input-background);
  border: 1px solid var(--vscode-input-border, transparent);
  border-radius: 4px;
  /* Reserve trailing room so typed text never slides under the overlaid count badge. */
  padding: 4px 38px 4px 8px;
}
#q:focus { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
#q::placeholder { color: var(--vscode-input-placeholderForeground); }
/* The count badge floats over the input's right edge (count only — the unit lives in the
   placeholder/aria-label). pointer-events:none lets a click pass through to the input it
   overlays; :empty hides it before the first data message fills it. */
.count {
  position: absolute; right: 6px; top: 50%; transform: translateY(-50%);
  pointer-events: none;
  color: var(--vscode-badge-foreground); background: var(--vscode-badge-background);
  border-radius: 8px; padding: 0 6px;
  font-size: 0.78em; line-height: 1.6; white-space: nowrap;
}
.count:empty { display: none; }

/* Split layout: a left panel (category list, later step), the existing center content
   (#empty/#root, untouched below), and a right panel (run-history table, later step) —
   see PLAN_Launcher_Restructure.md. Both side panels are resizable (drag handle) and
   collapsible (toggled fully out of the flex row via .hidden), sharing one component
   (launcherScriptSplit.ts) rather than two different widgets. flex (not grid) so a
   collapsed panel truly takes zero width instead of retaining a grid track's minmax. */
.split { display: flex; align-items: stretch; gap: 10px; }
.center { flex: 1 1 auto; min-width: 0; }
.side-panel {
  flex: 0 0 auto;
  position: relative;
  min-width: 0;
  border: 1px solid var(--vscode-widget-border, var(--vscode-editorWidget-border, transparent));
  border-radius: 5px;
  background: var(--vscode-editorWidget-background, transparent);
  padding: 8px 10px;
}
.side-panel.hidden { display: none; }
.side-panel-body {
  color: var(--vscode-descriptionForeground);
  font-size: 0.85em;
  /* Scrolls independently of the drag handle below, which is absolutely positioned over
     the panel's own edge (see .split-rsz) — overflow here, not on .side-panel, keeps the
     handle's full width grabbable instead of being clipped to a sliver by the scroll box. */
  overflow: auto;
}
.left-panel { width: var(--launcher-left-w, ${LEFT_PANEL_LIMITS.defaultWidth}px); }
.right-panel { width: var(--launcher-right-w, ${RIGHT_PANEL_LIMITS.defaultWidth}px); }
/* The left panel's category list (PLAN_Launcher_Restructure.md build order step 3): a flat
   list of buttons, one per pane plus "All", each an icon + label + right-aligned count —
   the same row shape VS Code's own list views use, so it reads at home beside the rest of
   the editor chrome. */
.cat-list { display: flex; flex-direction: column; gap: 1px; }
.cat-item {
  display: flex; align-items: center; gap: 6px;
  width: 100%; text-align: left;
  background: none; border: none; font: inherit;
  color: var(--vscode-foreground);
  border-radius: 3px; padding: 3px 6px;
  cursor: pointer;
}
.cat-item:hover {
  background: var(--vscode-list-hoverBackground, transparent);
}
.cat-item:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
.cat-item.selected {
  background: var(--vscode-list-activeSelectionBackground, transparent);
  color: var(--vscode-list-activeSelectionForeground, inherit);
}
.cat-item .codicon { font-size: 14px; flex: none; }
.cat-label { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cat-count {
  flex: none;
  color: var(--vscode-badge-foreground); background: var(--vscode-badge-background);
  border-radius: 8px; padding: 0 6px; font-size: 0.85em; line-height: 1.6;
}
/* The right panel's run-history list (PLAN_Launcher_Restructure.md build order step 6): a
   flat list of rows, each a label + lifetime-count badge + a "Run again" icon button — the
   same row shape .cat-item above uses, so the two side panels read as one component family
   rather than two differently-styled widgets. */
.run-history-list { display: flex; flex-direction: column; gap: 1px; }
.run-history-item {
  display: flex; align-items: center; gap: 6px;
  padding: 3px 6px; border-radius: 3px;
}
.run-history-item:hover { background: var(--vscode-list-hoverBackground, transparent); }
.run-history-label { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.run-history-count {
  flex: none;
  color: var(--vscode-badge-foreground); background: var(--vscode-badge-background);
  border-radius: 8px; padding: 0 6px; font-size: 0.85em; line-height: 1.6;
}
.run-history-run {
  flex: none;
  display: flex; align-items: center; justify-content: center;
  width: 20px; height: 20px;
  background: none; border: none; border-radius: 3px;
  color: var(--vscode-foreground); cursor: pointer;
}
.run-history-run:hover { background: var(--vscode-toolbar-hoverBackground, transparent); }
.run-history-run:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
.run-history-empty {
  color: var(--vscode-descriptionForeground);
  padding: 4px 2px;
}
/* The drag handle: a thin strip over the panel's shared edge with the center content,
   matching Planner's .tb-rsz/.rsz handle pattern (src/views/plannerAssets.ts) — subtle
   until hovered/dragging, when a themed accent bar appears. z-index is below the sticky
   header's (3) so the handle never draws over it near the top of the panel. */
.split-rsz {
  position: absolute; top: 0; bottom: 0; width: 8px;
  cursor: col-resize; z-index: 2;
}
.split-rsz::after {
  content: ''; position: absolute; top: 0; bottom: 0; left: 3px; width: 2px;
  background: transparent; transition: background 0.12s ease;
}
.split-rsz:hover::after, .split-rsz.dragging::after { background: var(--vscode-focusBorder); }
.split-rsz-left { right: -5px; }
.split-rsz-right { left: -5px; }
/* Set on <body> for the duration of a drag (see launcherScriptSplit.ts's attachSplitResizer)
` + LAUNCHER_STYLE_CONTROLS;
