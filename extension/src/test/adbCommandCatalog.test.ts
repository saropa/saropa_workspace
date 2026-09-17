// Unit tests for the adb command catalog (section 2 of MOBILE_REMOTE_CONTROL_PLAN).
// The catalog is inert data plus two pure helpers, so everything here runs under
// node --test with no extension host; l10n() is pure too (it reads the bundled
// en.json), so the string-coverage tests resolve keys through the real catalog
// rather than re-implementing the lookup.
//
// The load-bearing claims: ids are unique and stable (they key pins and run
// history), every entry actually has English strings, the destructive flag matches
// what the command really does, and search/grouping behave as the panel expects.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ADB_COMMAND_CATALOG,
  ADB_COMMAND_GROUPS,
  adbGroupDescriptionKey,
  adbGroupLabelKey,
  filterAdbCatalog,
  groupAdbCatalog,
  type AdbCommandEntry,
} from "../model/adbCommandCatalog";
import { l10n } from "../i18n/l10n";

// l10n falls back to the key itself when a key is missing, so "resolved" means
// "came back as something other than the key, and not blank".
function resolves(key: string): boolean {
  const value = l10n(key);
  return value !== key && value.trim() !== "";
}

// --- shape -----------------------------------------------------------------

test("the catalog is populated and every id is unique", () => {
  assert.ok(ADB_COMMAND_CATALOG.length >= 25, "catalog should be a real catalog");
  const ids = ADB_COMMAND_CATALOG.map((e) => e.id);
  assert.equal(new Set(ids).size, ids.length, `duplicate id in ${ids.join(", ")}`);
});

test("every entry declares a known group and a non-empty command template", () => {
  const groups = new Set<string>(ADB_COMMAND_GROUPS);
  for (const e of ADB_COMMAND_CATALOG) {
    assert.ok(groups.has(e.group), `${e.id} has unknown group ${e.group}`);
    assert.ok(e.commandTemplate.startsWith("adb"), `${e.id} is not an adb command`);
    assert.ok(e.tags.length > 0, `${e.id} has no tags`);
  }
});

test("l10n keys are derived from the id, so the two cannot drift apart", () => {
  for (const e of ADB_COMMAND_CATALOG) {
    assert.equal(e.labelKey, `adb.${e.id}.label`);
    assert.equal(e.descriptionKey, `adb.${e.id}.description`);
  }
});

test("no entry streams logs — logcat is out of scope, owned by Log Capture", () => {
  for (const e of ADB_COMMAND_CATALOG) {
    assert.equal(
      /logcat/i.test(e.commandTemplate),
      false,
      `${e.id} references logcat`
    );
  }
});

test("every placeholder token is a bare {token} the execution layer can find", () => {
  for (const e of ADB_COMMAND_CATALOG) {
    for (const token of e.commandTemplate.match(/\{[^}]*\}/g) ?? []) {
      assert.match(token, /^\{[A-Za-z][A-Za-z0-9]*\}$/, `${e.id} has token ${token}`);
    }
  }
});

// --- localization coverage -------------------------------------------------

test("every entry's label and description resolve to real English text", () => {
  for (const e of ADB_COMMAND_CATALOG) {
    assert.ok(resolves(e.labelKey), `missing en.json value for ${e.labelKey}`);
    assert.ok(
      resolves(e.descriptionKey),
      `missing en.json value for ${e.descriptionKey}`
    );
  }
});

test("every group heading and blurb resolve too", () => {
  for (const group of ADB_COMMAND_GROUPS) {
    assert.ok(resolves(adbGroupLabelKey(group)), `missing label for group ${group}`);
    assert.ok(
      resolves(adbGroupDescriptionKey(group)),
      `missing description for group ${group}`
    );
  }
});

test("descriptions are sentences, not placeholder stubs", () => {
  for (const e of ADB_COMMAND_CATALOG) {
    const text = l10n(e.descriptionKey);
    assert.ok(text.length > 20, `${e.descriptionKey} is too short to be useful`);
    assert.ok(text.endsWith("."), `${e.descriptionKey} is not a sentence`);
  }
});

// --- destructive flag ------------------------------------------------------

// The verbs that actually destroy state. Every destructive entry must contain one,
// which is what stops the flag from being set (or forgotten) by hand alone.
const DESTRUCTIVE_VERBS = [
  "uninstall",
  "pm clear",
  "force-stop",
  "reboot",
  " rm ",
  "wipe",
  " -w",
];

test("every destructive entry really is destructive", () => {
  const destructive = ADB_COMMAND_CATALOG.filter((e) => e.destructive);
  assert.ok(destructive.length > 0, "a catalog with no destructive commands is wrong");
  for (const e of destructive) {
    const template = e.commandTemplate;
    assert.ok(
      DESTRUCTIVE_VERBS.some((verb) => template.includes(verb)),
      `${e.id} is flagged destructive but "${template}" does not destroy anything`
    );
  }
});

test("the obviously destructive commands are all flagged", () => {
  for (const id of [
    "appControl.uninstall",
    "appControl.clear-data",
    "appControl.force-stop",
    "files.delete",
    "powerReboot.reboot",
    "powerReboot.reboot-recovery",
    "powerReboot.reboot-bootloader",
  ]) {
    const found = ADB_COMMAND_CATALOG.find((e) => e.id === id);
    assert.ok(found, `${id} missing from the catalog`);
    assert.equal(found?.destructive, true, `${id} is not flagged destructive`);
  }
});

