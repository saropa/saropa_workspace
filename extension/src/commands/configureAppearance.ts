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

// Curated codicon ids offered for a pin, grouped into scannable categories. A
// single grouped QuickPick (category separators + type-to-filter) replaces the old
// flat list — the user scans a category or types the icon name, instead of hunting
// one long unstructured wall. Every id is a valid VS Code product icon; the leading
// $(...) is added only for the QuickPick preview. Separators are rendered from each
// group's label (see pickIcon).
interface IconGroup {
  // l10n key for the category separator label.
  labelKey: string;
  ids: readonly string[];
}

const ICON_GROUPS: readonly IconGroup[] = [
  {
    labelKey: "appearance.iconGroup.files",
    ids: [
      "file", "file-code", "file-binary", "file-media", "files", "code",
      "json", "markdown", "notebook", "library", "symbol-class",
      "symbol-method", "symbol-namespace", "symbol-variable",
    ],
  },
  {
    labelKey: "appearance.iconGroup.run",
    ids: [
      "rocket", "play", "play-circle", "run-all", "debug-alt", "debug-start",
      "tools", "wrench", "gear", "settings-gear", "package", "checklist",
      "tasklist", "beaker", "bug",
    ],
  },
  {
    labelKey: "appearance.iconGroup.source",
    ids: [
      "github", "git-commit", "git-branch", "git-merge", "git-pull-request",
      "repo", "cloud", "cloud-upload", "cloud-download", "globe", "broadcast",
      "radio-tower", "sync",
    ],
  },
  {
    labelKey: "appearance.iconGroup.data",
    ids: [
      "database", "server", "server-process", "server-environment", "terminal",
      "terminal-bash", "terminal-powershell", "output", "debug-console", "vm",
      "plug",
    ],
  },
  {
    labelKey: "appearance.iconGroup.status",
    ids: [
      "pass", "error", "warning", "info", "bell", "shield", "lock", "unlock",
      "verified", "flame", "zap", "pulse", "thumbsup", "heart", "star-full",
    ],
  },
  {
    labelKey: "appearance.iconGroup.shapes",
    ids: [
      "circle-filled", "circle-large-filled", "primitive-square", "sparkle",
      "star-empty", "star-half", "color-mode", "symbol-color", "paintcan",
      "graph", "dashboard",
    ],
  },
  {
    labelKey: "appearance.iconGroup.objects",
    ids: [
      "book", "bookmark", "tag", "milestone", "target", "telescope", "key",
      "mail", "calendar", "clock", "history", "home", "organization", "person",
      "account", "location", "map", "mortar-board", "trophy", "gift",
    ],
  },
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
  // `value` is the chosen codicon id; undefined on the "default / clear" item.
  // Separator rows carry no value and are never selectable, so a returned pick is
  // always a real choice.
  interface IconItem extends vscode.QuickPickItem {
    value?: string;
  }
  const items: IconItem[] = [
    { label: l10n("appearance.icon.default"), value: undefined },
  ];
  for (const group of ICON_GROUPS) {
    items.push({
      label: l10n(group.labelKey),
      kind: vscode.QuickPickItemKind.Separator,
    });
    for (const id of group.ids) {
      items.push({ label: `$(${id}) ${id}`, value: id, picked: pin.icon === id });
    }
  }
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
