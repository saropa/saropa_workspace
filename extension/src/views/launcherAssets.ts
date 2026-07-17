// Inlined CSS for the "Saropa Launcher" Panel webview, kept in its own module so
// launcherView.ts stays the controller/host side. Injected under the view's per-load nonce;
// loads no remote resource (the one local resource is the codicon font, loaded host-side via
// asWebviewUri). All colors/spacing bind to --vscode-* theme variables so the surface matches
// the editor in light/dark/high-contrast. The client script (LAUNCHER_SCRIPT) lives in its
// own module (launcherScript.ts) so this file stays under the line cap.
//
// Header: a two-part bar (.head-bar) — the project block on the leading edge, the compact
// search group on the trailing edge. The project block reads as one line: the folder name,
// then the declared version + per-pane counts inline beside it. Each count is a filter chip
// (combining with the text search): a pane chip narrows the board to that pane, and the
// "scheduled" chip narrows it to the live scheduled shortcut cards wherever they sit — a
// cross-pane filter, not a pane, so it headlines what is actually automated.
// The name paints synchronously from the host's initial HTML; the version + counts arrive in
// the first data message (they need the disk scan) and are written by renderHeader.
//
// Layout (the design the launcher earns over a TreeView): the Panel is wide and short, so
// the surface splits into two responsive panes — "My shortcuts" (the user's own entries)
// on the left, "Recipes" (auto-detected, un-adopted) on the right — that sit side by side
// when wide and stack (mine first) when narrow, via a repeat(auto-fit, minmax) track. Each
// pane holds collapsible groups; each group holds a responsive card grid. Every card wears
// a tinted codicon matching its file type / action kind (the same token map the sidebar
// tree uses). A primary click EXPANDS a card's drawer (full name, path, description, and
// Open/Run buttons) rather than opening — browsing is non-destructive; the ▶ button still
// runs in one click. A right-click opens a flat, separator-grouped menu mirroring the
// sidebar's actions, routed to the same host commands by shortcut id.
//
// Search is client-side: the host posts the full item set once per change and the script
// filters live on every keystroke; while a query is active, collapsed panes and groups
// reveal their matches so a result is never hidden behind a folded section or folder. Both
// levels collapse independently — a whole pane (My shortcuts / Recipes / Watches / Project
// files) or a single inner group — and the posture persists across reloads via the webview's
// getState/setState.

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
/* The version is the headline fact (which release is this), so it reads in the regular
   foreground rather than the dimmed description color the counts use. */
.meta-item.version { color: var(--vscode-foreground); }
/* A stat that carries a pane is a filter toggle: clicking it shows only that pane's cards.
   It is a real <button>, so reset the native chrome to match the inline meta text, and give
   it a hover/active affordance so it reads as clickable. The active filter stays highlighted
   until toggled off. */
.meta-item.filter {
  background: none; border: none; font: inherit; color: inherit;
  cursor: pointer; border-radius: 3px; padding: 1px 5px;
}
.meta-item.filter:hover {
  background: var(--vscode-toolbar-hoverBackground, var(--vscode-list-hoverBackground));
  color: var(--vscode-foreground);
}
.meta-item.filter:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
.meta-item.filter.active {
  background: var(--vscode-toolbar-activeBackground, var(--vscode-list-activeSelectionBackground));
  color: var(--vscode-foreground);
}
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

/* Responsive panes via flex-wrap (not grid): side by side when the Panel is wide, wrapping
   to stacked (mine first) when narrow. flex is used over a grid track here precisely so a
   COLLAPSED pane can shed its width — a grid track keeps its minmax width even when its
   content folds, but a flex item can shrink to its header. align-items:flex-start so an
   empty/short pane does not stretch to its sibling's height. */
.panes {
  display: flex; flex-wrap: wrap;
  gap: 8px 14px;
  align-items: flex-start;
}
/* An expanded pane grows to share the row and holds a 340px comfortable floor. */
.pane { flex: 1 1 340px; min-width: 0; }
/* A collapsed pane (when not searching) shrinks to just its header, freeing the row for the
   remaining open sections — collapsing the section collapses its width too. During a search
   the body is force-revealed (see below), so the pane keeps its full width then. */
.root:not(.searching) .pane.collapsed { flex: 0 1 auto; }
.root:not(.searching) .pane.collapsed .pane-head { width: auto; }
.pane.hidden { display: none; }
/* The pane head doubles as the section's collapse toggle: a full-width button (chevron +
   title + count) over the pane body. A whole pane (My shortcuts / Recipes / Watches /
   Project files) can be folded away when a user wants only one section on screen, so the
   board scales down to just the sections in use. */
