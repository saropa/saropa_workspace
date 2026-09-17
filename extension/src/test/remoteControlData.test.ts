// Unit tests for the Mobile Remote Control panel's wire model (section 3 of
// MOBILE_REMOTE_CONTROL_PLAN). remoteControlData.ts is pure — catalog data in, resolved
// JSON out, no vscode and no webview — so everything the panel actually DECIDES runs
// here under node --test. The panel/shell modules themselves are host glue and markup
// and are deliberately not tested: a WebviewPanel has no stand-in in _stub/vscode.ts.
//
// The load-bearing claims: the webview never receives an l10n key, search sees both the
// raw catalog fields and the resolved English, group order and the never-empty-group rule
// survive the payload build, and the counts a user reads as "7 of 38" mean that.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildProjectWire,
  buildRemoteControlPayload,
  rankRecentAdbEntries,
  remoteControlStrings,
  resolveAdbCommand,
  searchAdbCatalog,
  RECENT_GROUP_ID,
} from "../views/remoteControl/remoteControlData";
import {
  ADB_COMMAND_CATALOG,
  ADB_COMMAND_GROUPS,
  type AdbCommandEntry,
} from "../model/adbCommandCatalog";
import {
  buildAndroidProjectProfile,
  emptyAndroidProjectProfile,
} from "../model/androidProjectProfile";

function commands(payload = buildRemoteControlPayload()): Array<{
  id: string;
  label: string;
  description: string;
}> {
  return payload.groups.flatMap((g) => g.commands);
}

// --- resolveAdbCommand -----------------------------------------------------

test("an entry's l10n keys are resolved to English before it leaves the host", () => {
  const entry = ADB_COMMAND_CATALOG.find((e) => e.id === "appControl.uninstall");
  assert.ok(entry);
  const wire = resolveAdbCommand(entry as AdbCommandEntry);
  assert.notEqual(wire.label, entry?.labelKey);
  assert.notEqual(wire.description, entry?.descriptionKey);
  assert.ok(wire.label.length > 0);
  assert.equal(wire.commandTemplate, entry?.commandTemplate);
  assert.equal(wire.destructive, true);
});

test("minSdk travels only when the entry declares one", () => {
  const withSdk = ADB_COMMAND_CATALOG.find((e) => e.id === "connection.pair");
  const withoutSdk = ADB_COMMAND_CATALOG.find((e) => e.id === "connection.connect");
  assert.equal(resolveAdbCommand(withSdk as AdbCommandEntry).minSdk, 30);
  assert.equal("minSdk" in resolveAdbCommand(withoutSdk as AdbCommandEntry), false);
});

// --- searchAdbCatalog ------------------------------------------------------

test("an empty query returns every entry, as a copy", () => {
  const all = searchAdbCatalog(ADB_COMMAND_CATALOG, "   ");
  assert.equal(all.length, ADB_COMMAND_CATALOG.length);
  assert.notEqual(all, ADB_COMMAND_CATALOG);
});

test("search matches a tag that appears in no label or id", () => {
  const ids = searchAdbCatalog(ADB_COMMAND_CATALOG, "apk").map((e) => e.id);
  assert.ok(ids.includes("appControl.install"));
});

test("search matches the RESOLVED label, which the raw catalog filter cannot see", () => {
  // "daemon" is a word in the restart-server description, not in its id/tags/group, so
  // only the l10n-aware half of the search can find it.
  const ids = searchAdbCatalog(ADB_COMMAND_CATALOG, "daemon").map((e) => e.id);
  assert.ok(ids.includes("shell.restart-server"), `got ${ids.join(", ")}`);
});

test("search is case-insensitive and keeps catalog order", () => {
  const lower = searchAdbCatalog(ADB_COMMAND_CATALOG, "reboot").map((e) => e.id);
  const upper = searchAdbCatalog(ADB_COMMAND_CATALOG, "REBOOT").map((e) => e.id);
  assert.deepEqual(upper, lower);
  const order = ADB_COMMAND_CATALOG.map((e) => e.id);
  assert.deepEqual(lower, order.filter((id) => lower.includes(id)));
});

test("a query nothing matches returns nothing rather than everything", () => {
  assert.deepEqual(searchAdbCatalog(ADB_COMMAND_CATALOG, "zzz-nope"), []);
});

// --- buildProjectWire ------------------------------------------------------

