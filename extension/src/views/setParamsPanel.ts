import * as vscode from "vscode";
import * as crypto from "crypto";
import { Shortcut } from "../model/shortcut";
import { getInteractiveTokens, InteractiveToken } from "../exec/promptTokens";
import { promptMemory } from "../exec/promptMemory";
import { shortcutName } from "./configureRunShell";
import { CONFIGURE_RUN_STYLE } from "./configureRunAssets";
import { l10n } from "../i18n/l10n";

// The "Set Params" webview: edits a shortcut's remembered interactive-token values
// (${prompt:...} / ${pick:...} / ${pickFolder:...}) directly, without running it.
// Exists because runLibraryScript and, for a pin, "Run with Last Parameters" both
// resolve tokens from promptMemory and reuse them silently thereafter (see
// scriptRunner.ts) — a bundled script is meant to be configured once and rerun with
// no further prompts. Without this editor the only way to change an already-answered
// value is to run the shortcut again and answer differently (organize-output) or clear
// extension storage by hand. One field per detected token: a text box for `prompt`, a
// dropdown for `pick`, and a text box + Browse button for `pickFolder`. Save writes
// straight to promptMemory; Cancel discards.
//
// Local-only and safe (native-first / webview rules): a strict CSP with a per-load
// nonce, no remote/bundled resource, themed via --vscode-* variables — reuses
// CONFIGURE_RUN_STYLE wholesale for `.card`/`.field`/`.btn`/`.footer` so this reads as
// the same family as the Configure Run form rather than a one-off look. Field data is
// never embedded in the initial HTML (a folder path or label could in principle
// contain `</script>` or an unescaped quote) — it is posted to the client after a
// `ready` handshake, the same protocol ConfigureRunPanel uses, so the markup stays a
// static shell with no per-shortcut string ever concatenated into executable JS.

// The wire shape for one token row, built host-side so the client carries no logic
// about token kinds or where a remembered value comes from.
interface FieldWire {
  raw: string;
  kind: InteractiveToken["kind"];
  label: string;
  value: string;
  // "pick" only: the fixed option list to render as a <select>.
  options?: string[];
  // "pickFolder" only: the Browse button's host-localized label (the client
  // carries no display strings of its own).
  browseLabel?: string;
}

export class SetParamsPanel {
  private static current: SetParamsPanel | undefined;
  private static readonly viewType = "saropaWorkspace.setParams";

  private readonly disposables: vscode.Disposable[] = [];
  private shortcut: Shortcut;

