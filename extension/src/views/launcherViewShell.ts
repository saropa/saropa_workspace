import * as vscode from "vscode";
import * as crypto from "crypto";
import { l10n } from "../i18n/l10n";
import { LAUNCHER_STYLE } from "./launcherAssets";
import { LAUNCHER_SCRIPT } from "./launcherScript";

// The Saropa Launcher webview's initial HTML shell: the CSP, the header/search markup, and
// the injected style + client script. Kept apart from launcherView.ts's lifecycle/message
// logic since this is pure markup assembly with no store/watch dependency.

// Build the launcher webview's initial HTML. Paints the project name synchronously so the
// header is never blank on first render; the version + stats arrive in the first data
// message (they need the disk scan) and are filled in by the client script's renderHeader.
export function renderHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const nonce = crypto.randomBytes(16).toString("base64");
  const codiconUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "dist", "codicon.css")
  );
  // A folder basename is user-controlled, so it is HTML-escaped before it is interpolated
  // into the markup (the webview's later update uses textContent and is safe by
  // construction).
  const primary = (vscode.workspace.workspaceFolders ?? [])[0];
  const projectName = escapeHtml(
    primary?.name ?? vscode.workspace.name ?? l10n("launcher.noProject")
  );
  const csp = [
    "default-src 'none'",
    "img-src 'none'",
    // The codicon stylesheet loads from the webview's own resource origin; our injected
    // <style> needs 'unsafe-inline'. The font loads from the same origin.
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `font-src ${webview.cspSource}`,
    `script-src 'nonce-${nonce}'`,
  ].join("; ");
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<link href="${codiconUri}" rel="stylesheet" />
<title>${l10n("launcher.title")}</title>
<style>${LAUNCHER_STYLE}</style>
</head>
<body>
<header>
  <div class="head-bar">
    <div class="project">
      <div id="projName" class="project-name">${projectName}</div>
      <div id="projMeta" class="project-meta"></div>
    </div>
    <div class="search">
      <span class="codicon codicon-search"></span>
      <input id="q" type="text" spellcheck="false" aria-label="${l10n("launcher.searchPlaceholder")}" />
      <span id="count" class="count"></span>
    </div>
  </div>
</header>
<div id="empty" class="empty hidden">${l10n("launcher.empty")}</div>
<div id="root" class="root"></div>
<script nonce="${nonce}">${LAUNCHER_SCRIPT}</script>
</body>
</html>`;
}

// Escape the five HTML-significant characters before interpolating an untrusted value (a
// folder basename) into the initial markup string. Every other rendered value reaches the
// webview through textContent, which escapes by construction; this guards the one value
// baked into the HTML host-side.
function escapeHtml(value: string): string {
  return value
    .split("&").join("&amp;")
    .split("<").join("&lt;")
    .split(">").join("&gt;")
    .split('"').join("&quot;")
    .split("'").join("&#39;");
}
