// Unit tests for the section registry (MOBILE_REMOTE_CONTROL_PLAN, "UI restructure"
// item 1) and the context keys published from it (item 3).
//
// The registry is pure data plus pure relevance functions, so it runs under
// node --test with no extension host; l10n() is pure too, so the title-key coverage
// test resolves through the real English catalog rather than re-implementing lookup.
// The context publishers are thin setContext glue, and the vscode stub records every
// executeCommand call, so the keys they set are assertable directly.
//
// The load-bearing claims: ids are unique (they key persistence), Mobile Remote
// Control is promoted on an Android project and still reachable everywhere else,
// lookup answers honestly for an unknown id, and the three context keys carry the
// booleans a `when` clause will read.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SECTION_REGISTRY,
  findSection,
  mobileRemoteControlRelevance,
  orderedSections,
  sectionsByRelevance,
} from "../model/sections";
import { emptyAndroidProjectProfile } from "../model/androidProjectProfile";
import type { AndroidProjectProfile } from "../model/androidProjectProfile";
import {
  HAS_ANDROID_KEY,
  HAS_DEVICE_KEY,
  HAS_FLUTTER_KEY,
  publishDeviceContext,
  publishProjectContext,
} from "../activation/sectionContext";
import { adbMissing } from "../exec/adbEnvironment";
import { l10n } from "../i18n/l10n";
import { __recordedCommands, __resetRecordedCommands } from "./_stub/vscode";

function profile(overrides: Partial<AndroidProjectProfile>): AndroidProjectProfile {
  return { ...emptyAndroidProjectProfile(), ...overrides };
}

// The value the last setContext call passed for `key`, or undefined when the key was
// never set since the log was reset.
function contextValue(key: string): unknown {
  const calls = __recordedCommands().filter(
    (c) => c.command === "setContext" && c.args[0] === key
  );
  return calls.length === 0 ? undefined : calls[calls.length - 1]?.args[1];
}

// --- shape -----------------------------------------------------------------

test("every section id is unique", () => {
  const ids = SECTION_REGISTRY.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length, `duplicate id in ${ids.join(", ")}`);
});

test("the registry covers every capability the plan names", () => {
  const ids = new Set(SECTION_REGISTRY.map((s) => s.id));
  for (const id of [
    "shortcuts",
    "recipes",
    "watches",
    "projectFiles",
    "scripts",
    "notes",
    "dashboard",
    "schedule",
    "planner",
    "mobileRemoteControl",
  ]) {
    assert.ok(ids.has(id), `registry is missing ${id}`);
  }
});

