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
  groupAdbCatalog,
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
  for (const entry of ADB_COMMAND_CATALOG) {
    const card = items.find((it) => it.id === `adb:${entry.id}`);
    assert.ok(card, `expected a card for catalog entry ${entry.id}`);
    // Actually strip the "adb:" prefix (mirroring how launcherViewMessages.ts's
    // handleAdbItem does it) and check the result equals the source entry's own id, rather
    // than just re-deriving the same string the assertion above already used to find it.
    assert.equal(card?.id.slice("adb:".length), entry.id);
  }
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

// launcherView.ts calls adbLauncherItems(undefined) directly on a non-Android workspace
// (this.androidProfile is `undefined`, never emptyAndroidProjectProfile()) — that real
// code path needs its own coverage, not just the emptyAndroidProjectProfile() stand-in
// above.
test("with literally no argument (the non-Android-workspace call site), the catalog still resolves in full", () => {
  const items = adbLauncherItems(undefined);
  assert.equal(items.length, ADB_COMMAND_CATALOG.length);
  const clearData = items.find((it) => it.id === "adb:appControl.clear-data");
  assert.ok(clearData);
  assert.match(clearData?.sub ?? "", /\$\{(prompt|pick):/);
});

// undefined and emptyAndroidProjectProfile() both mean "nothing to substitute"; the two
// call sites (launcherView.ts passes undefined off a non-Android workspace, some tests
// above pass the empty profile) must produce identical commands, not merely
// individually-plausible ones.
test("adbLauncherItems(undefined) and adbLauncherItems(emptyAndroidProjectProfile()) produce identical commands", () => {
  const withUndefined = adbLauncherItems(undefined);
  const withEmptyProfile = adbLauncherItems(emptyAndroidProjectProfile());
  assert.equal(withUndefined.length, withEmptyProfile.length);
  for (let i = 0; i < withUndefined.length; i++) {
    assert.equal(withUndefined[i].id, withEmptyProfile[i].id);
    assert.equal(withUndefined[i].sub, withEmptyProfile[i].sub);
  }
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

test("every card names a kindLabel for the icon tooltip", () => {
  const items = adbLauncherItems();
  for (const it of items) {
    assert.ok(it.kindLabel && it.kindLabel.length > 0, `expected a kindLabel on ${it.id}`);
  }
});

test("a card's desc folds in the catalog entry's own tags, so a tag-only search matches it", () => {
  const entry = ADB_COMMAND_CATALOG.find((e) => e.tags.includes("wipe"));
  assert.ok(entry, "expected some catalog entry tagged 'wipe'");
  const items = adbLauncherItems();
  const card = items.find((it) => it.id === `adb:${entry?.id}`);
  assert.ok(card);
  for (const tag of entry?.tags ?? []) {
    assert.ok(card?.desc?.includes(tag), `expected desc to include tag "${tag}"`);
  }
});

test("a card that requires a device or a minimum SDK badges that in desc", () => {
  const items = adbLauncherItems();
  const withDevice = ADB_COMMAND_CATALOG.find((e) => e.requiresDevice);
  assert.ok(withDevice, "expected some catalog entry that requires a device");
  const deviceCard = items.find((it) => it.id === `adb:${withDevice?.id}`);
  assert.ok(deviceCard);
  assert.ok(deviceCard?.desc?.includes(l10n("remoteControl.badge.requiresDevice")));

  const withMinSdk = ADB_COMMAND_CATALOG.find((e) => e.minSdk !== undefined);
  if (withMinSdk?.minSdk !== undefined) {
    const sdkCard = items.find((it) => it.id === `adb:${withMinSdk.id}`);
    assert.ok(sdkCard);
    assert.ok(
      sdkCard?.desc?.includes(l10n("remoteControl.badge.minSdk", { level: withMinSdk.minSdk }))
    );
  }
});

test("only catalog groups groupAdbCatalog actually returns appear as sections, in that exact order", () => {
  // Derived independently from groupAdbCatalog/ADB_COMMAND_GROUPS instead of from
  // adbLauncherItems' own output, so this can actually fail if the adapter reintroduces
  // an empty group (e.g. by iterating ADB_COMMAND_GROUPS directly instead of the map) or
  // drops/reorders one groupAdbCatalog does return.
  const expectedGroups = [...groupAdbCatalog(ADB_COMMAND_CATALOG)].map(([group]) => group);
  const items = adbLauncherItems();
  const seenOrder: string[] = [];
  for (const it of items) {
    const catalogGroup = it.groupId.replace(/^mobileRemote:/, "");
    if (!seenOrder.includes(catalogGroup)) {
      seenOrder.push(catalogGroup);
    }
  }
  assert.deepEqual(seenOrder, expectedGroups);
});
