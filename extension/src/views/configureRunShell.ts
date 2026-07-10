// The static HTML for the Configure Run webview: the CSP shell and the six form cards
// (command + args + file-arg, working directory, environment, run location + administrator,
// output extraction + dependency, behavior). Split out of configureRunPanel.ts so the panel
// file stays the host/protocol side and this stays the markup. The cards that read dynamic
// data (the working-directory presets and the dependency options) take the store and the
// shortcut; the rest are pure string builders.
//
// Local-only and safe (the native-first / webview rules): a strict CSP with a per-load
// nonce, no remote or bundled resource, themed entirely via --vscode-* variables. All
// visible text is externalized through l10n; nothing here trusts a label/path/value as
// markup (see esc).
import * as vscode from "vscode";
import * as crypto from "crypto";
import * as path from "path";
import { Shortcut } from "../model/shortcut";
import { ShortcutStore } from "../model/shortcutStore";
import { CONFIGURE_RUN_STYLE, CONFIGURE_RUN_SCRIPT } from "./configureRunAssets";
import { l10n } from "../i18n/l10n";

// The display name for a shortcut, falling back to its file basename. Shared with the panel
// (titles, toasts) so both agree.
export function shortcutName(shortcut: Shortcut): string {
  return shortcut.label ?? (shortcut.path.split("/").pop() ?? shortcut.path);
}

// Build the full webview HTML document for one shortcut's Configure Run form: the CSP
// shell, the hero header, and the six form cards assembled in order, plus the env-row
// <template> the client clones for each new environment variable. Rebuilt from scratch on
// every open/repoint since a panel only ever shows one shortcut's config at a time.
export function renderConfigureRunHtml(store: ShortcutStore, shortcut: Shortcut): string {
  const nonce = crypto.randomBytes(16).toString("base64");
  const csp = [
    "default-src 'none'",
    "img-src 'none'",
    "style-src 'unsafe-inline'",
    `script-src 'nonce-${nonce}'`,
  ].join("; ");
  const name = shortcutName(shortcut);
  const title = l10n("configureRun.title", { name });

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${esc(title)}</title>
<style>${CONFIGURE_RUN_STYLE}</style>
</head>
<body>
<div class="hero">
  <div class="glyph">&#x2699;</div>
  <div class="htext">
    <h1>${esc(title)}</h1>
    <div class="sub">${esc(l10n("configureRun.subtitle", { name }))}</div>
  </div>
</div>

${commandCard()}
${cwdCard(store, shortcut)}
${envCard()}
${locationCard()}
${outputCard(store, shortcut)}
${behaviorCard()}

<div class="footer">
  <div class="pv">
    <span class="pl">${esc(l10n("configureRun.footer.command"))}</span>
    <span class="pvv" id="commandPreview"></span>
  </div>
  <div class="spacer"></div>
  <button class="btn" id="cancel">${esc(l10n("configureRun.cancel"))}</button>
  <button class="btn primary" id="save">${esc(l10n("configureRun.save"))}</button>
</div>

<template id="envRowTpl"><div class="envrow"><input type="text" class="envKey" placeholder="${esc(
    l10n("configureRun.env.keyPlaceholder")
  )}" /><input type="text" class="envVal" placeholder="${esc(
    l10n("configureRun.env.valuePlaceholder")
  )}" /><button class="iconbtn envDel" type="button" title="${esc(
    l10n("configureRun.env.remove")
  )}" aria-label="${esc(l10n("configureRun.env.remove"))}">&#x2715;</button></div></template>

