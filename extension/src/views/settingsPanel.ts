import * as vscode from "vscode";
import * as crypto from "crypto";
import { SETTINGS_STYLE, SETTINGS_SCRIPT } from "./settingsAssets";
import { l10n } from "../i18n/l10n";
// Local alias keeps every `esc(...)` call site in this file unchanged; the escaping
// algorithm itself is centralized (BUG-012).
import { escapeHtml as esc } from "../utils/escapeHtml";

// Settings webview panel — a single screen surfacing every saropaWorkspace.*
// configuration property with its current value, an info icon explaining what it
// does, and an appropriate control (toggle, number, text, select). Changes apply
// immediately via vscode.workspace.getConfiguration().update(); the panel is a
// live editor, not a save/cancel form.

// The settings the panel surfaces, organized into sections. Each entry maps a
// VS Code configuration key to a control type and its l10n label key. The info
// description is read at render time from the manifest's contributes.configuration
// metadata so it stays in sync with the single source of truth in package.json.

interface SettingDef {
  readonly key: string;
  readonly labelKey: string;
  readonly type: "boolean" | "number" | "string" | "select";
  readonly options?: readonly string[];
}

interface SettingSection {
  readonly titleKey: string;
  readonly settings: readonly SettingDef[];
}

const SECTIONS: readonly SettingSection[] = [
  {
    titleKey: "settings.section.general",
    settings: [
      { key: "doubleClickMs", labelKey: "settings.doubleClickMs", type: "number" },
      { key: "previewMode.enabled", labelKey: "settings.previewMode", type: "boolean" },
      { key: "configDir", labelKey: "settings.configDir", type: "string" },
      { key: "defaultGroups.enabled", labelKey: "settings.defaultGroups", type: "boolean" },
      { key: "branchAware.enabled", labelKey: "settings.branchAware", type: "boolean" },
    ],
  },
  {
    titleKey: "settings.section.display",
    settings: [
      { key: "displayNames.titleCase", labelKey: "settings.displayNames.titleCase", type: "boolean" },
    ],
  },
  {
    titleKey: "settings.section.terminal",
    settings: [
      { key: "defaultUseIntegratedTerminal", labelKey: "settings.useTerminal", type: "boolean" },
      { key: "terminalName", labelKey: "settings.terminalName", type: "string" },
      { key: "showRunToasts", labelKey: "settings.showRunToasts", type: "boolean" },
    ],
  },
  {
    titleKey: "settings.section.suggestions",
    settings: [
      { key: "suggestions.enabled", labelKey: "settings.suggestions", type: "boolean" },
      { key: "suggestions.openThreshold", labelKey: "settings.suggestThreshold", type: "number" },
      { key: "suggestions.debounceMinutes", labelKey: "settings.suggestDebounce", type: "number" },
      { key: "suggestPinnedTab.enabled", labelKey: "settings.suggestPinnedTab", type: "boolean" },
      { key: "suggestPinnedTab.afterHours", labelKey: "settings.suggestPinnedTabHours", type: "number" },
    ],
  },
  {
    titleKey: "settings.section.recipes",
    settings: [
      { key: "recipes.enabled", labelKey: "settings.recipes", type: "boolean" },
      { key: "recommend.aggressive", labelKey: "settings.recommendAggressive", type: "boolean" },
      { key: "showScheduleStatusBar", labelKey: "settings.scheduleStatusBar", type: "boolean" },
      { key: "scheduleStatusBarLeadMinutes", labelKey: "settings.scheduleLeadMinutes", type: "number" },
    ],
  },
  {
    titleKey: "settings.section.sound",
    settings: [
      { key: "sound.enabled", labelKey: "settings.soundEnabled", type: "boolean" },
      { key: "sound.onStart", labelKey: "settings.soundOnStart", type: "boolean" },
      { key: "sound.onSuccess", labelKey: "settings.soundOnSuccess", type: "boolean" },
      { key: "sound.onFailure", labelKey: "settings.soundOnFailure", type: "boolean" },
    ],
  },
  {
    titleKey: "settings.section.monitor",
    settings: [
      { key: "processMonitor.heartbeat.enabled", labelKey: "settings.heartbeat", type: "boolean" },
      { key: "processMonitor.heartbeat.intervalMinutes", labelKey: "settings.heartbeatInterval", type: "number" },
      { key: "processMonitor.ramCeilingMB", labelKey: "settings.ramCeiling", type: "number" },
      { key: "processMonitor.helperCountCeiling", labelKey: "settings.helperCeiling", type: "number" },
    ],
  },
  {
    titleKey: "settings.section.hygiene",
    settings: [
      { key: "hygiene.mode", labelKey: "settings.hygieneMode", type: "select", options: ["empty", "oversized", "both"] },
      { key: "hygiene.fileMaxMB", labelKey: "settings.hygieneFileMax", type: "number" },
      { key: "hygiene.folderMaxMB", labelKey: "settings.hygieneFolderMax", type: "number" },
      { key: "hygiene.fileMinMB", labelKey: "settings.hygieneFileMin", type: "number" },
      { key: "hygiene.respectGitignore", labelKey: "settings.hygieneGitignore", type: "boolean" },
      { key: "hygiene.bloat.folderCeilingMB", labelKey: "settings.bloatFolderCeiling", type: "number" },
      { key: "hygiene.bloat.fileCountCeiling", labelKey: "settings.bloatFileCeiling", type: "number" },
    ],
  },
  {
    titleKey: "settings.section.projectFiles",
    settings: [
      { key: "projectFiles.enabled", labelKey: "settings.projectFiles", type: "boolean" },
    ],
  },
  {
    titleKey: "settings.section.advanced",
    settings: [
      { key: "aiContext.enabled", labelKey: "settings.aiContext", type: "boolean" },
      { key: "telemetry.enabled", labelKey: "settings.telemetry", type: "boolean" },
    ],
  },
];

