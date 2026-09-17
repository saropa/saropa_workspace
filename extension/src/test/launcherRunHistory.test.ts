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
import { adbLauncherItems } from "../views/launcherAdbItem";

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

test("buildRunHistoryEntries: every row's id round-trips with launcherAdbItem.ts's own 'adb:' convention", () => {
  // A hand-written `adb:${entry.id}` template string here would only be a self-consistency
  // check — it would never catch launcherAdbItem.ts (the step-2 adapter minting the same
  // convention for catalog cards) drifting to a different prefix scheme. Cross-checking
  // against that module's actual output for the SAME real catalog entry (A.id is a real
  // ADB_COMMAND_CATALOG id — see entry() above) is a real round-trip check across both
  // modules instead of one module checked against itself. adbLauncherItems is vscode-free
  // (no vscode import), so it is safe to call directly from this Node-runner test.
  const entries = buildRunHistoryEntries(CATALOG, [A.id], {});
  const cardItem = adbLauncherItems().find((it) => it.id.endsWith(A.id));
  assert.ok(cardItem, `expected a launcher card for ${A.id}`);
  assert.equal(entries[0].id, cardItem.id);
});

test("buildRunHistoryEntries: a row's label is resolved English, not the raw l10n key", () => {
  const entries = buildRunHistoryEntries(CATALOG, [A.id], {});
  assert.notEqual(entries[0].label, A.labelKey);
  assert.equal(entries[0].label, l10n(A.labelKey));
  // The two assertions above restate the implementation line-for-line and would not catch
  // an accidental deletion/rename of the en.json key itself (l10n() falls back to the raw
  // key on a miss, and the notEqual check above would then pass for the wrong reason — the
  // fallback key vs. the intentionally-different labelKey string). Pinning the actual
  // resolved English string closes that gap.
  assert.equal(entries[0].label, "List devices");
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
  // Now that buildRunHistoryEntries de-dedups (see the next test), this needs enough
  // DISTINCT ids to actually exercise the cap rather than collapsing to a handful of rows.
  const manyEntries = Array.from(
    { length: RUN_HISTORY_DISPLAY_LIMIT + 5 },
    (_, i) => entry(`bulk.entry-${i}`)
  );
  const bulkCatalog = [...CATALOG, ...manyEntries];
  const entries = buildRunHistoryEntries(bulkCatalog, manyEntries.map((e) => e.id), {});
  assert.equal(entries.length, RUN_HISTORY_DISPLAY_LIMIT);
});

test("buildRunHistoryEntries: de-duplicates repeated ids, unlike adbRunHistory.recent() which is assumed already-unique", () => {
  // adbRunHistory.record() dedups on write, so `recent()` can't normally contain a repeat —
  // but adbRunHistory.ts's own read() only validates Array.isArray(data.recent), not
  // uniqueness, so a corrupted/hand-edited globalState blob could still hand this a
  // duplicate. buildRunHistoryEntries must not show the same command listed twice.
  const entries = buildRunHistoryEntries(CATALOG, [A.id, B.id, A.id, C.id, A.id], {});
  assert.deepEqual(
    entries.map((e) => e.id),
    [`adb:${A.id}`, `adb:${B.id}`, `adb:${C.id}`]
  );
});
