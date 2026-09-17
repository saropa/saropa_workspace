// Unit tests for the "Saropa: Go" omni-QuickPick's data layer
// (MOBILE_REMOTE_CONTROL_PLAN, "UI restructure" item 4).
//
// goItems.ts is pure — plain data in, rendered rows out — and imports no vscode, so it
// runs under node --test with no extension host. The QuickPick itself (createQuickPick,
// onDidChangeValue, the dispatch switch) stays untested glue in goQuickPick.ts, matching
// how hubQuickPick.ts is left untested.
//
// The load-bearing claims: every category reaches the flat list under its own separator,
// recently-run entries are promoted to the top and not duplicated below, an empty
// category contributes no header, the drill-down narrows to exactly one category with its
// recents first, and the `>` token resolves by unambiguous prefix.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GO_CATEGORIES,
  GoCategory,
  GoRow,
  GoSource,
  buildGoRows,
  goKey,
  parseGoPrefix,
} from "../commands/goItems";

const LABELS = {
  recent: "Recent",
  categories: {
    shortcut: "Shortcuts",
    recipe: "Recipes",
    script: "Scripts",
    note: "Notes",
    watch: "Watches",
    adb: "Mobile Remote Control",
  },
};

function source(category: GoCategory, id: string): GoSource {
  return { category, id, label: `${category}-${id}`, description: id };
}

// One entry per category, so a build covers the whole list shape.
const EVERY_CATEGORY: GoSource[] = GO_CATEGORIES.map((c) => source(c, "a"));

function labelsOf(rows: readonly GoRow[], kind: GoRow["kind"]): string[] {
  return rows.filter((r) => r.kind === kind).map((r) => r.label);
}

// --- flat list -------------------------------------------------------------

test("every category contributes a separator and its items, in registry order", () => {
  const rows = buildGoRows(EVERY_CATEGORY, LABELS);

  assert.deepEqual(labelsOf(rows, "separator"), [
    "Shortcuts",
    "Recipes",
    "Scripts",
    "Notes",
    "Watches",
    "Mobile Remote Control",
  ]);
  assert.equal(rows.filter((r) => r.kind === "item").length, GO_CATEGORIES.length);
});

test("an item row carries its source back, so accept needs no label matching", () => {
  const rows = buildGoRows([source("adb", "device.list")], LABELS);
  const item = rows.find((r) => r.kind === "item");

  assert.equal(item?.source?.category, "adb");
  assert.equal(item?.source?.id, "device.list");
});

test("a category with no entries contributes no separator", () => {
  const rows = buildGoRows([source("note", "standup.md")], LABELS);

  assert.deepEqual(labelsOf(rows, "separator"), ["Notes"]);
});

test("nothing loaded renders no rows at all, not a wall of empty headers", () => {
  assert.deepEqual(buildGoRows([], LABELS), []);
});

// --- recency ---------------------------------------------------------------

test("recent entries lead the list under the Recent separator, most-recent first", () => {
  const sources = [source("shortcut", "one"), source("shortcut", "two")];
  const rows = buildGoRows(sources, LABELS, {
    recent: [goKey("shortcut", "two"), goKey("shortcut", "one")],
  });

  assert.equal(rows[0]?.label, "Recent");
  assert.deepEqual(
    rows.slice(1, 3).map((r) => r.source?.id),
    ["two", "one"]
  );
});

test("a promoted entry is not repeated in its own category section", () => {
  const sources = [source("shortcut", "one"), source("shortcut", "two")];
  const rows = buildGoRows(sources, LABELS, { recent: [goKey("shortcut", "one")] });

  const ids = rows.filter((r) => r.kind === "item").map((r) => r.source?.id);
  assert.deepEqual(ids, ["one", "two"]);
  assert.deepEqual(labelsOf(rows, "separator"), ["Recent", "Shortcuts"]);
});