test("read-only inspection commands are not flagged destructive", () => {
  for (const id of [
    "connection.list-devices",
    "deviceInfo.battery",
    "deviceInfo.properties",
    "appControl.list-packages",
    "files.pull",
  ]) {
    assert.equal(ADB_COMMAND_CATALOG.find((e) => e.id === id)?.destructive, false);
  }
});

test("only device-less commands claim not to require a device", () => {
  const noDevice = ADB_COMMAND_CATALOG.filter((e) => !e.requiresDevice).map((e) => e.id);
  assert.deepEqual(noDevice.sort(), [
    "connection.connect",
    "connection.disconnect",
    "connection.list-devices",
    "connection.pair",
    "shell.restart-server",
  ]);
});

// --- filterAdbCatalog ------------------------------------------------------

test("an empty query returns everything, as a copy of the input", () => {
  for (const query of ["", "   "]) {
    const filtered = filterAdbCatalog(ADB_COMMAND_CATALOG, query);
    assert.deepEqual(filtered, ADB_COMMAND_CATALOG);
    assert.notEqual(filtered, ADB_COMMAND_CATALOG, "must not hand back the constant");
  }
});

test("a query matches on id", () => {
  const ids = filterAdbCatalog(ADB_COMMAND_CATALOG, "uninstall").map((e) => e.id);
  assert.deepEqual(ids, ["appControl.uninstall"]);
});

test("a query matches on a tag that is nowhere in the id", () => {
  const ids = filterAdbCatalog(ADB_COMMAND_CATALOG, "apk").map((e) => e.id);
  assert.ok(ids.includes("appControl.install"));
  assert.ok(ids.includes("appControl.uninstall"));
  // "apk" appears in no id at all, so a tagless match would return nothing.
  assert.ok(ids.every((id) => !id.includes("apk")));
});

test("a query matches on group name", () => {
  const matched = filterAdbCatalog(ADB_COMMAND_CATALOG, "deepLinks");
  assert.equal(matched.length, groupAdbCatalog(ADB_COMMAND_CATALOG).get("deepLinks")?.length);
  assert.ok(matched.every((e) => e.group === "deepLinks"));
});

test("matching is case-insensitive in both directions", () => {
  const lower = filterAdbCatalog(ADB_COMMAND_CATALOG, "wifi");
  const upper = filterAdbCatalog(ADB_COMMAND_CATALOG, "WiFi");
  assert.ok(lower.length > 0);
  assert.deepEqual(upper, lower);
  assert.deepEqual(
    filterAdbCatalog(ADB_COMMAND_CATALOG, "REBOOT").map((e) => e.id),
    filterAdbCatalog(ADB_COMMAND_CATALOG, "reboot").map((e) => e.id)
  );
});

test("a query nothing matches returns an empty list rather than everything", () => {
  assert.deepEqual(filterAdbCatalog(ADB_COMMAND_CATALOG, "zzz-no-such-command"), []);
});

test("results keep the catalog's own order", () => {
  const filtered = filterAdbCatalog(ADB_COMMAND_CATALOG, "install");
  const order = ADB_COMMAND_CATALOG.map((e) => e.id);
  const seen = filtered.map((e) => e.id);
  assert.deepEqual(seen, order.filter((id) => seen.includes(id)));
});

test("filtering an arbitrary list, not just the shipped catalog", () => {
  const custom: AdbCommandEntry[] = [
    {
      id: "custom.one",
      group: "shell",
      labelKey: "adb.custom.one.label",
      descriptionKey: "adb.custom.one.description",
      commandTemplate: "adb shell echo one",
      tags: ["alpha"],
      requiresDevice: true,
      destructive: false,
    },
  ];
  assert.equal(filterAdbCatalog(custom, "alpha").length, 1);
  assert.equal(filterAdbCatalog(custom, "beta").length, 0);
});

// --- groupAdbCatalog -------------------------------------------------------

test("grouping buckets every entry exactly once, losing none", () => {
  const grouped = groupAdbCatalog(ADB_COMMAND_CATALOG);
  const total = [...grouped.values()].reduce((sum, list) => sum + list.length, 0);
  assert.equal(total, ADB_COMMAND_CATALOG.length);
  for (const [group, list] of grouped) {
    for (const e of list) {
      assert.equal(e.group, group);
    }
  }
});

test("every declared group has at least one entry, and all of them are rendered", () => {
  const grouped = groupAdbCatalog(ADB_COMMAND_CATALOG);
  assert.deepEqual([...grouped.keys()], [...ADB_COMMAND_GROUPS]);
});

test("group order follows ADB_COMMAND_GROUPS, not first-seen order", () => {
  // Reversing the input must not reverse the rendered section order.
  const grouped = groupAdbCatalog([...ADB_COMMAND_CATALOG].reverse());
  assert.deepEqual([...grouped.keys()], [...ADB_COMMAND_GROUPS]);
});

test("a group with no surviving entry is omitted rather than rendered empty", () => {
  const grouped = groupAdbCatalog(filterAdbCatalog(ADB_COMMAND_CATALOG, "reboot"));
  // The group name itself matches, so the whole Power/reboot section survives and
  // every other section drops out.
  assert.deepEqual([...grouped.keys()], ["powerReboot"]);
  assert.equal(grouped.get("powerReboot")?.length, 4);
});

test("grouping an empty list yields an empty map", () => {
  assert.equal(groupAdbCatalog([]).size, 0);
});