  // Opens (or repoints) the singleton panel for `shortcut`. A shortcut with no
  // interactive tokens has nothing to set — surfaced as a named toast instead of an
  // empty form, so the command is safe to offer on every shortcut without a
  // contextValue gate distinguishing "has tokens" from "does not".
  static show(shortcut: Shortcut): void {
    if (getInteractiveTokens(shortcut).length === 0) {
      void vscode.window.showInformationMessage(
        l10n("setParams.none", { name: shortcutName(shortcut) })
      );
      return;
    }
    const column = vscode.window.activeTextEditor?.viewColumn;
    if (SetParamsPanel.current) {
      SetParamsPanel.current.repoint(shortcut);
      SetParamsPanel.current.panel.reveal(column);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      SetParamsPanel.viewType,
      l10n("setParams.title", { name: shortcutName(shortcut) }),
      column ?? vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true }
    );
    SetParamsPanel.current = new SetParamsPanel(panel, shortcut);
  }

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    shortcut: Shortcut
  ) {
    this.shortcut = shortcut;
    this.panel.webview.html = this.renderShell(shortcut);
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(
      (message: unknown) => void this.onMessage(message),
      null,
      this.disposables
    );
  }

  private repoint(shortcut: Shortcut): void {
    this.shortcut = shortcut;
    this.panel.title = l10n("setParams.title", { name: shortcutName(shortcut) });
    this.panel.webview.html = this.renderShell(shortcut);
  }

  // ---- message protocol -------------------------------------------------

  private async onMessage(message: unknown): Promise<void> {
    if (typeof message !== "object" || message === null) {
      return;
    }
    const msg = message as {
      type?: string;
      raw?: string;
      values?: Record<string, string>;
    };
    switch (msg.type) {
      case "ready":
        await this.postInit();
        return;
      case "browse":
        if (typeof msg.raw === "string") {
          await this.onBrowse(msg.raw);
        }
        return;
      case "save":
        if (msg.values) {
          await this.save(msg.values);
        }
        return;
      case "cancel":
        this.panel.dispose();
        return;
    }
  }

  // Post the current shortcut's fields once the client signals it is ready to
  // receive them — mirrors ConfigureRunPanel's postInit, so no per-shortcut data
  // is ever embedded directly into the HTML string.
  private async postInit(): Promise<void> {
    const tokens = getInteractiveTokens(this.shortcut);
    const fields: FieldWire[] = tokens.map((token) => ({
      raw: token.raw,
      kind: token.kind,
      label: token.arg || l10n("prompt.inputFallback"),
      value: promptMemory.getValue(this.shortcut.id, token.raw) ?? "",
      options:
        token.kind === "pick"
          ? token.arg
              .split(",")
              .map((o) => o.trim())
              .filter((o) => o.length > 0)
          : undefined,
      browseLabel:
        token.kind === "pickFolder" ? l10n("prompt.pickFolderOpenLabel") : undefined,
    }));
    await this.panel.webview.postMessage({ type: "init", fields });
  }

  // Browse for a pickFolder field's value from the panel (mirrors the run-time
  // ${pickFolder:...} dialog in promptTokens.ts), defaulting to the workspace root.
  private async onBrowse(raw: string): Promise<void> {
    const picked = await vscode.window.showOpenDialog({
      canSelectMany: false,
      canSelectFiles: false,
      canSelectFolders: true,
      defaultUri: vscode.workspace.workspaceFolders?.[0]?.uri,
      openLabel: l10n("prompt.pickFolderOpenLabel"),
      title: l10n("prompt.pickFolderFallback"),
    });
    if (!picked || picked.length === 0) {
      return;
    }
    await this.panel.webview.postMessage({
      type: "browsed",
      raw,
      value: picked[0].fsPath,
    });
  }

  // Persist every submitted field straight to promptMemory (no run involved) and
  // close, with a toast naming the shortcut so the save is never silent.
  private async save(values: Record<string, string>): Promise<void> {
    const map = new Map(Object.entries(values));
    await promptMemory.remember(this.shortcut.id, map);
    vscode.window.showInformationMessage(
      l10n("setParams.saved", { name: shortcutName(this.shortcut) })
    );
    this.panel.dispose();
  }

  private dispose(): void {
    SetParamsPanel.current = undefined;
    this.panel.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
  }

  // ---- markup -------------------------------------------------------------

  // A static shell with no per-shortcut data embedded — every field row is built
  // client-side from the `init` message posted by postInit() after `ready`.
  private renderShell(shortcut: Shortcut): string {
    const nonce = crypto.randomBytes(16).toString("base64");
    const csp = [
      "default-src 'none'",
      "img-src 'none'",
      "style-src 'unsafe-inline'",
      `script-src 'nonce-${nonce}'`,
    ].join("; ");
    const name = shortcutName(shortcut);
    const title = l10n("setParams.title", { name });

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${esc(title)}</title>
<style>${CONFIGURE_RUN_STYLE}
.fieldrow { display: flex; gap: 8px; align-items: center; }
.fieldrow input[type="text"] { flex: 1; }
</style>
</head>
<body>
<div class="hero">
  <div class="glyph">&#x2699;</div>
  <div class="htext">
    <h1>${esc(title)}</h1>
    <div class="sub">${esc(l10n("setParams.subtitle", { name }))}</div>
  </div>
</div>

<div class="card" id="fields"></div>

<div class="footer">
  <div class="spacer"></div>
  <button class="btn" id="cancel">${esc(l10n("setParams.cancel"))}</button>
  <button class="btn primary" id="save">${esc(l10n("setParams.save"))}</button>
</div>

<script nonce="${nonce}">${SET_PARAMS_SCRIPT}</script>
</body>
</html>`;
  }
}

// Client renderer. Carries no display strings of its own (the Browse button reuses
// the field's host-supplied label convention below) — waits for `init`, builds one
// row per field by kind, posts `browse`/`save`/`cancel` intents back to the host.
const SET_PARAMS_SCRIPT = `
(function () {
  const vscode = acquireVsCodeApi();
  const container = document.getElementById("fields");
  const saveBtn = document.getElementById("save");
  let inputs = [];

  function makeRow(field) {
    const wrap = document.createElement("div");
    wrap.className = "field";
    const lab = document.createElement("div");
    lab.className = "lab";
    lab.textContent = field.label;
    wrap.appendChild(lab);

    const row = document.createElement("div");
    row.className = "fieldrow";

    let input;
    if (field.kind === "pick") {
      input = document.createElement("select");
      for (const opt of field.options || []) {
        const o = document.createElement("option");
        o.value = opt;
        o.textContent = opt;
        if (opt === field.value) {
          o.selected = true;
        }
        input.appendChild(o);
      }
    } else {
      input = document.createElement("input");
      input.type = "text";
      input.value = field.value;
      if (field.kind === "pickFolder") {
        input.readOnly = true;
      }
    }
    input.dataset.raw = field.raw;
    input.addEventListener("input", updateSaveState);
    row.appendChild(input);

    if (field.kind === "pickFolder") {
      const browse = document.createElement("button");
      browse.type = "button";
      browse.className = "btn";
      browse.textContent = field.browseLabel;
      browse.addEventListener("click", function () {
        vscode.postMessage({ type: "browse", raw: field.raw });
      });
      row.appendChild(browse);
    }

    wrap.appendChild(row);
    return { wrap: wrap, input: input };
  }

  function updateSaveState() {
    saveBtn.disabled = inputs.some(function (i) { return i.value.trim() === ""; });
  }

  window.addEventListener("message", function (event) {
    const msg = event.data;
    if (msg.type === "init") {
      container.innerHTML = "";
      inputs = msg.fields.map(function (field) {
        const row = makeRow(field);
        container.appendChild(row.wrap);
        return row.input;
      });
      updateSaveState();
    } else if (msg.type === "browsed") {
      const target = inputs.find(function (i) { return i.dataset.raw === msg.raw; });
      if (target) {
        target.value = msg.value;
        updateSaveState();
      }
    }
  });

  saveBtn.addEventListener("click", function () {
    const values = {};
    for (const input of inputs) {
      values[input.dataset.raw] = input.value;
    }
    vscode.postMessage({ type: "save", values: values });
  });
  document.getElementById("cancel").addEventListener("click", function () {
    vscode.postMessage({ type: "cancel" });
  });

  vscode.postMessage({ type: "ready" });
})();
`;

// Escape text destined for an HTML text node or a double-quoted attribute — mirrors
// configureRunShell.ts's esc(), duplicated locally to keep this panel a single
// self-contained file (its markup is a fraction of Configure Run's size).
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