test("a category whose every entry was promoted loses its section header", () => {
  const rows = buildGoRows([source("adb", "x")], LABELS, {
    recent: [goKey("adb", "x")],
  });

  assert.deepEqual(labelsOf(rows, "separator"), ["Recent"]);
});

test("recency is category-scoped: a colliding id in another category is not promoted", () => {
  const rows = buildGoRows([source("shortcut", "dupe"), source("adb", "dupe")], LABELS, {
    recent: [goKey("adb", "dupe")],
  });

  const recentItem = rows[1];
  assert.equal(recentItem?.source?.category, "adb");
  assert.deepEqual(labelsOf(rows, "separator"), ["Recent", "Shortcuts"]);
});

test("a recency key naming something no longer loaded paints no row", () => {
  const rows = buildGoRows([source("note", "live.md")], LABELS, {
    recent: [goKey("note", "deleted.md")],
  });

  assert.deepEqual(labelsOf(rows, "separator"), ["Notes"]);
});

test("the Recent section is bounded by recentLimit", () => {
  const sources = ["a", "b", "c", "d"].map((id) => source("shortcut", id));
  const rows = buildGoRows(sources, LABELS, {
    recent: sources.map((s) => goKey("shortcut", s.id)),
    recentLimit: 2,
  });

  const recentEnd = rows.findIndex((r) => r.label === "Shortcuts");
  assert.equal(recentEnd, 3); // separator + two promoted rows
});

// --- drill-down ------------------------------------------------------------

test("a category filter narrows to one section and drops the Recent group", () => {
  const rows = buildGoRows(EVERY_CATEGORY, LABELS, {
    recent: [goKey("adb", "a")],
    category: "adb",
  });

  assert.deepEqual(labelsOf(rows, "separator"), ["Mobile Remote Control"]);
  assert.equal(rows.filter((r) => r.kind === "item").length, 1);
});

test("inside a drill-down the category's own recents sort first", () => {
  const sources = ["a", "b", "c"].map((id) => source("script", id));
  const rows = buildGoRows(sources, LABELS, {
    recent: [goKey("script", "c")],
    category: "script",
  });

  assert.deepEqual(
    rows.filter((r) => r.kind === "item").map((r) => r.source?.id),
    ["c", "a", "b"]
  );
});

test("drilling into an empty category renders nothing", () => {
  assert.deepEqual(
    buildGoRows([source("note", "n")], LABELS, { category: "watch" }),
    []
  );
});

// --- prefix parsing --------------------------------------------------------

test("a full token with trailing search text resolves and hands back the remainder", () => {
  assert.deepEqual(parseGoPrefix(">adb screenshot"), {
    category: "adb",
    remainder: "screenshot",
  });
});

test("a token still being typed resolves as soon as it is unambiguous", () => {
  assert.deepEqual(parseGoPrefix(">a"), { category: "adb", remainder: "" });
  assert.deepEqual(parseGoPrefix(">rec"), { category: "recipe", remainder: "" });
});

test("an ambiguous token narrows nothing", () => {
  // "s" prefixes both shortcut and script, so it must not silently pick one; one more
  // character disambiguates in either direction.
  assert.equal(parseGoPrefix(">s"), undefined);
  assert.equal(parseGoPrefix(">sc")?.category, "script");
  assert.equal(parseGoPrefix(">sh")?.category, "shortcut");
});

test("the token is case-insensitive", () => {
  assert.equal(parseGoPrefix(">ADB")?.category, "adb");
});

test("plain text and a bare marker are not drill-downs", () => {
  assert.equal(parseGoPrefix("adb"), undefined);
  assert.equal(parseGoPrefix(">"), undefined);
  assert.equal(parseGoPrefix("> "), undefined);
});

test("an unknown token is not a drill-down", () => {
  assert.equal(parseGoPrefix(">zzz build"), undefined);
});

test("every category is reachable by its own full token", () => {
  for (const category of GO_CATEGORIES) {
    assert.equal(parseGoPrefix(`>${category} `)?.category, category);
  }
});
