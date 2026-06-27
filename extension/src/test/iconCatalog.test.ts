// Parity guard for the Customize panel's icon catalog. The catalog is generated from the
// @vscode/codicons metadata and drives a grouped, searchable grid; three cross-file
// invariants must hold or the panel silently degrades:
//   - every category id maps to a customize.iconGroup.<id> label (else a blank group header),
//   - every offered icon id has a search-keyword entry (else it is unfindable by keyword),
//   - the icon ids are unique across categories (a duplicate would render the same glyph twice).
// These read pure data (no vscode host), so they run under node --test.

import { test } from "node:test";
import assert from "node:assert/strict";
import en from "../i18n/locales/en.json";
import { ICON_CATEGORIES, ICON_KEYWORDS, ALL_ICON_IDS } from "../views/iconCatalog";

const catalog = en as Record<string, string>;

test("every icon category has a customize.iconGroup label", () => {
  for (const cat of ICON_CATEGORIES) {
    const key = `customize.iconGroup.${cat.id}`;
    assert.equal(
      typeof catalog[key],
      "string",
      `category "${cat.id}" has no label key "${key}" — its group header would be blank`
    );
  }
});

test("every offered icon id has a search-keyword entry", () => {
  for (const id of ALL_ICON_IDS) {
    assert.equal(
      typeof ICON_KEYWORDS[id],
      "string",
      `icon "${id}" has no ICON_KEYWORDS entry — it would be findable only by exact id`
    );
  }
});

test("icon ids are unique across categories", () => {
  const seen = new Set<string>();
  for (const id of ALL_ICON_IDS) {
    assert.ok(!seen.has(id), `icon id "${id}" appears in more than one category`);
    seen.add(id);
  }
});

test("the catalog ships a substantial icon set", () => {
  // The whole point of the panel over the curated QuickPick is breadth; guard against a
  // regeneration that silently collapses the set.
  assert.ok(
    ALL_ICON_IDS.length > 300,
    `expected the full codicon set, got ${ALL_ICON_IDS.length}`
  );
});
