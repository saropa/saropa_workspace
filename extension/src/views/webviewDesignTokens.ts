// Shared design-token `:root` block for the card/hero-styled webviews (Configure Run,
// Customize, Planner, Schedule editor, Settings). These five panels are meant to read
// as one visual family, but the token block had been hand-copied into each asset
// module (BUG-012) — the `--dur` value had already drifted (140ms vs 160ms) between
// copies, and any future brand/radius change would otherwise need five synchronized
// edits found only by grepping. Centralizing it here means a family-wide restyle is
// one edit, and the base tokens can never silently diverge between panels again.
export interface DesignTokenOptions {
  // Extra CSS custom properties this webview needs beyond the shared baseline (e.g.
  // --link, --ok, --space-*), appended inside the SAME :root block (not a second
  // block) so a reader checking "what tokens does this panel define" looks in one
  // place. Raw CSS declaration lines, each ending in `;` — no wrapping braces.
  extra?: string;
  // Animation duration in ms. Three of the five panels use 160ms, two use 140ms
  // (Customize and Settings — the smaller, single-purpose forms feel snappier with a
  // shorter transition); both values are intentional, not an unnoticed drift.
  durationMs?: number;
}

// Returns the `:root { ... }` block text, ready to inline at the top of a webview's
// STYLE template literal.
export function designTokenRoot(options: DesignTokenOptions = {}): string {
  const dur = options.durationMs ?? 160;
  const extra = options.extra ? `\n${options.extra}` : "";
  return `:root {
  color-scheme: light dark;
  --surface-1: var(--vscode-editor-background);
  --surface-2: var(--vscode-editorWidget-background, var(--vscode-editor-background));
  --surface-3: var(--vscode-editor-inactiveSelectionBackground, rgba(127,127,127,.10));
  --inset: var(--vscode-input-background);
  --border: var(--vscode-widget-border, var(--vscode-panel-border, rgba(127,127,127,.28)));
  --border-strong: color-mix(in srgb, var(--vscode-focusBorder) 35%, var(--border));
  --muted: var(--vscode-descriptionForeground);
  --brand: #f97316;
  --brand-2: #ea580c;
  --hero-tint: color-mix(in srgb, var(--brand) 16%, transparent);
  --radius-sm: 4px; --radius: 8px; --radius-lg: 12px; --radius-pill: 999px;
  --ease: cubic-bezier(.2,.6,.2,1);
  --dur: ${dur}ms;${extra}
}`;
}
