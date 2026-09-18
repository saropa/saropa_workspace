// Fragment of the Saropa Workspace panel webview client script. The whole script is split
// across src/views/launcher/* only to keep each file under the line cap; at runtime the
// fragments are concatenated by launcherScript.ts into ONE <script>, so every fragment
// shares a single global scope. This fragment runs right after launcherScriptCore.ts (it
// reads `vscode` and `store`, the persisted-state handle core.ts sets up) and before the
// rendering fragments — order matters less for it than for core.ts since every entry point
// here is a function declaration (hoisted), but the boot wiring at the bottom is a
// top-level statement that must run once, in place.
//
// A generic resizable + collapsible side-panel component, used identically for the left
// category-list slot and the right run-history slot (see launcherViewShell.ts for the
// markup and PLAN_Launcher_Restructure.md for why one component serves both). Drag-resize
// is ported from Planner's attachResizer (src/views/planner/plannerScriptCore.ts) — same
// get/set/min/max/dirX shape, live-apply during drag, persist on release — paired with
// collapse-to-hidden behavior that does not exist in Planner's version, modeled on the
// hidden-flag-in-persisted-state idiom launcherScriptCore.ts's own store already used
// elsewhere (that pane-content idiom, isPaneHidden/setPaneHidden, was later removed by
// build order step 7 once its purpose — the header toggle chips — was deprecated; this
// panel's own isPanelHidden/setPanelHidden below are a distinct, still-live mechanism for a
// different thing — panel visibility, not pane content visibility).
// Collapsing a panel never touches its stored width; re-showing it restores the last
// dragged width, never a fixed default. The clamp/default/visibility arithmetic is NOT
// hand-duplicated here — panelWidthMathJs() generates clampPanelWidth/resolvePanelWidth/
// isPanelVisible from the exact same algorithm as launcherSplitLogic.ts's real, unit-tested
// TS twins, and PANEL_LIMITS below is that same module's LEFT_PANEL_LIMITS/
// RIGHT_PANEL_LIMITS serialized in, so there is exactly one place to change a limit.
import { panelWidthMathJs } from '../webviewClientUtils';
import { LEFT_PANEL_LIMITS, RIGHT_PANEL_LIMITS } from './launcherSplitLogic';

export const LAUNCHER_SCRIPT_SPLIT = `
// Fixed sizing rules per panel: the drag clamp range and the width used before any drag.
// Serialized from launcherSplitLogic.ts's LEFT_PANEL_LIMITS/RIGHT_PANEL_LIMITS — the single
// source of truth also used by this repo's CSS fallback values and unit tests.
var PANEL_LIMITS = ${JSON.stringify({ left: LEFT_PANEL_LIMITS, right: RIGHT_PANEL_LIMITS })};
// Right panel starts collapsed (per the restructure plan's target layout); left starts
// visible. Only the ABSENCE of a persisted 'hidden' flag falls back to this.
function panelDefaultHidden(id) { return id === 'right'; }

${panelWidthMathJs()}

function panelPersisted(id) { return (store.panels && store.panels[id]) || {}; }

function isPanelHidden(id) {
  return !isPanelVisible(panelPersisted(id), panelDefaultHidden(id));
}

function setPanelHidden(id, hidden) {
  store.panels = store.panels || {};
  store.panels[id] = store.panels[id] || {};
  store.panels[id].hidden = hidden;
  vscode.setState(store);
}

// The persisted width, clamped to the panel's current limits (re-clamped in case a saved
// width predates a later change to min/max, or the getState() blob is stale/corrupt).
function persistedPanelWidth(id) {
  return resolvePanelWidth(panelPersisted(id), PANEL_LIMITS[id]);
}

// The width actually applied right now: a value being live-dragged wins over the
// persisted one, so the CSS var tracks the pointer during a drag before mouseup commits it.
var liveWidth = {};
function currentPanelWidth(id) {
  return typeof liveWidth[id] === 'number' ? liveWidth[id] : persistedPanelWidth(id);
}

function savePanelWidth(id) {
  if (typeof liveWidth[id] !== 'number') { return; }
  store.panels = store.panels || {};
  store.panels[id] = store.panels[id] || {};
  store.panels[id].width = liveWidth[id];
  vscode.setState(store);
  delete liveWidth[id];
}

// Re-applies both panels' hidden/width posture to the DOM: toggles the .hidden class (the
// stylesheet's .side-panel.hidden{display:none} collapses it out of the flex row entirely,
// so a collapsed panel takes no width) and writes the live width into the CSS custom
// property the stylesheet reads (--launcher-left-w / --launcher-right-w).
function applySplit() {
  var ids = ['left', 'right'];
  for (var i = 0; i < ids.length; i++) {
    var id = ids[i];
    var el = document.getElementById(id === 'left' ? 'leftPanel' : 'rightPanel');
    if (!el) { continue; }
    el.classList.toggle('hidden', isPanelHidden(id));
    document.documentElement.style.setProperty('--launcher-' + id + '-w', currentPanelWidth(id) + 'px');
  }
}

function togglePanel(id) {
  setPanelHidden(id, !isPanelHidden(id));
  applySplit();
}

// Wire a panel's drag handle. dirX is +1 when dragging right should GROW the panel (the
// handle sits on the panel's trailing/right edge, e.g. the left panel) and -1 when dragging
// right should SHRINK it (handle on the panel's leading/left edge, e.g. the right panel).
// Mirrors Planner's attachResizer exactly in shape; the difference here is that width is
// tracked per-panel-id through liveWidth/currentPanelWidth/savePanelWidth rather than a
// single pair of module-level get/set closures, since this component serves two panels.
function attachSplitResizer(handle, id, dirX) {
  if (!handle) { return; }
  handle.addEventListener('mousedown', function (e) {
    if (e.button !== 0) { return; }
    e.preventDefault();
    var startX = e.clientX;
    var startW = currentPanelWidth(id);
    var limits = PANEL_LIMITS[id];
    handle.classList.add('dragging');
    document.body.classList.add('resizing');
    function move(ev) {
      liveWidth[id] = clampPanelWidth(startW + dirX * (ev.clientX - startX), limits);
      applySplit();
    }
    function up() {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      handle.classList.remove('dragging');
      document.body.classList.remove('resizing');
      savePanelWidth(id);
    }
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  });
}

// Wired at parse time (a top-level statement, not inside a function): unlike #root's
// dynamically rendered content, the split shell markup (#leftPanel/#rightPanel/
// #rsz-left/#rsz-right) is already present in the initial HTML (see launcherViewShell.ts),
// so it is safe to query and attach to immediately.
attachSplitResizer(document.getElementById('rsz-left'), 'left', 1);
attachSplitResizer(document.getElementById('rsz-right'), 'right', -1);
applySplit();
`;