test("a workspace with no Android project yields no project chip", () => {
  assert.equal(buildProjectWire(undefined), undefined);
  assert.equal(buildProjectWire(emptyAndroidProjectProfile()), undefined);
});

test("a resolved profile reports its default package, variant count and Flutter flag", () => {
  const profile = buildAndroidProjectProfile({
    gradleText: `android {
      defaultConfig { applicationId "com.example.app" minSdkVersion 24 }
      productFlavors { dev { applicationIdSuffix ".dev" } }
    }`,
    pubspecText: "name: app\nflutter:\n  uses-material-design: true\n",
  });
  const wire = buildProjectWire(profile);
  assert.equal(wire?.applicationId, "com.example.app");
  assert.equal(wire?.variantCount, 2);
  assert.equal(wire?.isFlutterProject, true);
});

// --- buildRemoteControlPayload --------------------------------------------

test("the default payload carries the whole catalog, grouped in catalog order", () => {
  const payload = buildRemoteControlPayload();
  assert.deepEqual(
    payload.groups.map((g) => g.id),
    [...ADB_COMMAND_GROUPS]
  );
  assert.equal(commands(payload).length, ADB_COMMAND_CATALOG.length);
  assert.equal(payload.total, ADB_COMMAND_CATALOG.length);
  assert.equal(payload.shown, ADB_COMMAND_CATALOG.length);
  assert.equal(payload.query, "");
});

test("no l10n key ever reaches the webview", () => {
  const payload = buildRemoteControlPayload();
  for (const group of payload.groups) {
    assert.ok(!group.label.startsWith("adb."), `group label is a key: ${group.label}`);
    assert.ok(!group.description.startsWith("adb."), group.description);
  }
  for (const cmd of commands(payload)) {
    assert.ok(!cmd.label.startsWith("adb."), `label is a key: ${cmd.label}`);
    assert.ok(!cmd.description.startsWith("adb."), `description is a key: ${cmd.id}`);
    assert.ok(cmd.label.trim() !== "" && cmd.description.trim() !== "");
  }
});

test("a filtered payload drops the groups with no surviving command", () => {
  const payload = buildRemoteControlPayload({ query: "reboot" });
  assert.deepEqual(
    payload.groups.map((g) => g.id),
    ["powerReboot"]
  );
  assert.equal(payload.groups[0].commands.length, 4);
  assert.equal(payload.shown, 4);
  // total stays the whole catalog, so the badge reads "4 of everything".
  assert.equal(payload.total, ADB_COMMAND_CATALOG.length);
  assert.equal(payload.query, "reboot");
});

test("a query nothing matches yields no groups, not an empty group", () => {
  const payload = buildRemoteControlPayload({ query: "zzz-nope" });
  assert.deepEqual(payload.groups, []);
  assert.equal(payload.shown, 0);
});

test("the destructive flag survives into the payload the panel badges", () => {
  const uninstall = commands().find((c) => c.id === "appControl.uninstall");
  assert.ok(uninstall);
  assert.equal(
    buildRemoteControlPayload().groups
      .flatMap((g) => g.commands)
      .filter((c) => c.destructive).length,
    ADB_COMMAND_CATALOG.filter((e) => e.destructive).length
  );
});

test("a supplied profile is reported but does NOT filter the catalog yet", () => {
  const profile = buildAndroidProjectProfile({
    gradleText: `android { defaultConfig { applicationId "com.example.app" } }`,
  });
  const payload = buildRemoteControlPayload({ profile });
  assert.equal(payload.project?.applicationId, "com.example.app");
  assert.equal(payload.shown, ADB_COMMAND_CATALOG.length);
});

test("an injected catalog is used instead of the shipped one", () => {
  const custom: AdbCommandEntry[] = [
    {
      id: "custom.one",
      group: "shell",
      labelKey: "adb.shell.run.label",
      descriptionKey: "adb.shell.run.description",
      commandTemplate: "adb shell echo one",
      tags: ["alpha"],
      requiresDevice: true,
      destructive: false,
    },
  ];
  const payload = buildRemoteControlPayload({ catalog: custom, query: "alpha" });
  assert.equal(payload.total, 1);
  assert.equal(payload.shown, 1);
  assert.deepEqual(payload.groups.map((g) => g.id), ["shell"]);
  assert.equal(buildRemoteControlPayload({ catalog: custom, query: "beta" }).shown, 0);
});

// --- strings ---------------------------------------------------------------