const KNOWN_KEYS = new Set(
  SECTIONS.flatMap((s) => s.settings.map((d) => d.key))
);

export class SettingsPanel {
  private static current: SettingsPanel | undefined;
  private static readonly viewType = "saropaWorkspace.settings";

  private readonly disposables: vscode.Disposable[] = [];

  static show(context: vscode.ExtensionContext): void {
    const column = vscode.window.activeTextEditor?.viewColumn;
    if (SettingsPanel.current) {
      SettingsPanel.current.panel.reveal(column);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      SettingsPanel.viewType,
      l10n("settings.title"),
      column ?? vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "dist")],
      }
    );
    SettingsPanel.current = new SettingsPanel(panel, context);
  }

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly context: vscode.ExtensionContext
  ) {
    this.panel.webview.html = this.renderShell();
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(
      (message: unknown) => void this.onMessage(message),
      null,
      this.disposables
    );
  }

  private async onMessage(message: unknown): Promise<void> {
    if (typeof message !== "object" || message === null) {
      return;
    }
    const msg = message as { type?: string; key?: string; value?: unknown };
    switch (msg.type) {
      case "ready":
        await this.postInit();
        return;
      case "change":
        if (typeof msg.key === "string") {
          await this.applySetting(msg.key, msg.value);
        }
        return;
      case "close":
        this.panel.dispose();
        return;
    }
  }

  private async postInit(): Promise<void> {
    const cfg = vscode.workspace.getConfiguration("saropaWorkspace");
    const settings: Record<string, unknown> = {};
    for (const section of SECTIONS) {
      for (const def of section.settings) {
        settings[def.key] = cfg.get(def.key);
      }
    }
    await this.panel.webview.postMessage({ type: "init", settings });
  }

  private async applySetting(key: string, value: unknown): Promise<void> {
    if (!KNOWN_KEYS.has(key)) {
      return;
    }
    const cfg = vscode.workspace.getConfiguration("saropaWorkspace");
    try {
      await cfg.update(key, value, vscode.ConfigurationTarget.Global);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      void vscode.window.showErrorMessage(
        l10n("settings.updateFailed", { key, error: msg })
      );
      // The webview applied the new value optimistically (control updates on
      // "change" before the write is confirmed). Since cfg.update() rejected,
      // the persisted value never changed, so the control must be reverted to
      // the still-current configuration value or it would show a value that
      // was never actually saved.
      await this.panel.webview.postMessage({
        type: "revertSetting",
        key,
        value: cfg.get(key),
      });
    }
  }

  // ---- rendering --------------------------------------------------------

  private renderShell(): string {
    const webview = this.panel.webview;
    const nonce = crypto.randomBytes(16).toString("base64");
    const codiconUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "dist", "codicon.css")
    );
    const csp = [
      "default-src 'none'",
      "img-src 'none'",
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `font-src ${webview.cspSource}`,
      `script-src 'nonce-${nonce}'`,
    ].join("; ");
    const title = l10n("settings.title");
    const meta = this.loadSchemaMeta();

    const sectionCards = SECTIONS.map((section) => {
      const rows = section.settings.map((def) => {
        const label = l10n(def.labelKey);
        const m = meta[`saropaWorkspace.${def.key}`];
        return this.renderSettingRow(def, label, m?.desc ?? "", m?.min, m?.max);
      }).join("");
      return `<div class="card">
  <div class="ttl">${esc(l10n(section.titleKey))}</div>
  ${rows}
</div>`;
    }).join("");

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<link href="${codiconUri}" rel="stylesheet" />
<title>${esc(title)}</title>
<style>${SETTINGS_STYLE}</style>
</head>
<body>
<div class="hero">
  <div class="glyph"><span class="codicon codicon-settings-gear"></span></div>
  <div class="htext">
    <h1>${esc(title)}</h1>
    <div class="sub">${esc(l10n("settings.subtitle"))}</div>
  </div>
