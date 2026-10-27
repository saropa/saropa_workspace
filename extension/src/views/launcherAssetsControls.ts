// Second half of the launcher stylesheet (resizer, drawers, menus and controls).
// Split out of launcherAssets.ts, which concatenates it onto LAUNCHER_STYLE.

export const LAUNCHER_STYLE_CONTROLS = `   so the resize cursor and disabled text-selection apply everywhere the pointer travels,
   not just while it stays over the 8px handle strip. */
body.resizing { cursor: col-resize; user-select: none; }

/* Responsive panes via flex-wrap (not grid): side by side when the Panel is wide, wrapping
   to stacked (mine first) when narrow. align-items:flex-start so an empty/short pane does
   not stretch to its sibling's height. */
.panes {
  display: flex; flex-wrap: wrap;
  gap: 8px 14px;
  align-items: flex-start;
}
.pane { flex: 1 1 340px; min-width: 0; }
.pane.hidden { display: none; }
/* The pane head is a clickable section label (glyph + title + count). Clicking it cycles
   that pane's sort mode (Grouped → A-Z → Z-A) — see makePaneHead(), launcherScriptFolded.ts.
   A pane's own visibility (shown/hidden) is decided by the left panel's category selection,
   not by anything on the pane head itself. */
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
.pane-glyph { flex: none; font-size: 14px; color: var(--vscode-foreground); }
.pane-title {
  font-size: 0.86em; font-weight: 600;
  text-transform: uppercase; letter-spacing: 0.05em;
  color: var(--vscode-foreground);
}
.pane-count { color: var(--vscode-descriptionForeground); font-size: 0.8em; }
.pane-sort { flex: none; font-size: 12px; margin-left: auto; color: var(--vscode-descriptionForeground); }
.pane-sort-label { font-size: 0.75em; color: var(--vscode-descriptionForeground); }
.pane-head:hover .pane-sort,
.pane-head:hover .pane-sort-label { color: var(--vscode-foreground); }

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
/* Drop affordances for cards dragged between groups within a pane. Mirrors the folded
   strip's can-drop / drop-over pattern: can-drop lights every eligible group from drag
   start; drop-over marks the one under the pointer. */
.group.can-drop .group-head { box-shadow: inset 0 0 0 1px var(--vscode-focusBorder); border-radius: 4px; }
.group.drop-over .group-head {
  box-shadow: inset 0 0 0 1px var(--vscode-focusBorder);
  background: var(--vscode-list-dropBackground, var(--vscode-list-hoverBackground, transparent));
  border-radius: 4px;
}
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
  background: var(--vscode-button-secondaryBackground, var(--vscode-editorWidget-background, transparent));
  border: 1px solid var(--vscode-widget-border, transparent);
  border-left: 3px solid var(--card-tint, var(--vscode-foreground));
  border-radius: 5px;
  padding: 8px 11px;
  cursor: pointer;
  min-width: 0;
}
.card:hover { background: var(--vscode-list-hoverBackground); }
.card.hidden { display: none; }
/* Drop-to-reorder: the hovered card shows a top-border insertion indicator and the drop
   background. Only the card under the pointer highlights — can-drop is not visualized on
   cards (unlike groups) because highlighting every eligible card is too noisy. */
.card.drop-over {
  border-top: 2px solid var(--vscode-focusBorder); margin-top: -1px;
  background: var(--vscode-list-dropBackground, var(--vscode-list-hoverBackground, transparent));
}
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
   the drawer's .btn row — so it adopts the drawer's FULL box, not just the padding: the
   transparent 1px border matches .btn's border thickness (without it the head rendered 2px
   shorter than a drawer button despite identical padding), and the icon grows to the
   drawer's codicon size so the two button styles are pixel-identical. */
.card.expanded .run { padding: var(--launcher-btn-pad); border: 1px solid transparent; }
.card.expanded .run .codicon { font-size: var(--launcher-btn-icon); }
/* Compact icon size for the collapsed icon-only grid (the expanded override above wins
   once the card opens); single-use, so deliberately a literal, like .run's own 2px 7px
   collapsed padding. */
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
  color: var(--vscode-button-secondaryForeground, var(--vscode-foreground, inherit));
  background: var(--vscode-button-secondaryBackground, var(--vscode-editorWidget-background, transparent));
  border: 1px solid var(--vscode-widget-border, transparent);
  /* Box shared with the expanded head button via --launcher-btn-pad; the optical
     rationale for its 1px top bias lives on the :root definition. */
  border-radius: 4px; padding: var(--launcher-btn-pad); cursor: pointer;
}
.btn:hover { background: var(--vscode-list-hoverBackground); }
/* Pin the drawer icons to the shared variable instead of the codicon font's default, so
   the expanded head button and the drawer provably render the same icon size. */
.btn .codicon { font-size: var(--launcher-btn-icon); }
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
  background: var(--vscode-menu-background, var(--vscode-editorWidget-background, transparent));
  color: var(--vscode-menu-foreground, var(--vscode-foreground, inherit));
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
  background: var(--vscode-menu-selectionBackground, var(--vscode-list-activeSelectionBackground, transparent));
  color: var(--vscode-menu-selectionForeground, var(--vscode-list-activeSelectionForeground, inherit));
  outline: none;
}
.menu-item .codicon { flex: none; font-size: 14px; }
.menu-item.has-sub { justify-content: flex-start; }
.menu-item .menu-arrow {
  margin-left: auto;
  width: 0; height: 0;
  border: 4px solid transparent;
  border-left-color: currentColor;
}
.menu-item.danger { color: var(--vscode-errorForeground); }
.menu-sub { position: fixed; z-index: 21; }
.menu-sep {
  height: 1px; margin: 4px 0;
  background: var(--vscode-menu-separatorBackground, var(--vscode-widget-border, transparent));
}

.empty { color: var(--vscode-descriptionForeground); padding: 16px 4px; }
.empty.hidden { display: none; }
`;
