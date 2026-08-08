import * as vscode from "vscode";

// Resolve the hex defaults for the extension's contributed tint colors
// (saropaWorkspace.tint.*) under the active color theme, so surfaces that cannot
// rely on --vscode-* CSS variables (webview panels) can fall back to the raw hex.
// The ThemeIcon/ThemeColor API resolves contributed colors natively, but webview CSS
// variables may not include them — this provides a host-side fallback.

const EXTENSION_ID = "saropa.saropa-workspace";
const TINT_PREFIX = "saropaWorkspace.tint.";

interface ContributedColor {
  id: string;
  defaults?: Record<string, string>;
}

function isContributedColor(v: unknown): v is ContributedColor {
  return typeof v === "object" && v !== null && typeof (v as ContributedColor).id === "string";
}

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

function resolveColorHexes(prefix?: string): Record<string, string> {
  const ext = vscode.extensions.getExtension(EXTENSION_ID);
  const raw = ext?.packageJSON?.contributes?.colors;
  if (!Array.isArray(raw)) {
    return {};
  }
  const key = themeDefaultsKey();
  const out: Record<string, string> = {};
  for (const entry of raw) {
    if (!isContributedColor(entry)) {
      continue;
    }
    if (prefix && !entry.id.startsWith(prefix)) {
      continue;
    }
    const hex = entry.defaults?.[key] ?? entry.defaults?.dark;
    if (hex) {
      out[entry.id] = hex;
    }
  }
  return out;
}

// Only the saropaWorkspace.tint.* entries.
export function resolveTintHexes(): Record<string, string> {
  return resolveColorHexes(TINT_PREFIX);
}

// ALL contributed color hexes, for the Customize panel's swatch display.
export function resolveAllColorHexes(): Record<string, string> {
  return resolveColorHexes();
}
