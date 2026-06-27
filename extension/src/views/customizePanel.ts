import * as vscode from "vscode";
import * as crypto from "crypto";
import { Shortcut } from "../model/shortcut";
import { ShortcutStore } from "../model/shortcutStore";
import { COLOR_CHOICES } from "../commands/configureAppearance";
import { ICON_CATEGORIES, ICON_KEYWORDS } from "./iconCatalog";
import { CUSTOMIZE_STYLE, CUSTOMIZE_SCRIPT } from "./customizeAssets";
import { l10n } from "../i18n/l10n";

// The Customize webview form — one screen to set a shortcut's NAME, ICON, COLOR, and
// TAGS at once, with a live preview of the tree row. It replaces hopping between the
// rename input, the two-step icon/color QuickPick, and the tag QuickPick; those granular
// commands stay available, but this is the unified editor.
//
// Two things the QuickPick could not do, fixed here:
//   - Colors render as real swatches. A QuickPick row cannot tint its glyph, so every
//     color showed the same foreground dot; here each swatch is its registered tint hex
//     (resolved for the active theme from the manifest — one source of truth).
//   - The icon picker shows the FULL codicon set (hundreds of glyphs) in a searchable,
//     categorized grid that renders the actual glyphs, instead of a short curated list.
//
// Rendering codicon glyphs in a webview needs the icon font shipped beside the bundle
// (esbuild copies it to dist/); the panel loads dist/codicon.css via asWebviewUri under a
// CSP that allows only the webview's own resource origin for styles/fonts — no network.
// A second open reuses the one panel, repointed at the new shortcut.

// The active theme's key into a contributed color's `defaults` map, so a swatch shows the
// same hex the tree icon will actually take in this theme.
function themeDefaultsKey(): "dark" | "light" | "highContrast" | "highContrastLight" {
  switch (vscode.window.activeColorTheme.kind) {
    case vscode.ColorThemeKind.Light:
      return "light";
    case vscode.ColorThemeKind.HighContrast:
      return "highContrast";
    case vscode.ColorThemeKind.HighContrastLight:
      return "highContrastLight";
    default:
      return "dark";
  }
}

interface SaveMessage {
  name?: string;
  icon?: string;
  color?: string;
  tags?: string[];
}

export class CustomizePanel {
  private static current: CustomizePanel | undefined;
  private static readonly viewType = "saropaWorkspace.customize";

  private readonly disposables: vscode.Disposable[] = [];
  private shortcutId: string;

