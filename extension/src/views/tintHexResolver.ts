import * as vscode from "vscode";
import { COLOR_CHOICES } from "../commands/configureAppearance";
import { l10n } from "../i18n/l10n";

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

// Per-theme-kind cache: the manifest is static for the extension's lifetime, so
// the resolved hexes only change when the active theme kind changes.
let tintCache: { themeKind: vscode.ColorThemeKind; tints: Record<string, string>; all: Record<string, string> } | undefined;

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

function ensureCache(): { tints: Record<string, string>; all: Record<string, string> } {
  const kind = vscode.window.activeColorTheme.kind;
  if (tintCache && tintCache.themeKind === kind) {
    return tintCache;
  }
  tintCache = {
    themeKind: kind,
    tints: resolveColorHexes(TINT_PREFIX),
    all: resolveColorHexes(),
  };
  return tintCache;
}

// Only the saropaWorkspace.tint.* entries.
export function resolveTintHexes(): Record<string, string> {
  return ensureCache().tints;
}

// ALL contributed color hexes, for the Customize panel's swatch display.
export function resolveAllColorHexes(): Record<string, string> {
  return ensureCache().all;
}

// Map a tint color ID to its human-readable name from l10n, stripping the
// codicon prefix (e.g. "$(circle-filled) Red" → "Red").
export function tintDisplayName(colorId: string): string | undefined {
  const choice = COLOR_CHOICES.find((c) => c.id === colorId);
  if (!choice) {
    return undefined;
  }
  const raw = l10n(choice.key);
  const stripped = raw.replace(/^\$\([^)]+\)\s*/, "");
  return stripped || raw;
}