<script nonce="${nonce}">${CONFIGURE_RUN_SCRIPT}</script>
</body>
</html>`;
}

function commandCard(): string {
  return `<div class="card">
  <div class="ttl">${esc(l10n("configureRun.section.command"))}</div>
  <div class="field">
    <div class="lab">${esc(l10n("configureRun.label.command"))}</div>
    <div class="desc">${esc(l10n("configure.command.prompt"))}</div>
    <input type="text" class="mono" id="command" placeholder="${esc(l10n("configure.command.placeholder"))}" />
    <div class="chips" id="interpreterChips"></div>
    <div class="hint" id="interpreterHint"></div>
  </div>
  <div class="field">
    <div class="lab">${esc(l10n("configureRun.label.args"))}</div>
    <div class="desc">${esc(l10n("configure.args.prompt"))}</div>
    <input type="text" class="mono" id="args" placeholder="${esc(l10n("configure.args.placeholder"))}" />
  </div>
  <div class="opt" id="fileArgRow">
    <div class="meta">
      <div class="lab">${esc(l10n("configureRun.label.fileArg"))}</div>
      <div class="d">${esc(l10n("configureRun.label.fileArg.desc"))}</div>
    </div>
    <div class="spacer"></div>
    <label class="switch"><input type="checkbox" id="fileArg" /><span class="track"></span><span class="knob"></span></label>
  </div>
</div>`;
}

// The working-directory card with preset buttons. The preset PATHS are resolved host-side
// (the owning workspace folder and the file's own folder) and carried in data-path; an
// empty data-path clears the field back to the owning-folder default.
function cwdCard(store: ShortcutStore, shortcut: Shortcut): string {
  const uri = store.resolveUri(shortcut);
  const owningFolder = uri
    ? vscode.workspace.getWorkspaceFolder(uri)?.uri.fsPath
    : undefined;
  const fileDir = uri ? path.dirname(uri.fsPath) : undefined;

  const presets: string[] = [
    `<button class="btn cwdpreset" type="button" data-path="">${esc(
      l10n("configureRun.cwd.default")
    )}</button>`,
  ];
  if (owningFolder) {
    presets.push(
      `<button class="btn cwdpreset" type="button" data-path="${esc(owningFolder)}">${esc(
        l10n("configureRun.cwd.workspace")
      )}</button>`
    );
  }
  if (fileDir && fileDir !== owningFolder) {
    presets.push(
      `<button class="btn cwdpreset" type="button" data-path="${esc(fileDir)}">${esc(
        l10n("configureRun.cwd.fileDir")
      )}</button>`
    );
  }

  return `<div class="card">
  <div class="ttl">${esc(l10n("configureRun.section.cwd"))}</div>
  <div class="row" style="margin-bottom:8px">${presets.join("")}</div>
  <input type="text" class="mono" id="cwd" placeholder="${esc(l10n("configureRun.cwd.placeholder"))}" />
</div>`;
}

function envCard(): string {
  return `<div class="card">
  <div class="ttl">${esc(l10n("configureRun.section.env"))}</div>
  <div class="envEmpty" id="envEmpty">${esc(l10n("configureRun.env.empty"))}</div>
  <div id="envList"></div>
  <button class="btn" id="envAdd" type="button">${esc(l10n("configureRun.env.add"))}</button>
</div>`;
}

// Run location + the administrator toggle. The toggle is rendered always (never hidden) and
// disabled with an inline hint until the location is external — the discoverability fix this
// form exists for.
function locationCard(): string {
  const options: Array<{ value: string; key: string }> = [
    { value: "default", key: "configure.terminal.default" },
    { value: "terminal", key: "configure.terminal.integrated" },
    { value: "background", key: "configure.terminal.background" },
    { value: "external", key: "configure.terminal.external" },
  ];
  const opts = options
    .map((o) => `<option value="${o.value}">${esc(l10n(o.key))}</option>`)
    .join("");
  return `<div class="card">
  <div class="ttl">${esc(l10n("configureRun.section.location"))}</div>
  <div class="field">
    <div class="lab">${esc(l10n("configureRun.label.location"))}</div>
    <div class="desc">${esc(l10n("configure.terminal.externalDetail"))}</div>
    <select id="location">${opts}</select>
  </div>
  <div class="opt" id="elevatedRow">
    <div class="meta">
      <div class="lab">${esc(l10n("configureRun.label.elevated"))}</div>
      <div class="d">${esc(l10n("configureRun.elevated.desc"))}</div>
      <div class="needs">${esc(l10n("configureRun.elevated.needsExternal"))}</div>
    </div>
    <div class="spacer"></div>
    <label class="switch"><input type="checkbox" id="elevated" /><span class="track"></span><span class="knob"></span></label>
  </div>
