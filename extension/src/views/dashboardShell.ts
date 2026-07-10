import * as crypto from "crypto";
import { l10n } from "../i18n/l10n";
import { PANEL_STYLE, PANEL_SCRIPT } from "./dashboardAssets";

// The tabs the dashboard exposes. Webview-local selection; the host loads the data
// for the active tab on demand (it never pushes all three at once), so the live
// process poll only runs while the Processes tab is showing.
export type DashboardTab = "processes" | "analytics" | "trends";

// The static HTML shell: a strict CSP locked to this nonce for scripts and to the
// webview's own inline styles, no remote anything. The tab strip and all three tab
// panels are framed here; data arrives by postMessage and the inlined script renders
// it. Display strings the script needs are injected as a localized STRINGS object so
// no English is hardcoded in the client.
export function renderShell(initialTab: DashboardTab): string {
  const nonce = crypto.randomBytes(16).toString("base64");
  const csp = [
    "default-src 'none'",
    "img-src 'none'",
    `style-src 'unsafe-inline'`,
    `script-src 'nonce-${nonce}'`,
  ].join("; ");
  const strings = JSON.stringify(uiStrings());
  const isActive = (tab: DashboardTab): string => (tab === initialTab ? " active" : "");
  const isShown = (tab: DashboardTab): string => (tab === initialTab ? "" : " hidden");
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${l10n("monitor.panel.title")}</title>
<style>${PANEL_STYLE}</style>
</head>
<body>
<header>
  <div class="tabs">
    <button class="tab${isActive("processes")}" data-tab="processes">${l10n("tab.processes")}</button>
    <button class="tab${isActive("analytics")}" data-tab="analytics">${l10n("tab.analytics")}</button>
    <button class="tab${isActive("trends")}" data-tab="trends">${l10n("tab.trends")}</button>
    <span class="spacer"></span>
    <button id="refresh">${l10n("dashboard.refresh")}</button>
  </div>
</header>

<section id="tab-processes" class="tab-panel${isShown("processes")}">
  <div id="host" class="host"></div>
  <div class="actions">
    <button id="sortCpu" class="seg active">${l10n("dashboard.sortCpu")}</button>
    <button id="sortRam" class="seg">${l10n("dashboard.sortRam")}</button>
    <button id="sortPid" class="seg">${l10n("dashboard.sortProc")}</button>
    <span class="spacer"></span>
    <button id="copy">${l10n("dashboard.copyReport")}</button>
  </div>
  <div id="spark" class="spark"></div>
  <div id="status" class="status"></div>
  <div id="groups"></div>
</section>

<section id="tab-analytics" class="tab-panel${isShown("analytics")}">
  <div id="analytics"></div>
</section>

<section id="tab-trends" class="tab-panel${isShown("trends")}">
  <div id="trends"></div>
</section>

<script nonce="${nonce}">const INITIAL_TAB = ${JSON.stringify(initialTab)};
const STRINGS = ${strings};
${PANEL_SCRIPT}</script>
</body>
</html>`;
}

// The localized strings the client script renders, kept out of the inlined JS so the
// dashboard stays translation-ready (the catalog is the single source).
function uiStrings(): Record<string, string> {
  return {
    processEmpty: l10n("dashboard.processEmpty"),
    sampling: l10n("dashboard.sampling"),
    colPid: l10n("dashboard.colPid"),
    colName: l10n("dashboard.colName"),
    colCpu: l10n("dashboard.colCpu"),
    colRam: l10n("dashboard.colRam"),
    hot: l10n("dashboard.hot"),
    endTask: l10n("dashboard.endTask"),
    proc: l10n("dashboard.proc"),
    analyticsHeading: l10n("analytics.totalsHeading"),
    mostRunHeading: l10n("analytics.mostRunHeading"),
    sessionHeading: l10n("analytics.sessionHeading"),
    sessionNote: l10n("analytics.sessionNote"),
    recentHeading: l10n("analytics.recentHeading"),
    openMarkdown: l10n("analytics.openMarkdown"),
    trendsCpuHeading: l10n("trends.cpuHeading"),
    trendsDebtHeading: l10n("trends.debtHeading"),
    trendsReportsHeading: l10n("trends.reportsHeading"),
    trendsNoCpu: l10n("trends.noCpu"),
    trendsNoDebt: l10n("trends.noDebt"),
    trendsNoReports: l10n("trends.noReports"),
    debtLatest: l10n("trends.debtLatest"),
  };
}
