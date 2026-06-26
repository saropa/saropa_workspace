// Inlined CSS + client script for the Schedule & Workflow Planner webview (kept in
// its own module so plannerPanel.ts stays the logic/host side, matching the
// split-asset layout the Saropa design system uses elsewhere). Both are injected
// under the panel's per-load nonce; neither loads a remote or bundled resource.
//
// The visual language is the shared Saropa dashboard chrome: a token :root, the
// hero band with a soft radial brand tint, segmented tab control, pill buttons,
// SVG draw-in animation, focus-visible rings, and a prefers-reduced-motion guard.
// Everything binds to --vscode-* theme variables so it matches the editor in
// light / dark / high-contrast; the only fixed colors are the Saropa brand orange.

export const PLANNER_STYLE = `
:root {
  color-scheme: light dark;
  --surface-1: var(--vscode-editor-background);
  --surface-2: var(--vscode-editorWidget-background, var(--vscode-editor-background));
  --surface-3: var(--vscode-editor-inactiveSelectionBackground, rgba(127,127,127,.10));
  --inset: var(--vscode-input-background);
  --border: var(--vscode-widget-border, var(--vscode-panel-border, rgba(127,127,127,.28)));
  --border-strong: color-mix(in srgb, var(--vscode-focusBorder) 35%, var(--border));
  --muted: var(--vscode-descriptionForeground);
  --link: var(--vscode-textLink-foreground);
  --brand: #f97316;
  --brand-2: #ea580c;
  --brand-glow: rgba(249,115,22,.20);
  --hero-tint: color-mix(in srgb, var(--brand) 16%, transparent);
  --ok: var(--vscode-testing-iconPassed, var(--vscode-charts-green, #3fb950));
  --bad: var(--vscode-editorError-foreground, #f85149);
  --space-1: 4px; --space-2: 8px; --space-3: 12px; --space-4: 16px;
  --radius-sm: 4px; --radius: 8px; --radius-lg: 12px; --radius-pill: 999px;
  --ease: cubic-bezier(.2,.6,.2,1);
  --dur: 160ms;
  --hour-h: 30px;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  padding: 14px 16px 28px;
  font-family: var(--vscode-font-family);
  font-size: 13px;
  line-height: 1.45;
  color: var(--vscode-foreground);
  background: var(--surface-1);
}
h1, h2, h3 { margin: 0; font-weight: 600; }

/* Hero ------------------------------------------------------------------ */
.hero {
  position: relative;
  display: flex; align-items: center; gap: 14px;
  padding: 14px 18px; margin-bottom: 12px;
  border: 1px solid var(--border-strong); border-radius: var(--radius-lg);
  background:
    radial-gradient(680px 200px at 0% 0%, var(--hero-tint), transparent 60%),
    var(--surface-2);
  animation: rise 320ms var(--ease);
}
.hero .glyph {
  width: 38px; height: 38px; flex: 0 0 auto;
  display: grid; place-items: center;
  border-radius: 10px; font-size: 20px;
  background: color-mix(in srgb, var(--brand) 18%, transparent);
  color: var(--brand);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--brand) 30%, transparent) inset;
}
.hero h1 { font-size: 1.45em; letter-spacing: .2px; }
.hero .sub { color: var(--muted); font-size: .92em; margin-top: 2px; }
.hero .spacer { flex: 1; }

/* Tab strip (segmented) ------------------------------------------------- */
.tabs {
  display: inline-flex; gap: 2px; padding: 3px;
  border: 1px solid var(--border); border-radius: var(--radius-pill);
  background: var(--surface-3);
}
.tab {
  border: 1px solid transparent; border-radius: var(--radius-pill);
  padding: 5px 14px; font: inherit; font-size: .92em;
  color: var(--muted); background: transparent; cursor: pointer;
  display: inline-flex; align-items: center; gap: 6px;
  transition: color var(--dur), background var(--dur);
}
.tab:hover { color: var(--vscode-foreground); }
.tab[aria-selected="true"] {
  color: var(--vscode-button-foreground);
  background: var(--brand);
  font-weight: 600;
}
.tab:focus-visible { outline: 2px solid var(--vscode-focusBorder); outline-offset: 1px; }

/* Buttons --------------------------------------------------------------- */
button.btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 5px 12px; border-radius: var(--radius-pill);
  border: 1px solid var(--vscode-button-border, var(--border));
  background: var(--vscode-button-secondaryBackground, var(--surface-3));
  color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
  cursor: pointer; font: inherit; font-size: .92em;
  transition: background var(--dur), border-color var(--dur);
}
button.btn:hover { background: var(--vscode-button-secondaryHoverBackground, var(--surface-3)); border-color: var(--border-strong); }
button.btn.primary { background: var(--brand); color: #fff; border-color: transparent; font-weight: 600; }
button.btn.primary:hover { background: var(--brand-2); }
button.btn:focus-visible { outline: 2px solid var(--vscode-focusBorder); outline-offset: 2px; }
button.btn.icon { padding: 5px 8px; }

/* Toolbar --------------------------------------------------------------- */
.toolbar {
  position: sticky; top: 0; z-index: 30;
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  padding: 8px 0 12px; background: var(--surface-1);
}
.toolbar .spacer { flex: 1; }
.legend { display: flex; gap: 12px; flex-wrap: wrap; color: var(--muted); font-size: .85em; }
.legend .dot { display: inline-flex; align-items: center; gap: 5px; }
.legend .sw { width: 10px; height: 10px; border-radius: 3px; display: inline-block; }

/* Stage ----------------------------------------------------------------- */
/* The work area is two columns: the timeline/graph stage (flexes to fill) and the
   detail inspector docked on the right. The inspector only occupies a column while a
   pin is selected — when hidden it collapses to zero width and the stage spans full. */
.workarea { display: flex; align-items: flex-start; gap: 12px; }
.stage { flex: 1 1 auto; min-width: 0; animation: fade 200ms var(--ease); }
.empty {
  display: flex; flex-direction: column; align-items: center; gap: 8px;
  padding: 48px 16px; margin: 12px 0; text-align: center;
  border: 1px dashed var(--border); border-radius: var(--radius);
  background: var(--surface-2); color: var(--muted);
}
.empty .big { font-size: 1.1em; color: var(--vscode-foreground); font-weight: 600; }

/* Day timeline ---------------------------------------------------------- */
.day-wrap { border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface-2); padding: 14px 16px; }
.ruler { position: relative; height: 64px; margin: 28px 8px 10px; border-bottom: 1px solid var(--border); }
.ruler .hour { position: absolute; bottom: 0; width: 0; border-left: 1px solid var(--border); height: 8px; }
.ruler .hour.major { height: 14px; border-left-color: var(--border-strong); }
.ruler .hlabel { position: absolute; bottom: 16px; transform: translateX(-50%); font-size: .72em; color: var(--muted); font-variant-numeric: tabular-nums; }
.ruler .now { position: absolute; top: -24px; bottom: 0; width: 2px; background: var(--brand); box-shadow: 0 0 6px var(--brand-glow); }
.ruler .now::after { content: 'now'; position: absolute; top: -16px; left: 50%; transform: translateX(-50%); font-size: .68em; color: var(--brand); font-weight: 600; }
.marker {
  position: absolute; bottom: 100%; transform: translateX(-50%);
  display: flex; flex-direction: column; align-items: center; cursor: pointer;
}
.marker .pin-dot { width: 11px; height: 11px; border-radius: 50%; background: var(--brand); box-shadow: 0 0 0 3px color-mix(in srgb, var(--brand) 22%, transparent); animation: pop 360ms var(--ease) backwards; }
.marker .pin-dot.off { background: var(--muted); box-shadow: 0 0 0 3px color-mix(in srgb, var(--muted) 20%, transparent); }
.marker .tag {
  margin-bottom: 4px; max-width: 130px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-size: .78em; padding: 1px 7px; border-radius: var(--radius-pill);
  background: var(--surface-3); border: 1px solid var(--border);
}
.marker:hover .tag { border-color: var(--brand); }
.marker.sel .tag { border-color: var(--brand); background: color-mix(in srgb, var(--brand) 16%, var(--surface-3)); }
.interval-list { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 18px; }
.interval-chip {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 4px 10px; border-radius: var(--radius-pill);
  background: var(--surface-3); border: 1px solid var(--border); font-size: .85em; cursor: pointer;
}
.interval-chip:hover { border-color: var(--brand); }
.interval-chip .cad { color: var(--brand); font-variant-numeric: tabular-nums; }
.section-title { display: flex; align-items: center; gap: 8px; margin: 18px 4px 8px; color: var(--muted); font-size: .82em; text-transform: uppercase; letter-spacing: .6px; font-weight: 600; }

/* Week grid ------------------------------------------------------------- */
.week {
  display: grid; grid-template-columns: 48px repeat(7, 1fr); gap: 0;
  border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; background: var(--surface-2);
}
.week .corner, .week .col-head { position: sticky; top: 46px; z-index: 10; background: var(--surface-3); border-bottom: 1px solid var(--border); }
.week .col-head { padding: 7px 6px; text-align: center; font-size: .82em; font-weight: 600; }
.week .col-head .dow { display: block; }
.week .col-head.today { color: var(--brand); }
.week .col-head .count { display: block; font-size: .8em; color: var(--muted); font-weight: 400; }
.week .gutter { position: relative; border-right: 1px solid var(--border); }
.week .ghour { height: var(--hour-h); position: relative; }
.week .ghour .lab { position: absolute; top: -7px; right: 5px; font-size: .68em; color: var(--muted); font-variant-numeric: tabular-nums; }
.week .daycol { position: relative; border-right: 1px solid var(--border); background-image: repeating-linear-gradient(to bottom, transparent, transparent calc(var(--hour-h) - 1px), var(--border) calc(var(--hour-h) - 1px), var(--border) var(--hour-h)); }
.week .daycol:last-child { border-right: 0; }
.week .daycol.today { background-color: color-mix(in srgb, var(--brand) 5%, transparent); }
.week .nowline { position: absolute; left: 0; right: 0; height: 2px; background: var(--brand); z-index: 6; box-shadow: 0 0 5px var(--brand-glow); }
.block {
  position: absolute; left: 4px; right: 4px; min-height: 20px;
  border-radius: var(--radius-sm); padding: 2px 6px; cursor: grab;
  background: color-mix(in srgb, var(--brand) 22%, var(--surface-2));
  border: 1px solid color-mix(in srgb, var(--brand) 50%, transparent);
  color: var(--vscode-foreground); font-size: .76em; overflow: hidden;
  box-shadow: 0 1px 2px rgba(0,0,0,.18); z-index: 7;
  transition: box-shadow var(--dur), transform var(--dur);
  animation: pop 280ms var(--ease) backwards;
}
.block:hover { box-shadow: 0 3px 10px rgba(0,0,0,.28); z-index: 9; }
.block.sel { border-color: var(--brand); box-shadow: 0 0 0 2px var(--brand-glow), 0 3px 10px rgba(0,0,0,.32); z-index: 12; }
.block.off { background: var(--surface-3); border-color: var(--border); opacity: .8; }
.block.dragging { opacity: .85; cursor: grabbing; box-shadow: 0 8px 22px rgba(0,0,0,.4); z-index: 20; }
.block .bt { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.block .bm { color: var(--muted); font-variant-numeric: tabular-nums; }

/* Workflow canvas ------------------------------------------------------- */
.wf { display: grid; grid-template-columns: 168px 1fr; gap: 12px; }
.toolbox { border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface-2); padding: 10px; align-self: start; position: sticky; top: 46px; }
.toolbox h3 { font-size: .78em; text-transform: uppercase; letter-spacing: .6px; color: var(--muted); margin-bottom: 8px; }
.tool {
  display: flex; align-items: center; gap: 8px; padding: 7px 9px; margin-bottom: 7px;
  border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface-3);
  cursor: grab; font-size: .86em; transition: border-color var(--dur), transform var(--dur);
}
.tool:hover { border-color: var(--brand); transform: translateX(2px); }
.tool:active { cursor: grabbing; }
.tool .ti { width: 22px; height: 22px; border-radius: 6px; display: grid; place-items: center; flex: 0 0 auto; background: color-mix(in srgb, var(--brand) 16%, transparent); color: var(--brand); font-size: 13px; }
.toolbox .hint { font-size: .76em; color: var(--muted); margin-top: 8px; line-height: 1.4; }

/* Workflow right column: how-to band, canvas, unlinked-pin shelf ---------- */
.wf-right { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.wf-howto {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  padding: 8px 12px; border: 1px solid var(--border); border-radius: var(--radius);
  background: var(--surface-2); color: var(--muted); font-size: .82em;
}
.wf-howto .steps { display: flex; flex-wrap: wrap; gap: 4px 10px; }
.wf-howto .steps b { color: var(--vscode-foreground); font-weight: 600; }
.wf-howto .spacer { flex: 1; min-width: 8px; }

.shelf { border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface-2); }
.shelf-head { display: flex; align-items: center; gap: 8px; padding: 8px 12px; cursor: pointer; user-select: none; }
.shelf-head .chev { color: var(--muted); transition: transform var(--dur); font-size: .9em; }
.shelf.collapsed .shelf-head .chev { transform: rotate(-90deg); }
.shelf-head .sh-t { font-size: .8em; text-transform: uppercase; letter-spacing: .6px; color: var(--muted); font-weight: 600; }
.shelf-head .sh-c { font-size: .78em; color: var(--brand); background: color-mix(in srgb, var(--brand) 14%, transparent); border-radius: var(--radius-pill); padding: 0 8px; font-variant-numeric: tabular-nums; }
.shelf-head .sh-hint { margin-left: auto; font-size: .78em; color: var(--muted); }
.shelf-filter-row { padding: 0 12px 8px; }
.shelf.collapsed .shelf-filter-row { display: none; }
.shelf-filter {
  width: 100%; padding: 6px 11px; font: inherit; font-size: .86em;
  border: 1px solid var(--border); border-radius: var(--radius-sm);
  background: var(--inset); color: var(--vscode-input-foreground); outline: none;
}
.shelf-filter:focus { border-color: var(--brand); }
.shelf-grid { display: flex; flex-wrap: wrap; gap: 8px; padding: 2px 12px 12px; max-height: 220px; overflow-y: auto; }
.shelf.collapsed .shelf-grid { display: none; }
.shelf.collapsed .shelf-empty { display: none; }
.shelf-empty { padding: 8px 0; color: var(--muted); font-size: .85em; }
.shelf-pin {
  display: inline-flex; align-items: center; gap: 7px; max-width: 230px;
  padding: 6px 11px; border: 1px solid var(--border); border-radius: var(--radius-pill);
  background: var(--surface-3); cursor: grab; font-size: .84em;
  transition: border-color var(--dur), transform var(--dur), box-shadow var(--dur);
}
.shelf-pin:hover { border-color: var(--brand); transform: translateY(-1px); }
.shelf-pin:active { cursor: grabbing; }
.shelf-pin.sel { border-color: var(--brand); box-shadow: 0 0 0 2px var(--brand-glow); }
.shelf-pin .si { width: 18px; height: 18px; border-radius: 5px; display: grid; place-items: center; flex: 0 0 auto; background: var(--surface-1); font-size: 11px; }
.shelf-pin .sl { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.shelf-pin .sclock { color: var(--brand); flex: 0 0 auto; font-size: .9em; }

.canvas-wrap { position: relative; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface-2); overflow: hidden; }
.canvas-wrap.droptarget { border-color: var(--brand); box-shadow: 0 0 0 1px var(--brand) inset; }
.canvas { position: relative; width: 100%; height: 560px; overflow: auto; }
.canvas .edges { position: absolute; inset: 0; pointer-events: none; width: 100%; height: 100%; }
.canvas .edges path { fill: none; stroke: var(--border-strong); stroke-width: 2; marker-end: url(#arrow); transition: stroke var(--dur); }
.canvas .edges path.hot { stroke: var(--brand); }
.canvas .edges path.event { stroke-dasharray: 5 4; }
.node {
  position: absolute; min-width: 116px; max-width: 190px;
  border: 1px solid var(--border-strong); border-radius: 10px; padding: 8px 10px;
  background: var(--surface-1); box-shadow: 0 2px 6px rgba(0,0,0,.18);
  cursor: grab; user-select: none; z-index: 4;
  transition: box-shadow var(--dur), border-color var(--dur);
  animation: pop 240ms var(--ease) backwards;
}
.node:hover { border-color: var(--brand); box-shadow: 0 4px 14px rgba(0,0,0,.28); }
.node.sel { border-color: var(--brand); box-shadow: 0 0 0 2px var(--brand-glow), 0 4px 14px rgba(0,0,0,.3); z-index: 8; }
.node.dragging { cursor: grabbing; z-index: 20; }
.node.event { background: color-mix(in srgb, var(--brand) 10%, var(--surface-1)); border-style: dashed; }
.node.linktarget { border-color: var(--ok); box-shadow: 0 0 0 2px color-mix(in srgb, var(--ok) 35%, transparent); }
.node .nh { display: flex; align-items: center; gap: 7px; }
.node .nicon { width: 20px; height: 20px; border-radius: 6px; display: grid; place-items: center; flex: 0 0 auto; font-size: 12px; background: var(--surface-3); }
.node.event .nicon { background: color-mix(in srgb, var(--brand) 20%, transparent); color: var(--brand); }
.node .nt { font-weight: 600; font-size: .86em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.node .nmeta { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
.node .badge { font-size: .72em; padding: 0 6px; border-radius: var(--radius-pill); background: var(--surface-3); color: var(--muted); display: inline-flex; align-items: center; gap: 3px; }
.node .badge.sched { color: var(--brand); background: color-mix(in srgb, var(--brand) 14%, transparent); }
.node .badge.emit { color: var(--ok); background: color-mix(in srgb, var(--ok) 14%, transparent); }
.node .badge.run { color: var(--ok); }
.node .badge.fail { color: var(--bad); }
.node .plug {
  position: absolute; right: -8px; top: 50%; transform: translateY(-50%);
  width: 16px; height: 16px; border-radius: 50%; cursor: crosshair;
  background: var(--brand); border: 2px solid var(--surface-1); opacity: 0; z-index: 9;
  transition: opacity var(--dur);
}
.node:hover .plug, .node.sel .plug { opacity: 1; }
.node .plug:hover { transform: translateY(-50%) scale(1.25); }
.linkline { position: absolute; inset: 0; pointer-events: none; z-index: 19; width: 100%; height: 100%; }
.linkline path { fill: none; stroke: var(--brand); stroke-width: 2.5; stroke-dasharray: 6 4; }

/* Context menu + autocomplete ------------------------------------------- */
.menu {
  position: fixed; z-index: 200; min-width: 200px; padding: 5px;
  background: var(--vscode-editorWidget-background, var(--surface-2));
  border: 1px solid var(--border-strong); border-radius: var(--radius);
  box-shadow: 0 8px 26px rgba(0,0,0,.34); animation: rise 120ms var(--ease);
}
.menu .mi {
  display: flex; align-items: center; gap: 8px; width: 100%;
  padding: 6px 10px; border: 0; border-radius: var(--radius-sm);
  background: transparent; color: var(--vscode-foreground); cursor: pointer;
  font: inherit; font-size: .9em; text-align: left;
}
.menu .mi:hover, .menu .mi.active { background: var(--vscode-list-hoverBackground, var(--surface-3)); }
.menu .mi.danger { color: var(--bad); }
.menu .msep { height: 1px; margin: 4px 6px; background: var(--border); }
.menu .mhead { padding: 4px 10px; font-size: .74em; text-transform: uppercase; letter-spacing: .5px; color: var(--muted); }
.ac { position: fixed; z-index: 200; width: 280px; background: var(--vscode-editorWidget-background, var(--surface-2)); border: 1px solid var(--border-strong); border-radius: var(--radius); box-shadow: 0 8px 26px rgba(0,0,0,.34); overflow: hidden; animation: rise 120ms var(--ease); }
.ac input { width: 100%; border: 0; border-bottom: 1px solid var(--border); padding: 9px 11px; background: var(--inset); color: var(--vscode-input-foreground); font: inherit; outline: none; }
.ac .results { max-height: 240px; overflow-y: auto; }
.ac .opt { display: flex; align-items: center; gap: 8px; padding: 7px 11px; cursor: pointer; font-size: .9em; }
.ac .opt .oi { width: 18px; text-align: center; color: var(--brand); }
.ac .opt small { color: var(--muted); margin-left: auto; }
.ac .opt:hover, .ac .opt.active { background: var(--vscode-list-hoverBackground, var(--surface-3)); }
.ac .none { padding: 10px 11px; color: var(--muted); font-size: .86em; }

/* Detail inspector ------------------------------------------------------ */
/* The inspector is its own right-hand column (like the Workflow toolbox), sticky under
   the toolbar so it stays in view while the tall grid scrolls. It is hidden until a pin
   is selected; a header (x) closes it and returns the stage to full width. */
.detail { flex: 0 0 300px; align-self: flex-start; position: sticky; top: 56px; max-height: calc(100vh - 72px); overflow: auto; border: 1px solid var(--border-strong); border-radius: var(--radius); background: var(--surface-2); padding: 12px 14px; display: none; }
.detail.show { display: block; animation: rise 160ms var(--ease); }
.detail .dh { display: flex; align-items: center; gap: 10px; }
.detail .dh .dt { font-weight: 600; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.detail .dclose { flex: 0 0 auto; margin-left: auto; width: 24px; height: 24px; display: grid; place-items: center; border-radius: var(--radius-sm); border: 1px solid transparent; background: transparent; color: var(--muted); cursor: pointer; font-size: 14px; line-height: 1; }
.detail .dclose:hover { background: var(--surface-3); color: var(--vscode-foreground); border-color: var(--border); }
.detail .dclose:focus-visible { outline: 2px solid var(--vscode-focusBorder); outline-offset: 1px; }
.detail .da { display: flex; flex-direction: column; align-items: stretch; gap: 8px; margin-top: 12px; }
.detail .da .btn { justify-content: center; }
.detail .dl { color: var(--muted); font-size: .88em; margin-top: 6px; }
/* INFO tip: the recipe's own description (what it does + what it was detected from),
   surfaced here so a paused/seeded recipe explains itself in place instead of being an
   unlabeled timer the user has to open the source to understand. */
.detail .dinfo { display: flex; gap: 8px; margin-top: 10px; padding: 8px 10px; background: var(--surface-3); border-left: 2px solid var(--border-strong); border-radius: var(--radius-sm); color: var(--muted); font-size: .85em; line-height: 1.45; }
.detail .dinfo .ii { flex: 0 0 auto; }

@keyframes rise { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }
@keyframes fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes pop { from { opacity: 0; transform: scale(.85); } to { opacity: 1; transform: scale(1); } }
@media (prefers-reduced-motion: reduce) { * { animation: none !important; transition: none !important; } }
`;

// PLANNER_SCRIPT lives in its own module so this asset file stays under the size
// cap; re-exported here so plannerPanel.ts keeps importing both from one place.
export { PLANNER_SCRIPT } from './plannerScript';
