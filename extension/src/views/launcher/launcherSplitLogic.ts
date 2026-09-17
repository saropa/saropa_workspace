// Pure width/visibility math for the Launcher's resizable + collapsible side panels (the
// left category-list panel and the right run-history panel — see
// plans/PLAN_Launcher_Restructure.md build order step 1). Kept as real, unit-tested TS
// functions in their own module, separate from the webview client script fragments
// (src/views/launcher/launcherScript*.ts): the webview's script is a dependency-free
// inline string that cannot `import` this module.
//
// The client's copy is NOT hand-duplicated — that was step 1's first draft and it is
// exactly the failure mode BUG-012 already burned this repo on (see
// webviewClientUtils.ts's header). Instead, webviewClientUtils.ts's panelWidthMathJs()
// generates the client's clampPanelWidth/resolvePanelWidth/isPanelVisible from this
// same algorithm as JS source text, interpolated into launcherScriptSplit.ts's template
// literal, and src/test/launcherSplitLogic.test.ts evaluates that generated text
// (`new Function`) and asserts it against these TS functions for shared fixtures — so a
// drift between the two would fail a test, not just look the same on a diff.

/** A panel's persisted posture: its last dragged width (px) and whether it is collapsed. */
export interface PanelPersisted {
  /** Last dragged width in px. Absent/undefined means "never dragged — use the default". */
  width?: number;
  /** Whether the panel is currently collapsed to hidden. Absent means "use the default". */
  hidden?: boolean;
}

/** A panel's fixed sizing rules: the clamp range and the width to use before any drag. */
export interface PanelLimits {
  min: number;
  max: number;
  defaultWidth: number;
}

// Single source of truth for both panels' sizing rules — imported by the webview-JS
// generator (webviewClientUtils.ts's panelWidthMathJs), the CSS fallback values
// (launcherAssets.ts), and this module's own tests, so there is exactly one place to
// change a limit instead of three copies silently drifting apart.
export const LEFT_PANEL_LIMITS: PanelLimits = { min: 160, max: 400, defaultWidth: 220 };
export const RIGHT_PANEL_LIMITS: PanelLimits = { min: 200, max: 480, defaultWidth: 260 };

// Clamp a candidate width to the panel's configured [min, max] range. Shared by both the
// live drag handler (every mousemove) and resolvePanelWidth (in case a persisted width
// predates a later change to min/max). Number.isFinite rejects NaN/+-Infinity before the
// Math.max/min clamp would otherwise pass a NaN straight through (a persisted width can
// carry one — vscode.setState uses structured clone, which round-trips NaN, unlike JSON).
export function clampPanelWidth(width: number, limits: Pick<PanelLimits, "min" | "max">): number {
  if (!Number.isFinite(width)) {
    return limits.min;
  }
  return Math.max(limits.min, Math.min(limits.max, width));
}

// The width to render a panel at right now: the last dragged width if one was ever
// persisted, otherwise the panel's default — clamped either way. Collapse never touches
// this value (see isPanelVisible/nextPanelHidden below), so re-showing a collapsed panel
// restores the last dragged width rather than resetting to the default.
export function resolvePanelWidth(persisted: PanelPersisted, limits: PanelLimits): number {
  const width = typeof persisted.width === "number" ? persisted.width : limits.defaultWidth;
  return clampPanelWidth(width, limits);
}

// Whether a panel should currently render visible, given its persisted state and the
// panel's own default posture (the left panel defaults to visible, the right panel
// defaults to collapsed — see PLAN_Launcher_Restructure.md's "Target layout"). Persisted
// `hidden` always wins once set; only its absence falls back to the default.
export function isPanelVisible(persisted: PanelPersisted, defaultHidden: boolean): boolean {
  const hidden = typeof persisted.hidden === "boolean" ? persisted.hidden : defaultHidden;
  return !hidden;
}

// Applying a collapse/expand toggle never touches the stored width — this is the whole
// "collapse pairs with resize without losing the drag" contract the plan calls out
// explicitly, so it gets its own named function (and test) rather than being reimplemented
// inline at each call site.
export function withHidden(persisted: PanelPersisted, hidden: boolean): PanelPersisted {
  return { ...persisted, hidden };
}

// Applying a drag-resize never touches the stored hidden flag (a panel being resized is,
// by definition, already visible; and a later expand should not silently reset to default).
export function withWidth(persisted: PanelPersisted, width: number, limits: PanelLimits): PanelPersisted {
  return { ...persisted, width: clampPanelWidth(width, limits) };
}
