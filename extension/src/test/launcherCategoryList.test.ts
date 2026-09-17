// Unit tests for launcherCategoryList.ts — the pure host-side builder that feeds the
// Launcher webview's left panel (PLAN_Launcher_Restructure.md, build order step 3). Pure, no
// vscode import, so it runs under Node's built-in test runner like the other launcher item
// adapters (see launcherAdbItem.test.ts).

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildCategoryList,
  countItemsByPane,
  LAUNCHER_PANE_ORDER,
} from "../views/launcherCategoryList";
import { LauncherItem } from "../views/launcherItems";
import { l10n } from "../i18n/l10n";

// A minimal, otherwise-unused-field LauncherItem stand-in — buildCategoryList only reads
// `.pane`, so the rest of the shape does not matter for these tests.
function item(pane: LauncherItem["pane"]): LauncherItem {
  return {
    id: `id:${pane}:${Math.random()}`,
    label: "x",
    sub: undefined,
    desc: undefined,
    pane,
    section: "s",
    groupId: "g",
    groupIcon: "i",
    groupColor: "c",
    icon: "i",
    color: "c",
    kind: "k",
  } as unknown as LauncherItem;
}

test("buildCategoryList: 'all' is always first, with the total item count", () => {
  const items = [item("mine"), item("mine"), item("recipes"), item("mobileRemote")];
  const entries = buildCategoryList(items);
  assert.equal(entries[0].id, "all");
  assert.equal(entries[0].count, items.length);
  assert.equal(entries[0].label, l10n("launcher.allCategory"));
});

test("buildCategoryList: 'all' has the total count and a non-empty label even with zero items", () => {
  const entries = buildCategoryList([]);
  assert.equal(entries[0].id, "all");
  assert.equal(entries[0].count, 0);
  assert.ok(entries[0].label.length > 0);
});

test("buildCategoryList: every pane appears exactly once, in LAUNCHER_PANE_ORDER order", () => {
  const entries = buildCategoryList([item("mine")]);
  const paneIds = entries.slice(1).map((e) => e.id);
  assert.deepEqual(paneIds, LAUNCHER_PANE_ORDER);
});

test("buildCategoryList: a pane with zero items still appears, with count 0", () => {
  // Only "mine" has any items; every other pane must still show up, at count 0 — a
  // navigation aid, unlike the card grid, where an empty group is hidden (judgment call,
  // see this repo's PLAN_Launcher_Restructure.md build-order step 3 notes).
  const entries = buildCategoryList([item("mine")]);
  for (const pane of LAUNCHER_PANE_ORDER) {
    const entry = entries.find((e) => e.id === pane);
    assert.ok(entry, `expected an entry for pane "${pane}"`);
    assert.equal(entry?.count, pane === "mine" ? 1 : 0);
  }
});

test("buildCategoryList: each pane's count matches how many items carry that pane", () => {
  const items = [
    item("watches"),
    item("watches"),
    item("watches"),
    item("files"),
    item("notes"),
  ];
  const entries = buildCategoryList(items);
  const countOf = (id: LauncherItem["pane"]): number | undefined =>
    entries.find((e) => e.id === id)?.count;
  assert.equal(countOf("watches"), 3);
  assert.equal(countOf("files"), 1);
  assert.equal(countOf("notes"), 1);
  assert.equal(countOf("mine"), 0);
  assert.equal(countOf("recipes"), 0);
  assert.equal(countOf("scripts"), 0);
  assert.equal(countOf("mobileRemote"), 0);
});

test("buildCategoryList: every entry names a non-empty icon", () => {
  const entries = buildCategoryList([item("mine")]);
  for (const entry of entries) {
    assert.ok(entry.icon.length > 0, `expected an icon for "${entry.id}"`);
  }
});

test("buildCategoryList: each pane's label matches the section string this codebase already uses", () => {
  // Reuses launcher.<pane>Section rather than inventing new copy — see the plan's "read the
  // exact category labels already used elsewhere" instruction.
  const entries = buildCategoryList([]);
  const labelOf = (id: LauncherItem["pane"]): string | undefined =>
    entries.find((e) => e.id === id)?.label;
  assert.equal(labelOf("mine"), l10n("launcher.mineSection"));
  assert.equal(labelOf("recipes"), l10n("launcher.recipesSection"));
  assert.equal(labelOf("watches"), l10n("launcher.watchesSection"));
  assert.equal(labelOf("files"), l10n("launcher.filesSection"));
  assert.equal(labelOf("scripts"), l10n("launcher.scriptsSection"));
  assert.equal(labelOf("notes"), l10n("launcher.notesSection"));
  assert.equal(labelOf("mobileRemote"), l10n("launcher.mobileRemoteSection"));
});

test("countItemsByPane: counts only items carrying the given pane", () => {
  const items = [item("mine"), item("recipes"), item("mine")];
  assert.equal(countItemsByPane(items, "mine"), 2);
  assert.equal(countItemsByPane(items, "recipes"), 1);
  assert.equal(countItemsByPane(items, "watches"), 0);
});