</div>

<div class="search-bar">
  <span class="codicon codicon-search search-icon"></span>
  <input type="text" id="settingsSearch" placeholder="${esc(l10n("settings.searchPlaceholder"))}" />
</div>

${sectionCards}

<div class="footer">
  <button class="btn primary" id="close">${esc(l10n("settings.close"))}</button>
</div>

<div class="info-tip" id="infoTip"></div>

<script nonce="${nonce}">${SETTINGS_SCRIPT}</script>
</body>
</html>`;
  }

  private renderSettingRow(def: SettingDef, label: string, desc: string, min?: number, max?: number): string {
    const tipAttr = desc ? ` data-tip="${esc(desc)}"` : "";
    const infoIcon = `<span class="info-icon" tabindex="0" role="button" aria-label="Info"${tipAttr}>i</span>`;
    let control: string;
    switch (def.type) {
      case "boolean":
        control = `<label class="toggle"><input type="checkbox" data-key="${esc(def.key)}" /><span class="slider"></span></label>`;
        break;
      case "number": {
        const minAttr = min !== undefined ? ` min="${min}"` : ' min="0"';
        const maxAttr = max !== undefined ? ` max="${max}"` : "";
        control = `<input type="number"${minAttr}${maxAttr} data-key="${esc(def.key)}" />`;
        break;
      }
      case "string":
        control = `<input type="text" class="setting-input" data-key="${esc(def.key)}" />`;
        break;
      case "select":
        control = `<select data-key="${esc(def.key)}">${(def.options ?? []).map(
          (o) => `<option value="${esc(o)}">${esc(o)}</option>`
        ).join("")}</select>`;
        break;
    }
    return `<div class="setting">
  <div class="slabel">
    <div class="sname">${esc(label)} ${infoIcon}</div>
  </div>
  <div class="scontrol">${control}</div>
</div>`;
  }

  private loadSchemaMeta(): Record<string, { desc?: string; min?: number; max?: number }> {
    const out: Record<string, { desc?: string; min?: number; max?: number }> = {};
    const configs = this.context.extension.packageJSON?.contributes?.configuration;
    if (!Array.isArray(configs)) {
      return out;
    }
    for (const cfg of configs) {
      const props = cfg.properties;
      if (typeof props !== "object" || props === null) {
        continue;
      }
      for (const [key, schema] of Object.entries(props)) {
        const s = schema as { description?: string; minimum?: number; maximum?: number };
        out[key] = {
          desc: typeof s.description === "string" ? s.description : undefined,
          min: typeof s.minimum === "number" ? s.minimum : undefined,
          max: typeof s.maximum === "number" ? s.maximum : undefined,
        };
      }
    }
    return out;
  }

  private dispose(): void {
    SettingsPanel.current = undefined;
    this.panel.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}
