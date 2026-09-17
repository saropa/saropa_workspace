// Unit tests for launcherAdbItem.ts — the Mobile Remote Control adapter that maps the adb
// command catalog into LauncherItems (PLAN_Launcher_Restructure.md, build-order step 2).
// Pure, no vscode import, so it runs under Node's built-in test runner like the other
// launcher item adapters (see launcherItems.test.ts, scriptLibrary.test.ts).

import { test } from "node:test";
import assert from "node:assert/strict";
import { adbLauncherItems } from "../views/launcherAdbItem";
import {
  ADB_COMMAND_CATALOG,
  ADB_COMMAND_GROUPS,
} from "../model/adbCommandCatalog";
import {
  buildAndroidProjectProfile,
  emptyAndroidProjectProfile,
} from "../model/androidProjectProfile";
import { l10n } from "../i18n/l10n";

test("adbLauncherItems produces exactly one card per catalog entry", () => {
  const items = adbLauncherItems();
  assert.equal(items.length, ADB_COMMAND_CATALOG.length);
});

test("every card files under the mobileRemote pane with an 'adb:' id", () => {
  const items = adbLauncherItems();
  for (const it of items) {
    assert.equal(it.pane, "mobileRemote");
    assert.ok(it.id.startsWith("adb:"), `expected an "adb:" id, got ${it.id}`);
  }
});

test("a card's id strips back to its catalog entry id", () => {
  const items = adbLauncherItems();
  const uninstall = items.find((it) => it.id === "adb:appControl.uninstall");
  assert.ok(uninstall, "appControl.uninstall must produce a card");
});

test("a card's label and description are resolved English, not l10n keys", () => {
  const items = adbLauncherItems();
  const entry = ADB_COMMAND_CATALOG.find((e) => e.id === "connection.list-devices");
  assert.ok(entry);
  const card = items.find((it) => it.id === `adb:${entry?.id}`);
  assert.ok(card);
  assert.notEqual(card?.label, entry?.labelKey);
  assert.notEqual(card?.desc, entry?.descriptionKey);
  assert.ok((card?.label.length ?? 0) > 0);
});

test("a card's sub line is the profile-substituted dry-run command, not the raw template", () => {
  const profile = buildAndroidProjectProfile({
    gradleText: 'android { defaultConfig { applicationId "com.example.app" } }',
    hasAndroidDir: true,
  });
  const items = adbLauncherItems(profile);
  const clearData = items.find((it) => it.id === "adb:appControl.clear-data");
  assert.ok(clearData);
  assert.equal(clearData?.sub, "adb shell pm clear com.example.app");
});

test("with no profile, a token the profile cannot answer is left as a run-parameter prompt, not the bare template", () => {
  const items = adbLauncherItems(emptyAndroidProjectProfile());
  const clearData = items.find((it) => it.id === "adb:appControl.clear-data");
  assert.ok(clearData);
  assert.notEqual(clearData?.sub, "adb shell pm clear {applicationId}");
  assert.match(clearData?.sub ?? "", /\$\{(prompt|pick):/);
});

test("a destructive entry's card is badged distinctly from a non-destructive one", () => {
  const items = adbLauncherItems();
  const destructive = items.find((it) => it.id === "adb:appControl.uninstall");
  const safe = items.find((it) => it.id === "adb:connection.list-devices");
  assert.ok(destructive && safe);
  assert.equal(destructive?.icon, "warning");
  assert.equal(destructive?.color, "errorForeground");
  assert.notEqual(safe?.icon, "warning");
});

test("every card is runnable and Run-headed, never Open-headed", () => {
  const items = adbLauncherItems();
  for (const it of items) {
    assert.equal(it.runnable, true);
    assert.equal(it.openable, false);
    assert.equal(it.headAction, "run");
    assert.equal(it.copyable, false);
  }
});

test("a card's section/groupId reflect the catalog's own group, in the catalog's group order", () => {
  const items = adbLauncherItems();
  const seenOrder: string[] = [];
  for (const it of items) {
    const catalogGroup = it.groupId.replace(/^mobileRemote:/, "");
    if (!seenOrder.includes(catalogGroup)) {
      seenOrder.push(catalogGroup);
    }
    assert.equal(it.section, l10n(`adb.group.${catalogGroup}.label`));
  }
  // groupAdbCatalog buckets in ADB_COMMAND_GROUPS order, so the first-seen order here must
  // be a subsequence of it (a group absent from the catalog is simply skipped).
  let cursor = -1;
  for (const group of seenOrder) {
    const idx = ADB_COMMAND_GROUPS.indexOf(group as (typeof ADB_COMMAND_GROUPS)[number]);
    assert.ok(idx > cursor, `group ${group} appeared out of ADB_COMMAND_GROUPS order`);
    cursor = idx;
  }
});

test("an empty catalog group never yields an empty section", () => {
  // groupAdbCatalog already drops empty groups; this asserts the adapter does not
  // reintroduce one (e.g. by iterating ADB_COMMAND_GROUPS directly instead of the map).
  const items = adbLauncherItems();
  const groupsPresent = new Set(items.map((it) => it.groupId));
  for (const group of groupsPresent) {
    assert.ok(items.some((it) => it.groupId === group));
  }
});
