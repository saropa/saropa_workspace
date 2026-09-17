// Pure width/visibility math for the Launcher's resizable + collapsible side panels (the
// left category-list panel and the right run-history panel — see
// plans/PLAN_Launcher_Restructure.md build order step 1). Kept as real, unit-tested TS
// functions in their own module, separate from the webview client script fragments
// (src/views/launcher/launcherScript*.ts): the webview's script is a dependency-free
// inline string that cannot `import` this module, so launcherScriptSplit.ts reimplements
// this same small arithmetic directly inside its template literal (mirroring how Planner's
// attachResizer inlines its own clamp rather than importing one). This module exists so the
// arithmetic itself gets a real, directly-callable unit test instead of only a
// string-contains assertion on the generated script.
//
// Keep the two implementations in sync by hand when either changes.

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

// Clamp a candidate width to the panel's configured [min, max] range. Shared by both the
// live drag handler (every mousemove) and resolvePanelWidth (in case a persisted width
// predates a later change to min/max).
export function clampPanelWidth(width: number, limits: Pick<PanelLimits, "min" | "max">): number {
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
