// Unit tests for launcherRunHistory.ts — the pure host-side builder that feeds the
// Launcher webview's right panel (PLAN_Launcher_Restructure.md, build order step 6). Pure,
// no vscode import, so it runs under Node's built-in test runner like the other launcher
// data builders (see launcherAdbItem.test.ts, launcherCategoryList.test.ts).

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildRunHistoryEntries,
  RUN_HISTORY_DISPLAY_LIMIT,
} from "../views/launcherRunHistory";
import { AdbCommandEntry } from "../model/adbCommandCatalog";
import { l10n } from "../i18n/l10n";

// A minimal catalog entry literal, real ADB_COMMAND_CATALOG entries have real l10n keys
// (adb.<id>.label), which is all buildRunHistoryEntries reads besides `id`.
function entry(id: string): AdbCommandEntry {
  return {
    id,
    group: "connection",
    labelKey: `adb.${id}.label`,
    descriptionKey: `adb.${id}.description`,
    commandTemplate: "adb devices",
    tags: [],
    requiresDevice: false,
    destructive: false,
  };
}

const A = entry("connection.list-devices");
const B = entry("appControl.uninstall");
const C = entry("files.push");
const CATALOG = [A, B, C];

test("buildRunHistoryEntries: empty history yields an empty list", () => {
  const entries = buildRunHistoryEntries(CATALOG, [], {});
  assert.deepEqual(entries, []);
});

test("buildRunHistoryEntries: preserves recent()'s own most-recent-first ordering", () => {
  const entries = buildRunHistoryEntries(CATALOG, [B.id, A.id, C.id], {});
  assert.deepEqual(
    entries.map((e) => e.id),
    [`adb:${B.id}`, `adb:${A.id}`, `adb:${C.id}`]
  );
});

test("buildRunHistoryEntries: count values are carried through from `counts` by id", () => {
  const entries = buildRunHistoryEntries(
    CATALOG,
    [A.id, B.id],
    { [A.id]: 5, [B.id]: 1 }
  );
  const countOf = (id: string) => entries.find((e) => e.id === `adb:${id}`)?.count;
  assert.equal(countOf(A.id), 5);
  assert.equal(countOf(B.id), 1);
});

test("buildRunHistoryEntries: an id absent from `counts` defaults to 0, not undefined", () => {
  const entries = buildRunHistoryEntries(CATALOG, [A.id], {});
  assert.equal(entries[0].count, 0);
});

test("buildRunHistoryEntries: an unknown/stale id (no longer in the catalog) is skipped, not crashed on", () => {
  const entries = buildRunHistoryEntries(
    CATALOG,
    ["some.removed.entry", A.id],
    { [A.id]: 2 }
  );
  assert.equal(entries.length, 1);
  assert.equal(entries[0].id, `adb:${A.id}`);
});

test("buildRunHistoryEntries: every row's id is the 'adb:'-prefixed composite id, matching launcherAdbItem.ts's own convention", () => {
  const entries = buildRunHistoryEntries(CATALOG, [A.id], {});
  assert.equal(entries[0].id, `adb:${A.id}`);
});

test("buildRunHistoryEntries: a row's label is resolved English, not the raw l10n key", () => {
  const entries = buildRunHistoryEntries(CATALOG, [A.id], {});
  assert.notEqual(entries[0].label, A.labelKey);
  assert.equal(entries[0].label, l10n(A.labelKey));
});

test("buildRunHistoryEntries: caps the result at the given limit, keeping the most-recent entries", () => {
  const entries = buildRunHistoryEntries(CATALOG, [A.id, B.id, C.id], {}, 2);
  assert.equal(entries.length, 2);
  assert.deepEqual(
    entries.map((e) => e.id),
    [`adb:${A.id}`, `adb:${B.id}`]
  );
});

test("buildRunHistoryEntries: defaults to RUN_HISTORY_DISPLAY_LIMIT when no limit is passed", () => {
  const manyIds = Array.from({ length: RUN_HISTORY_DISPLAY_LIMIT + 5 }, () => A.id);
  // Duplicates of the same id all resolve (this module does no de-duplication of its own —
  // adbRunHistory.record() is what guarantees `recent()` itself is already de-duplicated by
  // commandId), so this only exercises the cap, not de-duplication.
  const entries = buildRunHistoryEntries(CATALOG, manyIds, {});
  assert.equal(entries.length, RUN_HISTORY_DISPLAY_LIMIT);
});
