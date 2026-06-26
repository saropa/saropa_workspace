import { test } from "node:test";
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import { COLOR_CHOICES } from "../commands/configureAppearance";

// Parity guard for the shortcut/group icon tint palette. The offered colors live in
// three files that must agree: the COLOR_CHOICES list (what the picker shows), the
// registered theme colors in package.json (so a chosen ThemeColor id resolves), and
// the en.json labels (so each row renders text, not a blank). A drift in any one is
// invisible at compile time — a missing registration silently falls back to the
// default foreground, a missing label renders an empty row — so it is pinned here.
//
// Paths are resolved from the bundle location (out/test) up to the extension root,
// so the test does not depend on the runner's working directory.
const extensionRoot = path.join(__dirname, "..", "..");

function readJson(rel: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(extensionRoot, rel), "utf8"));
}

test("every offered tint is a namespaced saropaWorkspace.tint id", () => {
  for (const choice of COLOR_CHOICES) {
    assert.ok(
      choice.id.startsWith("saropaWorkspace.tint."),
      `tint id "${choice.id}" must be namespaced under saropaWorkspace.tint.`
    );
  }
});

test("offered tint ids are unique and the palette has 20 colors", () => {
  const ids = COLOR_CHOICES.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length, "tint ids must be unique");
  assert.equal(COLOR_CHOICES.length, 20, "the named palette ships 20 colors");
});

test("every offered tint is registered as a theme color in package.json", () => {
  const manifest = readJson("package.json") as {
    contributes?: { colors?: Array<{ id: string }> };
  };
  const registered = new Set(
    (manifest.contributes?.colors ?? []).map((c) => c.id)
  );
  for (const choice of COLOR_CHOICES) {
    assert.ok(
      registered.has(choice.id),
      `tint "${choice.id}" is offered but not registered in contributes.colors — its ThemeColor would not resolve`
    );
  }
});

test("every registered tint color is offered in the picker", () => {
  const manifest = readJson("package.json") as {
    contributes?: { colors?: Array<{ id: string }> };
  };
  const offered = new Set(COLOR_CHOICES.map((c) => c.id));
  // Only the tint.* colors are the user palette; any other contributed color
  // (none today) is not expected in the picker, so the check is scoped to tint.*.
  const registeredTints = (manifest.contributes?.colors ?? [])
    .map((c) => c.id)
    .filter((id) => id.startsWith("saropaWorkspace.tint."));
  for (const id of registeredTints) {
    assert.ok(
      offered.has(id),
      `tint "${id}" is registered but not offered in COLOR_CHOICES — an orphan color`
    );
  }
});

test("every offered tint has a label in en.json", () => {
  const catalog = readJson("src/i18n/locales/en.json");
  for (const choice of COLOR_CHOICES) {
    const label = catalog[choice.key];
    assert.equal(
      typeof label,
      "string",
      `tint "${choice.id}" references label key "${choice.key}", missing from en.json — the picker row would be blank`
    );
  }
});
