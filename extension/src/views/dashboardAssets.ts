// Inlined CSS + client script for the Process & Analytics dashboard webview, kept
// in its own module so dashboardPanel.ts stays the controller/host side. Both are
// injected under the panel's per-load nonce; neither loads a remote resource. All
// colors/spacing bind to --vscode-* theme variables so the panel matches the editor
// in light/dark/high-contrast without a hardcoded palette.

export const PANEL_STYLE = `
:root { color-scheme: light dark; }
body {
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size);
  color: var(--vscode-foreground);
  background: var(--vscode-editor-background);
  margin: 0;
  padding: 12px 16px;
}
header { position: sticky; top: 0; background: var(--vscode-editor-background); padding-bottom: 8px; z-index: 1; }
.tabs { display: flex; gap: 6px; align-items: center; border-bottom: 1px solid var(--vscode-panel-border); }
.tab {
  font-family: inherit; font-size: 0.92em; cursor: pointer;
  color: var(--vscode-foreground); background: transparent;
  border: none; border-bottom: 2px solid transparent; padding: 6px 10px; border-radius: 0;
}
.tab:hover { color: var(--vscode-textLink-foreground); }
.tab.active { border-bottom-color: var(--vscode-focusBorder); color: var(--vscode-textLink-activeForeground); }
.tab-panel { padding-top: 10px; }
.tab-panel.hidden { display: none; }
.host { color: var(--vscode-descriptionForeground); font-size: 0.92em; margin-bottom: 6px; }
.actions { display: flex; gap: 6px; align-items: center; }
.spacer { flex: 1; }
button {
  font-family: inherit; font-size: 0.9em;
  color: var(--vscode-button-foreground);
  background: var(--vscode-button-background);
  border: none; padding: 4px 10px; border-radius: 4px; cursor: pointer;
}
button:hover { background: var(--vscode-button-hoverBackground); }
button.seg {
  color: var(--vscode-foreground);
  background: var(--vscode-button-secondaryBackground);
}
button.seg.active { color: var(--vscode-button-foreground); background: var(--vscode-button-background); }
.spark { height: 36px; margin: 8px 0; }
.spark svg { width: 100%; height: 36px; }
.spark polyline { fill: none; stroke: var(--vscode-charts-blue); stroke-width: 1.5; }
.status { color: var(--vscode-descriptionForeground); font-size: 0.9em; margin: 4px 0; }
.group { border-bottom: 1px solid var(--vscode-panel-border); padding: 8px 0; }
.group-head { display: flex; align-items: center; gap: 8px; cursor: pointer; }
.group-name { font-weight: 600; flex: 1; }
.group-name .worst { color: var(--vscode-charts-red); margin-left: 6px; font-size: 0.85em; }
.metric { font-variant-numeric: tabular-nums; min-width: 70px; text-align: right; color: var(--vscode-descriptionForeground); }
.bar { height: 4px; border-radius: 2px; background: var(--vscode-charts-blue); margin-top: 4px; }
.bar.hot { background: var(--vscode-charts-red); }
table { width: 100%; border-collapse: collapse; margin-top: 6px; }
td, th { text-align: left; padding: 2px 6px; font-variant-numeric: tabular-nums; }
th { color: var(--vscode-descriptionForeground); font-weight: 500; font-size: 0.85em; }
td.num, th.num { text-align: right; }
.kill {
  color: var(--vscode-foreground); background: transparent;
  border: 1px solid var(--vscode-panel-border); padding: 1px 6px; font-size: 0.8em;
}
.kill:hover { background: var(--vscode-inputValidation-errorBackground); }
.empty { color: var(--vscode-descriptionForeground); padding: 24px 0; text-align: center; }
h2 { font-size: 1em; margin: 16px 0 6px; }
h2:first-child { margin-top: 0; }
.note { color: var(--vscode-descriptionForeground); font-size: 0.88em; margin: 2px 0 8px; }
.rank { margin: 0; padding-left: 20px; }
.rank li { margin: 2px 0; }
.rank .sub { color: var(--vscode-descriptionForeground); }
.row { display: flex; gap: 8px; align-items: baseline; padding: 2px 0; }
.row .name { flex: 1; }
.row .meta { color: var(--vscode-descriptionForeground); font-size: 0.88em; }
.row .ok { color: var(--vscode-charts-green); }
.row .fail { color: var(--vscode-charts-red); }
.tag { color: var(--vscode-descriptionForeground); font-size: 0.82em; }
.linkish { color: var(--vscode-textLink-foreground); cursor: pointer; }
.linkish:hover { text-decoration: underline; }
.legend { display: flex; flex-wrap: wrap; gap: 10px; margin: 4px 0 6px; font-size: 0.85em; }
.legend span { display: inline-flex; align-items: center; gap: 4px; color: var(--vscode-descriptionForeground); }
.swatch { width: 10px; height: 10px; border-radius: 2px; display: inline-block; }
canvas { width: 100%; height: 120px; display: block; }
.report-cat { margin: 8px 0; }
.report-cat .cat-head { font-weight: 600; }
.report-cat .cat-count { color: var(--vscode-descriptionForeground); font-weight: 400; font-size: 0.88em; margin-left: 6px; }
.report-file { padding: 1px 0 1px 12px; font-size: 0.9em; }
.report-file .ago { color: var(--vscode-descriptionForeground); margin-left: 6px; font-size: 0.85em; }
`;

// PANEL_SCRIPT lives in its own module so this asset file stays under the size cap;
// re-exported here so dashboardPanel.ts keeps importing both from one place.
export { PANEL_SCRIPT } from './dashboardScript';
