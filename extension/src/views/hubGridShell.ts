import * as crypto from "crypto";
import { l10n } from "../i18n/l10n";
import { HUBGRID_STYLE, HUBGRID_SCRIPT } from "./hubGridAssets";

// Localized strings the client script renders. Kept out of the inlined JS so the panel
// stays translation-ready (the catalog is the single source); the script reads them
// from the injected STRINGS object.
function uiStrings(): Record<string, string> {
  return {
    all: l10n("hubGrid.filterAll"),
    issue: l10n("hubGrid.kindIssue"),
    pr: l10n("hubGrid.kindPr"),
    draft: l10n("hubGrid.kindDraft"),
    newItem: l10n("hubGrid.newItem"),
    copy: l10n("hubGrid.copyLink"),
    empty: l10n("hubGrid.empty"),
    emptyFiltered: l10n("hubGrid.emptyFiltered"),
    addWatch: l10n("hubGrid.addWatch"),
    dismiss: l10n("hubGrid.dismiss"),
    rateLimited: l10n("hubGrid.rateLimited"),
    scanFailed: l10n("hubGrid.scanFailed"),
    shown: l10n("hubGrid.shown"),
    updated: l10n("hubGrid.updated"),
    justNow: l10n("hubGrid.justNow"),
    minutesAgo: l10n("hubGrid.minutesAgo"),
    hoursAgo: l10n("hubGrid.hoursAgo"),
    daysAgo: l10n("hubGrid.daysAgo"),
  };
}

// The static HTML shell: a strict CSP locked to this load's nonce (no remote anything),
// the title row with the Refresh button, the filter bar, the banner area and the grid.
// Data arrives by postMessage and the inlined script renders it.
export function renderHubGridShell(): string {
  const nonce = crypto.randomBytes(16).toString("base64");
  const csp = [
    "default-src 'none'",
    "img-src 'none'",
    `style-src 'unsafe-inline'`,
    `script-src 'nonce-${nonce}'`,
  ].join("; ");
  const title = l10n("hubGrid.title");
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${title}</title>
<style>${HUBGRID_STYLE}</style>
</head>
<body>
<header>
  <h1>${title}</h1>
  <span class="spacer"></span>
  <button id="refresh">${l10n("hubGrid.refresh")}</button>
</header>
<div id="banners"></div>
<div id="filters" class="filters" role="group" aria-label="${l10n("hubGrid.filterLabel")}"></div>
<div id="live" class="sr-only" aria-live="polite"></div>
<div id="empty" class="empty hidden"></div>
<table id="grid" role="grid" aria-label="${title}" class="hidden">
  <tbody id="rows"></tbody>
</table>
<script nonce="${nonce}">const STRINGS = ${JSON.stringify(uiStrings())};
${HUBGRID_SCRIPT}</script>
</body>
</html>`;
}
