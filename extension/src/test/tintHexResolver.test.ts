// Tests for the tint color lookups: the hex defaults per theme kind, the cache per kind, and the
// readable name of a tint.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as nodeFs from "node:fs";
import * as nodePath from "node:path";
import { ColorThemeKind, __setColorThemeKind, __setInstalledExtensions, __resetShell } from "./_stub/vscode";
import { resolveTintHexes, resolveAllColorHexes, tintDisplayName } from "../views/tintHexResolver";
import { COLOR_CHOICES } from "../commands/configureAppearance";
import { l10n } from "../i18n/l10n";

const EXTENSION_ID = "saropa.saropa-workspace";

function manifest(colors: unknown): { contributes: { colors: unknown } } {
  return { contributes: { colors } };
}

// The resolver keeps one cache slot keyed by theme kind, so a test that installs a new manifest
// first resolves under a different kind to evict the previous test's entry, then switches.
function useTheme(kind: number, colors: unknown, whole?: unknown): void {
  __setInstalledExtensions([EXTENSION_ID], whole ?? manifest(colors));
  __setColorThemeKind(kind === ColorThemeKind.Dark ? ColorThemeKind.Light : ColorThemeKind.Dark);
  resolveTintHexes();
  __setColorThemeKind(kind);
}

beforeEach(() => __resetShell());

afterEach(() => __resetShell());

test("the tint set holds only saropaWorkspace.tint ids; the full set holds every contributed color", () => {
  useTheme(ColorThemeKind.Light, [
    { id: "saropaWorkspace.tint.red", defaults: { dark: "#d", light: "#l", highContrast: "#h", highContrastLight: "#hl" } },
    { id: "saropaWorkspace.other", defaults: { light: "#o" } },
  ]);
  assert.deepEqual(resolveTintHexes(), { "saropaWorkspace.tint.red": "#l" });
  assert.deepEqual(resolveAllColorHexes(), { "saropaWorkspace.tint.red": "#l", "saropaWorkspace.other": "#o" });
});

test("each theme kind reads its own default and the cache follows a kind change", () => {
  const colors = [
    { id: "saropaWorkspace.tint.red", defaults: { dark: "#d", light: "#l", highContrast: "#h", highContrastLight: "#hl" } },
  ];
  const pick = (kind: number): string => {
    useTheme(kind, colors);
    return resolveTintHexes()["saropaWorkspace.tint.red"];
  };
  assert.deepEqual(
    [pick(ColorThemeKind.Dark), pick(ColorThemeKind.Light), pick(ColorThemeKind.HighContrast), pick(ColorThemeKind.HighContrastLight)],
    ["#d", "#l", "#h", "#hl"]
  );
});

test("a theme kind without its own default falls back to the dark one; no default means no entry", () => {
  useTheme(ColorThemeKind.HighContrastLight, [
    { id: "saropaWorkspace.tint.a", defaults: { dark: "#dark" } },
    { id: "saropaWorkspace.tint.b", defaults: {} },
    { id: "saropaWorkspace.tint.c" },
  ]);
  assert.deepEqual(resolveTintHexes(), { "saropaWorkspace.tint.a": "#dark" });
});

test("entries that are not objects with a string id are skipped", () => {
  useTheme(ColorThemeKind.HighContrast, [
    null, "x", 5, { id: 7, defaults: { dark: "#no" } }, { id: "saropaWorkspace.tint.ok", defaults: { highContrast: "#ok" } },
  ]);
  assert.deepEqual(resolveTintHexes(), { "saropaWorkspace.tint.ok": "#ok" });
});

test("a missing extension or a manifest with no colors list gives empty maps", () => {
  __resetShell();
  __setColorThemeKind(ColorThemeKind.Light);
  resolveTintHexes();
  __setColorThemeKind(ColorThemeKind.HighContrastLight);
  assert.deepEqual(resolveTintHexes(), {});
  useTheme(ColorThemeKind.Dark, "not a list");
  assert.deepEqual(resolveAllColorHexes(), {});
});

test("the real manifest declares a hex for every color choice the appearance picker offers", () => {
  const real = JSON.parse(nodeFs.readFileSync(nodePath.join(__dirname, "..", "..", "package.json"), "utf8"));
  useTheme(ColorThemeKind.Dark, undefined, real);
  const hexes = resolveTintHexes();
  for (const choice of COLOR_CHOICES) {
    assert.match(hexes[choice.id] ?? "", /^#[0-9A-Fa-f]{6}$/, choice.id);
  }
});

test("a tint name drops the leading icon from its label; an unknown id has no name", () => {
  const red = COLOR_CHOICES.find((c) => c.id === "saropaWorkspace.tint.red")!;
  assert.equal(l10n(red.key), "$(circle-filled) Red");
  assert.equal(tintDisplayName("saropaWorkspace.tint.red"), "Red");
  assert.equal(tintDisplayName("saropaWorkspace.tint.nope"), undefined);
});
