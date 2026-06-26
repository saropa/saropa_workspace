import * as vscode from "vscode";
import { Shortcut, ShortcutGroup, ShortcutScope } from "../model/shortcut";
import { ShortcutStore } from "../model/shortcutStore";
import { l10n } from "../i18n/l10n";

// Roadmap 5.1 — per-shortcut icon and color customization.
//
// A two-step QuickPick: pick a product-icon (codicon) from a curated set, then a
// theme color. Both offer a "default" choice to clear the override. Icons and
// colors are theme-aware sources (ThemeIcon / ThemeColor), never raw literals, so
// they render correctly in light, dark, and high-contrast themes.

// Curated codicon ids offered for a shortcut, grouped into scannable categories. A
// single grouped QuickPick (category separators + type-to-filter) replaces the old
// flat list — the user scans a category or types the icon name, instead of hunting
// one long unstructured wall. Every id is a valid VS Code product icon; the leading
// $(...) is added only for the QuickPick preview. Separators are rendered from each
// group's label (see pickIcon). Each id also carries a synonym list in the catalog
// (appearance.iconKeyword.<id>), shown as the row description and matched on, so an
// alternate word or a name finds the icon — one word may legitimately name several.
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
      "account", "location", "map", "mortar-board", "verified-filled", "gift",
    ],
  },
];

// A 20-swatch named palette, registered as custom theme colors in package.json
// (contributes.colors -> saropaWorkspace.tint.*). Each id carries explicit light /
// dark / high-contrast hex there, so a chosen tint resolves to a deliberate RGB in
// every theme — the built-in chart palette only offered ~7 hues with no control over
// the exact shade. Order runs around the hue wheel (warm -> cool -> neutral) so the
// QuickPick reads as a spectrum. The hex lives only in the manifest; this map names
// the id and its label key, never restating a color value (single source of truth).
// Pre-existing shortcuts saved with a `charts.*` id still render (that ThemeColor is
// still valid); they are simply not pre-selected here.
// Exported so a parity test can confirm every offered tint has a registered
// theme color (package.json contributes.colors) and a label (en.json) — the two
// cross-file drifts that would silently render a blank picker row or an
// unresolved tint.
export const COLOR_CHOICES: Array<{ id: string; key: string }> = [
  { id: "saropaWorkspace.tint.red", key: "appearance.color.red" },
  { id: "saropaWorkspace.tint.coral", key: "appearance.color.coral" },
  { id: "saropaWorkspace.tint.orange", key: "appearance.color.orange" },
  { id: "saropaWorkspace.tint.amber", key: "appearance.color.amber" },
  { id: "saropaWorkspace.tint.gold", key: "appearance.color.gold" },
  { id: "saropaWorkspace.tint.lime", key: "appearance.color.lime" },
  { id: "saropaWorkspace.tint.chartreuse", key: "appearance.color.chartreuse" },
  { id: "saropaWorkspace.tint.green", key: "appearance.color.green" },
  { id: "saropaWorkspace.tint.emerald", key: "appearance.color.emerald" },
  { id: "saropaWorkspace.tint.teal", key: "appearance.color.teal" },
  { id: "saropaWorkspace.tint.cyan", key: "appearance.color.cyan" },
  { id: "saropaWorkspace.tint.blue", key: "appearance.color.blue" },
  { id: "saropaWorkspace.tint.indigo", key: "appearance.color.indigo" },
  { id: "saropaWorkspace.tint.violet", key: "appearance.color.violet" },
  { id: "saropaWorkspace.tint.purple", key: "appearance.color.purple" },
  { id: "saropaWorkspace.tint.magenta", key: "appearance.color.magenta" },
  { id: "saropaWorkspace.tint.pink", key: "appearance.color.pink" },
  { id: "saropaWorkspace.tint.brown", key: "appearance.color.brown" },
  { id: "saropaWorkspace.tint.slate", key: "appearance.color.slate" },
  { id: "saropaWorkspace.tint.gray", key: "appearance.color.gray" },
];

