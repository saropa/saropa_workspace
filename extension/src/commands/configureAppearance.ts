import * as vscode from "vscode";
import { Pin } from "../model/pin";
import { PinStore } from "../model/pinStore";
import { l10n } from "../i18n/l10n";

// Roadmap 5.1 — per-pin icon and color customization.
//
// A two-step QuickPick: pick a product-icon (codicon) from a curated set, then a
// theme color. Both offer a "default" choice to clear the override. Icons and
// colors are theme-aware sources (ThemeIcon / ThemeColor), never raw literals, so
// they render correctly in light, dark, and high-contrast themes.

// Curated codicon ids offered for a pin. Kept to a useful, recognizable subset
// rather than the full set, so the pick stays scannable. Each is a valid VS Code
// product icon; the leading $(...) is added only for the QuickPick preview.
const ICON_CHOICES = [
  "rocket", "play-circle", "beaker", "bug", "tools", "wrench", "gear",
  "terminal", "database", "cloud", "package", "server", "globe", "dashboard",
  "checklist", "book", "flame", "zap", "star-full", "heart", "symbol-event",
  "debug-alt", "file-code", "folder-active",
];

// Curated theme-color ids that exist across built-in themes (the chart palette),
// so a chosen tint always resolves.
const COLOR_CHOICES: Array<{ id: string; key: string }> = [
  { id: "charts.red", key: "appearance.color.red" },
  { id: "charts.orange", key: "appearance.color.orange" },
  { id: "charts.yellow", key: "appearance.color.yellow" },
  { id: "charts.green", key: "appearance.color.green" },
  { id: "charts.blue", key: "appearance.color.blue" },
  { id: "charts.purple", key: "appearance.color.purple" },
  { id: "charts.foreground", key: "appearance.color.neutral" },
];

export async function configureAppearance(store: PinStore, pin: Pin): Promise<void> {
  // Auto-pins are recomputed each refresh and not stored in pins[], so there is
  // nowhere to persist an icon/color; surface that rather than silently failing.
  if (pin.isAuto) {
    vscode.window.showWarningMessage(l10n("appearance.autoUnsupported"));
    return;
  }

  const name = pin.label ?? (pin.path.split("/").pop() ?? pin.path);
  const title = l10n("appearance.title", { name });

  const icon = await pickIcon(pin, title);
  if (icon === CANCELED) {
    return;
  }
  // Color only matters when there is a glyph to tint; if the icon was cleared,
  // clear the color too so no orphan tint persists.
  let color: string | undefined;
  if (icon !== undefined) {
    const picked = await pickColor(pin, title);
    if (picked === CANCELED) {
      return;
    }
    color = picked;
  }

  await store.updatePinAppearance(pin, icon, color);
  vscode.window.showInformationMessage(l10n("appearance.saved", { name }));
}

// Sentinel distinguishing "Esc / canceled" (abort, persist nothing) from
// "chose default" (undefined, clears the override).
const CANCELED = Symbol("canceled");

async function pickIcon(
  pin: Pin,
  title: string
): Promise<string | undefined | typeof CANCELED> {
  interface IconItem extends vscode.QuickPickItem {
    value: string | undefined;
  }
  const items: IconItem[] = [
    { label: l10n("appearance.icon.default"), value: undefined },
    ...ICON_CHOICES.map((id) => ({
      label: `$(${id}) ${id}`,
      value: id,
      picked: pin.icon === id,
    })),
  ];
  const pick = await vscode.window.showQuickPick(items, {
    title,
    placeHolder: l10n("appearance.icon.placeholder"),
  });
  return pick ? pick.value : CANCELED;
}

async function pickColor(
  pin: Pin,
  title: string
): Promise<string | undefined | typeof CANCELED> {
  interface ColorItem extends vscode.QuickPickItem {
    value: string | undefined;
  }
  const items: ColorItem[] = [
    { label: l10n("appearance.color.default"), value: undefined },
    ...COLOR_CHOICES.map((c) => ({
      label: l10n(c.key),
      value: c.id,
      picked: pin.color === c.id,
    })),
  ];
  const pick = await vscode.window.showQuickPick(items, {
    title,
    placeHolder: l10n("appearance.color.placeholder"),
  });
  return pick ? pick.value : CANCELED;
}