</div>`;
}

// Output extraction + the prerequisite dependency. The dependency options are dynamic (the
// other shortcuts across both scopes), so they are host-rendered into the select here rather
// than injected at init.
function outputCard(store: ShortcutStore, shortcut: Shortcut): string {
  const depOptions: string[] = [
    `<option value="">${esc(l10n("configureRun.dependsOn.none"))}</option>`,
  ];
  for (const candidate of [
    ...store.getProjectShortcuts(),
    ...store.getGlobalShortcuts(),
  ]) {
    // A shortcut cannot depend on itself; recipe shortcuts are detected, not the user's own
    // build steps, so they are excluded (matches the QuickPick dependency picker).
    if (candidate.id === shortcut.id || candidate.isRecipe) {
      continue;
    }
    const scope =
      candidate.scope === "global"
        ? l10n("pin.group.global")
        : l10n("pin.group.project");
    depOptions.push(
      `<option value="${esc(candidate.id)}">${esc(shortcutName(candidate))} (${esc(scope)})</option>`
    );
  }
  return `<div class="card">
  <div class="ttl">${esc(l10n("configureRun.section.output"))}</div>
  <div class="field">
    <div class="lab">${esc(l10n("configureRun.label.extract"))}</div>
    <div class="desc">${esc(l10n("configure.extract.prompt"))}</div>
    <input type="text" class="mono" id="extract" placeholder="${esc(l10n("configure.extract.placeholder"))}" />
    <div class="invalid" id="extractInvalid">${esc(l10n("configure.extract.invalid"))}</div>
  </div>
  <div class="field">
    <div class="lab">${esc(l10n("configureRun.label.dependsOn"))}</div>
    <div class="desc">${esc(l10n("configure.dependsOn.placeholder"))}</div>
    <select id="dependsOn">${depOptions.join("")}</select>
  </div>
</div>`;
}

function behaviorCard(): string {
  const soundOpts = [
    { value: "default", key: "configure.sound.followDefault" },
    { value: "on", key: "configure.sound.on" },
    { value: "off", key: "configure.sound.off" },
  ]
    .map((o) => `<option value="${o.value}">${esc(l10n(o.key))}</option>`)
    .join("");
  return `<div class="card">
  <div class="ttl">${esc(l10n("configureRun.section.behavior"))}</div>
  <div class="field">
    <div class="lab">${esc(l10n("configureRun.label.sound"))}</div>
    <select id="sound">${soundOpts}</select>
  </div>
  <div class="opt">
    <div class="meta">
      <div class="lab">${esc(l10n("configureRun.label.runOnSave"))}</div>
      <div class="d">${esc(l10n("configureRun.runOnSave.desc"))}</div>
    </div>
    <div class="spacer"></div>
    <label class="switch"><input type="checkbox" id="runOnSave" /><span class="track"></span><span class="knob"></span></label>
  </div>
  <div class="opt">
    <div class="meta">
      <div class="lab">${esc(l10n("configureRun.label.concurrency"))}</div>
      <div class="d">${esc(l10n("configureRun.concurrency.desc"))}</div>
    </div>
    <div class="spacer"></div>
    <label class="switch"><input type="checkbox" id="concurrency" /><span class="track"></span><span class="knob"></span></label>
  </div>
  <div class="field" style="margin-top:12px">
    <div class="lab">${esc(l10n("configureRun.label.lock"))}</div>
    <div class="desc">${esc(l10n("configure.lock.prompt"))}</div>
    <input type="text" class="mono" id="lock" placeholder="${esc(l10n("configure.lock.placeholder"))}" />
  </div>
</div>`;
}

// Escape text destined for an HTML text node or a double-quoted attribute, so a shortcut
// label, path, or env value can never inject markup into the webview.
function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}