export async function configureAppearance(store: ShortcutStore, shortcut: Shortcut): Promise<void> {
  // Auto-shortcuts are recomputed each refresh and not stored in pins[], so there is
  // nowhere to persist an icon/color; surface that rather than silently failing.
  if (shortcut.isAuto) {
    vscode.window.showWarningMessage(l10n("appearance.autoUnsupported"));
    return;
  }

  const name = shortcut.label ?? (shortcut.path.split("/").pop() ?? shortcut.path);
  const title = l10n("appearance.title", { name });

  const picked = await pickAppearance(shortcut.icon, shortcut.color, title);
  if (picked === CANCELED) {
    return;
  }
  await store.updateShortcutAppearance(shortcut, picked.icon, picked.color);
  vscode.window.showInformationMessage(l10n("appearance.saved", { name }));
}

// Edit a USER group's tree icon + tint (Roadmap 5.1, extended to groups). The same
// two-step picker the per-shortcut command uses, so the visual language is one set of
// glyphs/colors. Synthetic recipe groups are not stored anywhere editable, so the
// command is gated to user groups in the manifest and guarded here as well.
export async function configureGroupAppearance(
  store: ShortcutStore,
  group: ShortcutGroup,
  scope: ShortcutScope
): Promise<void> {
  const name = group.label;
  const title = l10n("appearance.group.title", { name });

  const picked = await pickAppearance(group.icon, group.color, title);
  if (picked === CANCELED) {
    return;
  }
  await store.updateGroupAppearance(group, scope, picked.icon, picked.color);
  vscode.window.showInformationMessage(l10n("appearance.group.saved", { name }));
}

// The shared two-step flow: pick a glyph, then (only when a glyph remains) a tint.
// Returns the chosen pair, or CANCELED when the user dismissed either step. Clearing
// the icon clears the color too, so no orphan tint persists on a glyph-less item.
async function pickAppearance(
  currentIcon: string | undefined,
  currentColor: string | undefined,
  title: string
): Promise<{ icon: string | undefined; color: string | undefined } | typeof CANCELED> {
  const icon = await pickIcon(currentIcon, title);
  if (icon === CANCELED) {
    return CANCELED;
  }
  if (icon === undefined) {
    return { icon: undefined, color: undefined };
  }
  const color = await pickColor(currentColor, title);
  if (color === CANCELED) {
    return CANCELED;
  }
  return { icon, color };
}

// Sentinel distinguishing "Esc / canceled" (abort, persist nothing) from
// "chose default" (undefined, clears the override).
const CANCELED = Symbol("canceled");

async function pickIcon(
  currentIcon: string | undefined,
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
      // The codicon id alone is a poor search term — "cog"/"preferences" won't
      // surface "gear", "octocat" won't surface "github". Each id carries a
      // synonym list (appearance.iconKeyword.<id>) shown as the row description,
      // so typing an alternate word — or a name like "octocat" — finds the icon.
      // The same synonym set may name several icons (e.g. "settings" matches both
      // gear and settings-gear); that overlap is intended. matchOnDescription on
      // the QuickPick makes the description filterable.
      items.push({
        label: `$(${id}) ${id}`,
        description: l10n(`appearance.iconKeyword.${id}`),
        value: id,
        picked: currentIcon === id,
      });
    }
  }
  const pick = await vscode.window.showQuickPick(items, {
    title,
    placeHolder: l10n("appearance.icon.placeholder"),
    matchOnDescription: true,
  });
  return pick ? pick.value : CANCELED;
}

async function pickColor(
  currentColor: string | undefined,
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
      picked: currentColor === c.id,
    })),
  ];
  const pick = await vscode.window.showQuickPick(items, {
    title,
    placeHolder: l10n("appearance.color.placeholder"),
  });
  return pick ? pick.value : CANCELED;
}