.pane-head {
  display: flex; align-items: center; gap: 7px;
  width: 100%;
  background: none; border: none; text-align: left;
  font-family: inherit;
  padding: 6px 2px 4px;
  border-bottom: 1px solid var(--vscode-widget-border, var(--vscode-editorWidget-border, transparent));
  margin-bottom: 4px;
  cursor: pointer;
}
.pane-head:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
.pane-chevron {
  flex: none; transition: transform 0.12s ease; font-size: 14px;
  color: var(--vscode-descriptionForeground);
}
.pane.collapsed .pane-chevron { transform: rotate(-90deg); }
/* Each section leads with its own glyph (the same token the matching header filter chip
   uses) so the four panes are identifiable at a glance even when collapsed to the header. */
.pane-glyph { flex: none; font-size: 14px; color: var(--vscode-foreground); }
.pane-title {
  font-size: 0.86em; font-weight: 600;
  text-transform: uppercase; letter-spacing: 0.05em;
  color: var(--vscode-foreground);
}
.pane-head:hover .pane-chevron { color: var(--vscode-foreground); }
.pane-count { color: var(--vscode-descriptionForeground); font-size: 0.8em; }
.pane.collapsed .pane-body { display: none; }
/* During a search, reveal a collapsed pane's body so matching cards are never hidden behind
   a folded section; the chevron keeps its collapsed pose so the persisted posture stays
   legible. Declared AFTER the collapsed rule so it wins at equal specificity. */
.root.searching .pane .pane-body { display: block; }

/* A collapsible group: a clickable header (chevron + tinted glyph + label + count) over a
   responsive card grid. The generous margin-top + header padding give each group's title
   room to breathe so the board does not read as one dense block of cards. */
.group { margin-top: 14px; }
.group.hidden { display: none; }
.group-head {
  display: flex; align-items: center; gap: 6px;
  width: 100%;
  background: none; border: none; text-align: left;
  color: var(--vscode-descriptionForeground);
  font-family: inherit; font-size: 0.8em;
  text-transform: uppercase; letter-spacing: 0.04em;
  padding: 7px 2px; cursor: pointer;
}
.group-head:hover { color: var(--vscode-foreground); }
.group-head:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
.group-chevron { flex: none; transition: transform 0.12s ease; font-size: 14px; }
.group.collapsed .group-chevron { transform: rotate(-90deg); }
.group-glyph { flex: none; font-size: 14px; }
.group-label { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.group-count {
  flex: none;
  color: var(--vscode-badge-foreground); background: var(--vscode-badge-background);
  border-radius: 8px; padding: 0 6px; font-size: 0.9em; letter-spacing: 0;
}
.group.collapsed .group-body { display: none; }
/* During a search, reveal a collapsed group's body so matching cards are never hidden
   behind a folded folder; the chevron stays in its collapsed pose so the persisted posture
   is still legible. */
.root.searching .group .group-body { display: grid; }

/* align-items:start so each card sizes to its own content height. Without it the
   grid stretches every card in a row to match the tallest, so expanding one card
   (its drawer opens) stretched all its row-mates to the same height. Now an
   expanded card grows downward alone and its neighbors keep their natural height. */
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(247px, 1fr));
  gap: 10px;
  align-items: start;
}
/* Indent the card grid so cards sit under the group label (past the chevron +
   glyph in the header), making the group-to-cards hierarchy read at a glance. */
.group-body { padding-left: 20px; }

/* A pane rendered flat (Watches always; Project files when only one area is present)
   has no inner collapsible group — its cards sit directly under the pane head, like the
   sidebar's flat lists. A little top margin keeps the first row off the pane-head divider
   so the board still breathes. */
.pane-flat { margin-top: 10px; }