  static show(context: vscode.ExtensionContext, store: ShortcutStore, shortcut: Shortcut): void {
    // Auto-shortcuts are recomputed each refresh and never stored, so name/icon/tags
    // cannot persist on them — same guard as the QuickPick editors.
    if (shortcut.isAuto) {
      vscode.window.showWarningMessage(l10n("appearance.autoUnsupported"));
      return;
    }
    const column = vscode.window.activeTextEditor?.viewColumn;
    if (CustomizePanel.current) {
      CustomizePanel.current.repoint(shortcut);
      CustomizePanel.current.panel.reveal(column);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      CustomizePanel.viewType,
      l10n("customize.title", { name: shortcutName(shortcut) }),
      column ?? vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        // The codicon font + stylesheet live in dist/; restrict the webview to load
        // local resources from there only.
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "dist")],
      }
    );
    CustomizePanel.current = new CustomizePanel(panel, context, store, shortcut);
  }

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly context: vscode.ExtensionContext,
    private readonly store: ShortcutStore,
    shortcut: Shortcut
  ) {
    this.shortcutId = shortcut.id;
    this.panel.webview.html = this.renderShell(shortcut);
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(
      (message: unknown) => void this.onMessage(message),
      null,
      this.disposables
    );
  }

  private repoint(shortcut: Shortcut): void {
    this.shortcutId = shortcut.id;
    this.panel.title = l10n("customize.title", { name: shortcutName(shortcut) });
    this.panel.webview.html = this.renderShell(shortcut);
  }

  private async onMessage(message: unknown): Promise<void> {
    if (typeof message !== "object" || message === null) {
      return;
    }
    const msg = message as { type?: string } & SaveMessage;
    switch (msg.type) {
      case "ready":
        await this.postInit();
        return;
      case "save":
        await this.save(msg);
        return;
      case "cancel":
        this.panel.dispose();
        return;
    }
  }

  private async postInit(): Promise<void> {
    const shortcut = this.store.findShortcut(this.shortcutId);
    if (!shortcut) {
      return;
    }
    await this.panel.webview.postMessage({
      type: "init",
      work: {
        name: shortcut.label ?? "",
        icon: shortcut.icon,
        color: shortcut.color,
        tags: shortcut.tags ?? [],
      },
    });
  }

  // Persist all four facets, then report a toast that names the shortcut by its NEW name
  // (renaming is one of the things this panel does, so the confirmation reflects it).
  private async save(msg: SaveMessage): Promise<void> {
    const shortcut = this.store.findShortcut(this.shortcutId);
    if (!shortcut) {
      vscode.window.showWarningMessage(l10n("appearance.autoUnsupported"));
      this.panel.dispose();
      return;
    }
    const rawName = (msg.name ?? "").trim();
    await this.store.renameShortcut(shortcut, rawName);

    // A color tints the icon, so it is meaningless without one — clear it when no icon is
    // chosen (matches the QuickPick's "clearing the icon clears the color" rule).
    const icon = msg.icon || undefined;
    const color = icon ? msg.color || undefined : undefined;
    await this.store.updateShortcutAppearance(shortcut, icon, color);

    await this.store.setShortcutTags(shortcut, Array.isArray(msg.tags) ? msg.tags : []);

    const finalName = rawName || shortcutName(shortcut);
    vscode.window.showInformationMessage(l10n("customize.saved", { name: finalName }));
    this.panel.dispose();
  }

  // ---- shell ------------------------------------------------------------

  private renderShell(shortcut: Shortcut): string {
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
    const name = shortcutName(shortcut);
    const title = l10n("customize.title", { name });
    const basename = shortcut.path.split("/").pop() ?? shortcut.path;

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<link href="${codiconUri}" rel="stylesheet" />
<title>${esc(title)}</title>
<style>${CUSTOMIZE_STYLE}</style>
</head>
<body>
<div class="hero">
  <div class="glyph"><span class="codicon codicon-paintcan"></span></div>
  <div class="htext">
    <h1>${esc(title)}</h1>
    <div class="sub">${esc(l10n("customize.subtitle", { name }))}</div>
  </div>
</div>

<div class="card">
  <div class="ttl">${esc(l10n("customize.section.name"))}</div>
  <div class="desc">${esc(l10n("customize.name.desc"))}</div>
  <input type="text" id="nameInput" placeholder="${esc(l10n("customize.name.placeholder"))}" />
</div>

${this.iconCard()}
${this.colorCard()}
${this.tagCard()}

<div class="footer">
  <span class="pl">${esc(l10n("customize.preview"))}</span>
  <div class="prow">
    <span class="pic codicon codicon-file" id="previewIcon"></span>
    <span class="pname" id="previewName" data-fallback="${esc(basename)}"></span>
  </div>
  <div class="spacer"></div>
  <button class="btn" id="cancel">${esc(l10n("customize.cancel"))}</button>
  <button class="btn primary" id="save">${esc(l10n("customize.save"))}</button>
</div>

<template id="tagChipTpl"><span class="chip"><span class="tname"></span><button class="x" type="button" aria-label="${esc(
      l10n("customize.tags.remove")
    )}">&#x2715;</button></span></template>