test("every descriptor carries an entry command, an icon and search tags", () => {
  for (const section of SECTION_REGISTRY) {
    assert.match(section.entryCommand, /^saropaWorkspace\./, `${section.id} entry`);
    assert.ok(section.icon.trim() !== "", `${section.id} has no icon`);
    assert.equal(
      /^\$\(/.test(section.icon),
      false,
      `${section.id} icon should be a bare codicon name`
    );
    assert.ok(section.tags.length > 0, `${section.id} has no tags`);
  }
});

test("every title key resolves to real English text", () => {
  for (const section of SECTION_REGISTRY) {
    const value = l10n(section.titleKey);
    assert.notEqual(value, section.titleKey, `missing en.json value for ${section.titleKey}`);
    assert.notEqual(value.trim(), "", `${section.titleKey} is blank`);
  }
});

test("Mobile Remote Control's entry point is the one contributed command", () => {
  assert.equal(
    findSection("mobileRemoteControl")?.entryCommand,
    "saropaWorkspace.openRemoteControl"
  );
});

// --- relevance -------------------------------------------------------------

test("Mobile Remote Control is primary on an Android project", () => {
  assert.equal(
    mobileRemoteControlRelevance(profile({ hasAndroidProject: true })),
    "primary"
  );
});

test("Mobile Remote Control stays available without an Android project", () => {
  // Never hidden: adb is useful against a device from any workspace, and a section
  // nobody can find is worse than one that is merely not promoted.
  assert.equal(
    mobileRemoteControlRelevance(profile({ hasAndroidProject: false })),
    "available"
  );
});

test("an unresolved profile reads as available, not hidden", () => {
  assert.equal(mobileRemoteControlRelevance(undefined), "available");
});

test("no section hides itself for any profile this step can produce", () => {
  for (const p of [
    undefined,
    profile({}),
    profile({ hasAndroidProject: true, isFlutterProject: true }),
  ]) {
    for (const section of SECTION_REGISTRY) {
      assert.notEqual(section.relevance(p), "hidden", `${section.id} hid itself`);
    }
  }
});

test("sectionsByRelevance splits the registry by level", () => {
  const nonAndroid = profile({ hasAndroidProject: false });
  assert.deepEqual(
    sectionsByRelevance(nonAndroid, "available").map((s) => s.id),
    ["mobileRemoteControl"]
  );
  const android = profile({ hasAndroidProject: true });
  assert.equal(sectionsByRelevance(android, "available").length, 0);
  assert.equal(sectionsByRelevance(android, "primary").length, SECTION_REGISTRY.length);
});

// --- Control Center row order ----------------------------------------------
//
// orderedSections() is the whole ordering decision the Control Center view makes;
// the TreeDataProvider around it only turns descriptors into rows, so it is tested
// here as pure data rather than through the extension host.

test("orderedSections lists every section for an Android project, in registry order", () => {
  const rows = orderedSections(profile({ hasAndroidProject: true }));
  assert.deepEqual(
    rows.map((s) => s.id),
    SECTION_REGISTRY.map((s) => s.id)
  );
});

test("orderedSections drops available sections below the primary ones", () => {
  // Without an Android project Mobile Remote Control is merely `available`, so it
  // sorts after every `primary` section instead of keeping its registry slot.
  const rows = orderedSections(profile({ hasAndroidProject: false })).map((s) => s.id);
  assert.equal(rows[rows.length - 1], "mobileRemoteControl");
  assert.deepEqual(
    rows.slice(0, -1),
    SECTION_REGISTRY.filter((s) => s.id !== "mobileRemoteControl").map((s) => s.id)
  );
});

test("an unresolved profile still lists every section", () => {
  // "Not read yet" must never silently shrink the index — the whole point of the
  // view is that a section is findable.
  assert.equal(orderedSections(undefined).length, SECTION_REGISTRY.length);
});

test("orderedSections never repeats a section", () => {
  for (const p of [undefined, profile({}), profile({ hasAndroidProject: true })]) {
    const ids = orderedSections(p).map((s) => s.id);
    assert.equal(new Set(ids).size, ids.length);
  }
});

// --- lookup ----------------------------------------------------------------

test("lookup by id returns the descriptor, and undefined for an unknown id", () => {
  assert.equal(findSection("notes")?.id, "notes");
  assert.equal(findSection("nope"), undefined);
  assert.equal(findSection(""), undefined);
});

// --- context keys ----------------------------------------------------------

test("an Android Flutter profile sets both project keys true", () => {
  __resetRecordedCommands();
  publishProjectContext(profile({ hasAndroidProject: true, isFlutterProject: true }));
  assert.equal(contextValue(HAS_ANDROID_KEY), true);
  assert.equal(contextValue(HAS_FLUTTER_KEY), true);
  __resetRecordedCommands();
});

test("a bare native Android profile sets hasAndroid only", () => {
  __resetRecordedCommands();
  publishProjectContext(profile({ hasAndroidProject: true, isFlutterProject: false }));
  assert.equal(contextValue(HAS_ANDROID_KEY), true);
  assert.equal(contextValue(HAS_FLUTTER_KEY), false);
  __resetRecordedCommands();
});

test("an unresolved profile publishes false rather than leaving the keys unset", () => {
  __resetRecordedCommands();
  publishProjectContext(undefined);
  assert.equal(contextValue(HAS_ANDROID_KEY), false);
  assert.equal(contextValue(HAS_FLUTTER_KEY), false);
  __resetRecordedCommands();
});

test("hasDevice counts only devices a command could run against", () => {
  __resetRecordedCommands();
  publishDeviceContext(adbMissing());
  assert.equal(contextValue(HAS_DEVICE_KEY), false);

  __resetRecordedCommands();
  publishDeviceContext({
    available: true,
    devices: { total: 1, ready: 0, unauthorized: 1, offline: 0, serial: "abc" },
    failed: false,
  });
  assert.equal(contextValue(HAS_DEVICE_KEY), false, "unauthorized is not usable");

  __resetRecordedCommands();
  publishDeviceContext({
    available: true,
    devices: { total: 2, ready: 1, unauthorized: 0, offline: 1 },
    failed: false,
  });
  assert.equal(contextValue(HAS_DEVICE_KEY), true);
  __resetRecordedCommands();
});
