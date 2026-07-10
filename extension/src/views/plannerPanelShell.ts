import * as crypto from "crypto";
import { PLANNER_STYLE, PLANNER_SCRIPT } from "./plannerAssets";
import { l10n } from "../i18n/l10n";

// Builds the planner webview's static HTML shell (hero band, tab toolbar, stage +
// detail panes) under a strict CSP with a per-load nonce. Pure string builder — no
// panel state — so PlannerPanel just assigns the result to `webview.html`.
export function renderShell(): string {
  const nonce = crypto.randomBytes(16).toString("base64");
  const csp = [
    "default-src 'none'",
    "img-src 'none'",
    "style-src 'unsafe-inline'",
    `script-src 'nonce-${nonce}'`,
  ].join("; ");
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${l10n("planner.title")}</title>
<style>${PLANNER_STYLE}</style>
</head>
<body>
<div class="hero">
  <div class="glyph">&#x1F5D3;</div>
  <div>
    <h1>${l10n("planner.title")}</h1>
    <div class="sub">${l10n("planner.subtitle")}</div>
  </div>
  <div class="spacer"></div>
  <button id="refresh" class="btn icon" title="Refresh">&#x21BB;</button>
</div>
<div class="toolbar">
  <div class="tabs" role="tablist">
    <button class="tab" role="tab" data-v="day">&#x1F551; Day</button>
    <button class="tab" role="tab" data-v="week">&#x1F4C5; Week</button>
    <button class="tab" role="tab" data-v="workflow">&#x1F517; Workflow</button>
  </div>
  <div class="spacer"></div>
  <button id="density" class="btn" title="Toggle row height (compact / comfortable)">&#x2261; Compact</button>
  <div class="legend">
    <span class="dot"><span class="sw" style="background:var(--brand)"></span>scheduled</span>
    <span class="dot"><span class="sw" style="background:var(--ok)"></span>last run ok</span>
  </div>
</div>
<div class="workarea">
  <div id="stage" class="stage"></div>
  <div id="detail" class="detail" role="complementary" aria-label="${l10n("planner.detail.label")}">
    <div id="rsz-detail" class="rsz" role="separator" aria-orientation="vertical" title="${l10n("planner.detail.resize")}"></div>
    <div id="detail-body" class="detail-body"></div>
  </div>
</div>
<script nonce="${nonce}">${PLANNER_SCRIPT}</script>
</body>
</html>`;
}