<script nonce="${nonce}">${CUSTOMIZE_SCRIPT}</script>
</body>
</html>`;
  }

  // The searchable, categorized icon grid. A standalone "default" group at the top holds
  // the clear-icon tile (it carries a def tile so search never hides it); every category
  // from the catalog follows, each tile rendering its real codicon glyph.
  private iconCard(): string {
    const defGroup = `<div class="group" data-label="">
    <div class="tiles">
      <button class="tile def sel" type="button" data-id="" title="${esc(
        l10n("customize.icon.default")
      )}"><span class="codicon codicon-discard"></span></button>
    </div>
  </div>`;

    const groups = ICON_CATEGORIES.map((cat) => {
      const label = l10n(`customize.iconGroup.${cat.id}`);
      const tiles = cat.ids
        .map((id) => {
          const kw = ICON_KEYWORDS[id] ?? "";
          return `<button class="tile" type="button" data-id="${esc(id)}" data-kw="${esc(
            kw
          )}" title="${esc(id)}"><span class="codicon codicon-${esc(id)}"></span></button>`;
        })
        .join("");
      return `<div class="group" data-label="${esc(label)}">
    <div class="grouphdr">${esc(label)}</div>
    <div class="tiles">${tiles}</div>
  </div>`;
    }).join("");

    return `<div class="card">
  <div class="ttl">${esc(l10n("customize.section.icon"))}</div>
  <div class="iconsearch">
    <input type="text" id="iconSearch" placeholder="${esc(l10n("customize.icon.search"))}" />
  </div>
  <div class="iconscroll">${defGroup}${groups}</div>
  <div class="iconempty" id="iconEmpty">${esc(l10n("customize.icon.none"))}</div>
</div>`;
  }

  // The color swatches, each its registered tint hex resolved for the active theme so the
  // swatch matches what the tree icon will take. The default swatch (no tint) leads.
  private colorCard(): string {
    const colors = this.resolveSwatchHexes();
    const defSwatch = `<button class="swatch def" type="button" data-color="" data-hex="" title="${esc(
      stripTokens(l10n("customize.color.default"))
    )}"><span class="codicon codicon-discard"></span></button>`;
    const swatches = COLOR_CHOICES.map((c) => {
      const hex = colors[c.id] ?? "";
      const label = stripTokens(l10n(c.key));
      return `<button class="swatch" type="button" data-color="${esc(c.id)}" data-hex="${esc(
        hex
      )}" style="background:${esc(hex)}" title="${esc(label)}"></button>`;
    }).join("");
    return `<div class="card">
  <div class="ttl">${esc(l10n("customize.section.color"))}</div>
  <div class="desc">${esc(l10n("customize.color.desc"))}</div>
  <div class="swatches">${defSwatch}${swatches}</div>
</div>`;
  }

  // Map each offered tint id to its hex for the active theme, read from the extension's
  // OWN manifest (contributes.colors) — the single source of truth for the palette, so a
  // swatch can never drift from the registered ThemeColor the tree uses.
  private resolveSwatchHexes(): Record<string, string> {
    const key = themeDefaultsKey();
    const colors = (this.context.extension.packageJSON?.contributes?.colors ?? []) as Array<{
      id: string;
      defaults?: Record<string, string>;
    }>;
    const out: Record<string, string> = {};
    for (const entry of colors) {
      const hex = entry.defaults?.[key] ?? entry.defaults?.dark;
      if (hex) {
        out[entry.id] = hex;
      }
    }
    return out;
  }

  private tagCard(): string {
    const inUse = this.store.tagsInUse();
    const suggest =
      inUse.length > 0
        ? `<div class="suggest"><span class="sl">${esc(l10n("customize.tags.suggestLabel"))}</span>${inUse
            .map(
              (t) =>
                `<button class="sugchip" type="button" data-tag="${esc(t)}">${esc(t)}</button>`
            )
            .join("")}</div>`
        : "";
    return `<div class="card">
  <div class="ttl">${esc(l10n("customize.section.tags"))}</div>
  <div class="desc">${esc(l10n("customize.tags.desc"))}</div>
  <div class="chips" id="tagList"></div>
  <div class="tagempty" id="tagEmpty">${esc(l10n("customize.tags.placeholder"))}</div>
  <input type="text" id="tagInput" placeholder="${esc(l10n("customize.tags.placeholder"))}" />
  ${suggest}
</div>`;
  }

  private dispose(): void {
    CustomizePanel.current = undefined;
    this.panel.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}

function shortcutName(shortcut: Shortcut): string {
  return shortcut.label ?? (shortcut.path.split("/").pop() ?? shortcut.path);
}

// Strip a leading $(codicon) token (and any inline ones) from a label. The color labels
// are shared with the QuickPick, where they carry a $(circle-filled) prefix that renders
// as a glyph; in the webview the swatch IS the color, so the bare name is wanted.
function stripTokens(label: string): string {
  return label.replace(/\$\([^)]*\)/g, "").trim();
}

// Escape text destined for an HTML text node or a double-quoted attribute, so a shortcut
// label, tag, icon id, or hex can never inject markup into the webview.
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
