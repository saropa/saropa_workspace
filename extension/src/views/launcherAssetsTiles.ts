// Tile-view part of the launcher stylesheet, concatenated last by launcherAssets.ts. Every
// rule is scoped to body.tiles, so the row view is untouched; the cards' DOM is the same in
// both views (see launcher/launcherScriptTiles.ts). --tile-tint is set per card by makeCard.
//
// The base rules are the large tile. body.tiles-small and body.tiles-medium override them,
// mostly for collapsed cards only (:not(.expanded)), so an open tile of any size reads the
// same: icon, name, subtitle and labeled buttons.

/** Styles that lay the launcher cards out as colored square tiles. */
export const LAUNCHER_STYLE_TILES = `
/* Fixed-width tracks keep the tiles square at any panel width; the row wraps instead of
   stretching them. The track shrinks only when the grid is narrower than one tile. The grid
   is a size container so the expanded rule below can ask how wide it is. */
body.tiles .grid {
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 128px), 128px));
  container-type: inline-size;
}
body.tiles .card {
  justify-content: center;
  text-align: center;
  padding: 10px 8px;
  border: 2px solid var(--tile-tint, var(--vscode-foreground));
  border-radius: 8px;
}
/* Square only while collapsed: an open drawer needs the height. */
body.tiles .card:not(.expanded) { aspect-ratio: 1 / 1; }
/* An open tile takes the whole row: that cannot overflow at any width, and it is what an
   engine without container queries keeps. */
body.tiles .card.expanded { grid-column: 1 / -1; }
/* Two tracks are enough for the drawer, but only where two exist (two 128px tracks plus the
   10px gap): spanning 2 in a one-track grid would overflow the panel. */
@container (min-width: 266px) {
  body.tiles .card.expanded { grid-column: span 2; }
}
/* Guarded because a var() inside an unsupported color-mix() computes to no background at
   all; without support the row view's backgrounds stay and the tint is layered below. */
@supports (color: color-mix(in srgb, currentColor, transparent)) {
  body.tiles .card {
    background: color-mix(in srgb, var(--tile-tint, var(--vscode-foreground)) 12%, transparent);
  }
  body.tiles .card:hover,
  body.tiles .card.expanded {
    background: color-mix(in srgb, var(--tile-tint, var(--vscode-foreground)) 22%, transparent);
  }
}
/* The same tint for an engine without color-mix(): a faded layer of the color behind the
   card's content. isolation keeps z-index -1 above the card's own background. */
@supports not (color: color-mix(in srgb, currentColor, transparent)) {
  body.tiles .card { isolation: isolate; }
  body.tiles .card::before {
    content: ''; position: absolute; inset: 0; z-index: -1;
    border-radius: 6px; pointer-events: none;
    background: var(--tile-tint, var(--vscode-foreground)); opacity: 0.12;
  }
  body.tiles .card:hover::before,
  body.tiles .card.expanded::before { opacity: 0.22; }
  /* The drop background must not be washed over by the tint. */
  body.tiles .card.drop-over::before { content: none; }
}
/* The row view's drop indicator is a top border; thicker here so it shows over the tile's own.
   The background is repeated because the tint rules above outrank .card.drop-over. */
body.tiles .card.drop-over {
  border-top: 5px solid var(--vscode-focusBorder);
  margin-top: -3px;
  background: var(--vscode-list-dropBackground, var(--vscode-list-hoverBackground, transparent));
}
body.tiles .card-row { flex-direction: column; gap: 4px; }
body.tiles .card-ic { font-size: 32px; color: var(--tile-tint, var(--vscode-foreground)); }
/* Stretched to the tile's width so the name and subtitle ellipsize inside it. */
body.tiles .card-body { flex: none; align-self: stretch; }
body.tiles .card-name { font-weight: 600; }
/* An open tile unclips its text, and a long file name or path has no space to wrap at. */
body.tiles .card.expanded .card-name,
body.tiles .drawer-desc { overflow-wrap: anywhere; }
body.tiles .drawer-actions { justify-content: center; }
/* A narrow grid can hold a single small track, and an open tile is only as wide as the
   tracks: the buttons and their labels shrink and wrap rather than spill out. */
body.tiles .card.expanded .run,
body.tiles .drawer-actions .btn { max-width: 100%; flex-wrap: wrap; justify-content: center; overflow-wrap: anywhere; }

/* Smaller tracks for the two compact sizes. */
body.tiles.tiles-medium .grid { grid-template-columns: repeat(auto-fill, minmax(min(100%, 96px), 96px)); }
body.tiles.tiles-small .grid { grid-template-columns: repeat(auto-fill, minmax(min(100%, 64px), 64px)); }
/* Two of these narrower tracks are too tight for the drawer, so an open tile keeps the whole
   row. The extra class outranks the container query's two-track span above. */
body.tiles.tiles-medium .card.expanded,
body.tiles.tiles-small .card.expanded { grid-column: 1 / -1; }
/* A row of one fixed track is still only one tile wide, so the open tile also takes the
   grid's own width (the grid is the size container). An engine without cqw skips this. */
body.tiles.tiles-medium .card.expanded,
body.tiles.tiles-small .card.expanded { width: 100cqw; }

body.tiles.tiles-medium .card:not(.expanded),
body.tiles.tiles-small .card:not(.expanded) { padding: 4px; }
body.tiles.tiles-medium .card:not(.expanded) .card-ic { font-size: 24px; }
body.tiles.tiles-small .card:not(.expanded) .card-ic { font-size: 28px; }
/* Hidden from sight but not display:none, so the toggle keeps its accessible name. */
body.tiles.tiles-medium .card:not(.expanded) .card-sub,
body.tiles.tiles-small .card:not(.expanded) .card-name,
body.tiles.tiles-small .card:not(.expanded) .card-sub {
  position: absolute; width: 1px; height: 1px; overflow: hidden;
  clip-path: inset(50%); white-space: nowrap;
}
/* With its text hidden the toggle would have no area, so it covers the whole small tile: it
   stays clickable, shows the tooltip anywhere, and its focus ring frames the tile. */
body.tiles.tiles-small .card:not(.expanded) .card-body { position: absolute; inset: 0; }
body.tiles.tiles-small .card:not(.expanded) .card-body:focus-visible { outline-width: 2px; }
/* Run/Open sits in the corner above that overlay, and shows only on hover or focus so the
   resting tile is the icon alone. Opacity, not display, keeps it in the Tab order. */
body.tiles.tiles-small .card:not(.expanded) .run {
  position: absolute; right: 1px; bottom: 1px; z-index: 1; padding: 1px 2px; opacity: 0;
}
body.tiles.tiles-small .card:not(.expanded):hover .run,
body.tiles.tiles-small .card:not(.expanded):focus-within .run { opacity: 1; }
`;