.card {
  position: relative;
  display: flex; flex-direction: column;
  text-align: left;
  color: var(--vscode-foreground);
  background: var(--vscode-button-secondaryBackground, var(--vscode-editorWidget-background));
  border: 1px solid var(--vscode-widget-border, transparent);
  border-left: 3px solid var(--card-tint, var(--vscode-foreground));
  border-radius: 5px;
  padding: 8px 11px;
  cursor: pointer;
  min-width: 0;
}
.card:hover { background: var(--vscode-list-hoverBackground); }
.card.hidden { display: none; }
.card.expanded { background: var(--vscode-list-hoverBackground); }
.card-row { display: flex; align-items: center; gap: 6px; min-width: 0; }
.card-ic { flex: none; color: var(--card-tint, var(--vscode-foreground)); font-size: 15px; }
.card-body { display: flex; flex-direction: column; min-width: 0; flex: 1; }
.card-name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.card.expanded .card-name { white-space: normal; overflow: visible; }
.card-sub {
  color: var(--vscode-descriptionForeground);
  font-size: 0.82em;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.card.expanded .card-sub { white-space: normal; overflow: visible; word-break: break-all; }
/* The head's primary-action button (blue): Open for a file shortcut (a document leads
   with Open), Run for a non-file action. Icon-only in the compact grid via gap+hidden
   label; the label appears only once the card expands, so the head stays narrow among its
   row-mates but names its action when opened. */
.run {
  flex: none;
  display: inline-flex; align-items: center; justify-content: center; gap: 5px;
  /* Same type as the drawer's .btn buttons: without these, a native <button> keeps the
     UA's own font at 1em, so the head Run/Open label rendered larger than the drawer's
     Open/Copy-path labels on the same card. The size lives in --launcher-btn-font. */
  font-family: inherit; font-size: var(--launcher-btn-font);
  color: var(--vscode-button-foreground);
  background: var(--vscode-button-background);
  border: none; border-radius: 4px; padding: 2px 7px; cursor: pointer;
}
.run:hover { background: var(--vscode-button-hoverBackground); }
/* Once the card expands and the head button shows its text label, it sits directly above
   the drawer's .btn row — so it adopts the same --launcher-btn-pad box instead of the
   compact icon-only padding, keeping the two button styles visually identical. */
.card.expanded .run { padding: var(--launcher-btn-pad); }
.run .codicon { font-size: 13px; }
/* Label hidden while collapsed (icon-only), revealed when the card expands. The head button
   stays visible in both states; the drawer omits whichever action the head already carries
   (see makeCard), so a card never shows a duplicate Open or Run. */
.run-label { display: none; }
.card.expanded .run-label { display: inline; }

/* The expand drawer: revealed under the card head on a primary click. */
.drawer { display: none; margin-top: 9px; padding-top: 2px; }
.card.expanded .drawer { display: block; }
.drawer-desc {
  color: var(--vscode-foreground);
  font-size: 0.97em; margin: 2px 0 10px; line-height: 1.45;
}
/* Right-align the drawer actions so Open/Run sit at the card's trailing edge,
   away from the leading name/path column. */
.drawer-actions { display: flex; gap: 6px; flex-wrap: wrap; justify-content: flex-end; }
.btn {
  display: inline-flex; align-items: center; gap: 5px;
  font-family: inherit; font-size: var(--launcher-btn-font);
  color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
  background: var(--vscode-button-secondaryBackground, var(--vscode-editorWidget-background));
  border: 1px solid var(--vscode-widget-border, transparent);
  /* Box shared with the expanded head button via --launcher-btn-pad; the optical
     rationale for its 1px top bias lives on the :root definition. */
  border-radius: 4px; padding: var(--launcher-btn-pad); cursor: pointer;
}
.btn:hover { background: var(--vscode-list-hoverBackground); }
.btn.primary {
  color: var(--vscode-button-foreground);
  background: var(--vscode-button-background); border-color: transparent;
}
.btn.primary:hover { background: var(--vscode-button-hoverBackground); }

/* The right-click menu: a flat, separator-grouped list mirroring the sidebar's actions. */
.menu {
  position: fixed; z-index: 20;
  min-width: 190px; max-width: 280px;
  padding: 4px 0;
  background: var(--vscode-menu-background, var(--vscode-editorWidget-background));
  color: var(--vscode-menu-foreground, var(--vscode-foreground));
  border: 1px solid var(--vscode-menu-border, var(--vscode-widget-border, transparent));
  border-radius: 5px;
  box-shadow: 0 2px 8px var(--vscode-widget-shadow, transparent);
}
.menu-item {
  display: flex; align-items: center; gap: 8px;
  width: 100%; text-align: left;
  background: none; border: none;
  font-family: inherit; font-size: inherit;
  color: inherit;
  padding: 4px 12px; cursor: pointer;
}
.menu-item:hover, .menu-item:focus-visible {
  background: var(--vscode-menu-selectionBackground, var(--vscode-list-activeSelectionBackground));
  color: var(--vscode-menu-selectionForeground, var(--vscode-list-activeSelectionForeground));
  outline: none;
}
.menu-item .codicon { flex: none; font-size: 14px; }
.menu-item.danger { color: var(--vscode-errorForeground); }
.menu-sep {
  height: 1px; margin: 4px 0;
  background: var(--vscode-menu-separatorBackground, var(--vscode-widget-border, transparent));
}

.empty { color: var(--vscode-descriptionForeground); padding: 16px 4px; }
.empty.hidden { display: none; }
`;
