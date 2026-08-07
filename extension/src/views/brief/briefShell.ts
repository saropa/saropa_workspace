import * as crypto from "crypto";
import { l10n } from "../../i18n/l10n";
import { BRIEF_STYLE, BRIEF_SCRIPT } from "./briefAssets";

// The static HTML shell for the Morning Brief webview. Strict CSP with a
// per-load nonce, no remote content. Brief data arrives via postMessage; the
// script renders cards and posts "openReport" messages back.
export function renderBriefShell(): string {
  const nonce = crypto.randomBytes(16).toString("base64");
  const csp = [
    "default-src 'none'",
    "img-src 'none'",
    `style-src 'unsafe-inline'`,
    `script-src 'nonce-${nonce}'`,
  ].join("; ");
  const title = l10n("brief.title");
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${title}</title>
<style>${BRIEF_STYLE}</style>
</head>
<body>
<h1>${title}</h1>
<div id="content"></div>
<script nonce="${nonce}">${BRIEF_SCRIPT}</script>
</body>
</html>`;
}

// The localized strings the client script renders, kept out of the inlined JS.
export function briefUiStrings(): Record<string, string> {
  return {
    title: l10n("brief.title"),
    allClear: l10n("brief.allClear"),
    needsAttention: l10n("brief.needsAttention"),
    openReport: l10n("brief.openReport"),
    openSummary: l10n("brief.openSummary"),
    saveHtml: l10n("brief.saveHtml"),
    copyMarkdown: l10n("brief.copyMarkdown"),
    exportFooter: l10n("brief.exportFooter"),
    none: l10n("brief.none"),
  };
}