test("every client-facing string resolves to real English, tokens intact", () => {
  const strings = remoteControlStrings();
  for (const [name, value] of Object.entries(strings)) {
    assert.ok(value.trim() !== "", `${name} is blank`);
    assert.ok(!value.startsWith("remoteControl."), `${name} is an unresolved key`);
  }
  assert.ok(strings.minSdk.includes("{level}"));
  assert.ok(strings.count.includes("{n}"));
  assert.ok(strings.countFiltered.includes("{shown}"));
  assert.ok(strings.countFiltered.includes("{total}"));
  assert.ok(strings.projectPackage.includes("{id}"));
  assert.ok(strings.projectVariants.includes("{n}"));
});

// --- dry-run preview -------------------------------------------------------

test("a row carries the substituted command, not only the raw template", () => {
  const profile = buildAndroidProjectProfile({
    hasAndroidDir: true,
    gradleText: `android { defaultConfig { applicationId "com.example.app" } }`,
  });
  const wire = resolveAdbCommand(
    ADB_COMMAND_CATALOG.find((e) => e.id === "appControl.uninstall") as AdbCommandEntry,
    profile
  );
  assert.equal(wire.commandTemplate, "adb uninstall {applicationId}");
  assert.equal(wire.command, "adb uninstall com.example.app");
  assert.deepEqual(wire.autoFilled, ["applicationId"]);
  assert.equal(wire.prompts, false);
  assert.equal(wire.missingProject, false);
});

test("with no Android project a row previews the prompt it will raise, and says so", () => {
  const wire = resolveAdbCommand(
    ADB_COMMAND_CATALOG.find((e) => e.id === "appControl.uninstall") as AdbCommandEntry,
    emptyAndroidProjectProfile()
  );
  assert.ok(wire.command.includes("${prompt:"));
  assert.equal(wire.missingProject, true);
  assert.equal(wire.prompts, true);
  assert.deepEqual(wire.autoFilled, []);
});

test("every payload row previews a command with no unresolved {token}", () => {
  for (const cmd of commands(buildRemoteControlPayload())) {
    const wire = cmd as unknown as { command: string };
    assert.equal(
      wire.command.replace(/\$\{[^}]*\}/g, "").includes("{"),
      false,
      `${cmd.id} previews an unresolved token: ${wire.command}`
    );
  }
});

// --- recent / frequent ranking ---------------------------------------------

test("recency orders the Recent group, most recent first", () => {
  const ranked = rankRecentAdbEntries(ADB_COMMAND_CATALOG, [
    "files.push",
    "appControl.install",
  ]);
  assert.deepEqual(ranked.map((e) => e.id), ["files.push", "appControl.install"]);
});

test("a remembered id that is no longer in the catalog is skipped, not rendered empty", () => {
  const ranked = rankRecentAdbEntries(ADB_COMMAND_CATALOG, ["gone.forever", "files.pull"]);
  assert.deepEqual(ranked.map((e) => e.id), ["files.pull"]);
});

test("lifetime counts fill the Recent group below the recency window", () => {
  const ranked = rankRecentAdbEntries(
    ADB_COMMAND_CATALOG,
    ["files.push"],
    { "appControl.launch": 9, "deviceInfo.battery": 2 }
  );
  assert.deepEqual(ranked.map((e) => e.id), [
    "files.push",
    "appControl.launch",
    "deviceInfo.battery",
  ]);
});

test("the Recent group is the first group, and duplicates rather than relocates its rows", () => {
  const payload = buildRemoteControlPayload({ recent: ["appControl.uninstall"] });
  assert.equal(payload.groups[0].id, RECENT_GROUP_ID);
  assert.deepEqual(payload.groups[0].commands.map((c) => c.id), ["appControl.uninstall"]);
  const appControl = payload.groups.find((g) => g.id === "appControl");
  assert.ok(appControl?.commands.some((c) => c.id === "appControl.uninstall"));
  assert.equal(payload.shown, ADB_COMMAND_CATALOG.length, "the count still means the catalog");
});

test("no history means no Recent group at all", () => {
  assert.equal(buildRemoteControlPayload().groups[0].id, ADB_COMMAND_GROUPS[0]);
});

test("the Recent group respects the active search", () => {
  const payload = buildRemoteControlPayload({
    query: "push",
    recent: ["appControl.uninstall", "files.push"],
  });
  assert.equal(payload.groups[0].id, RECENT_GROUP_ID);
  assert.deepEqual(payload.groups[0].commands.map((c) => c.id), ["files.push"]);
});
