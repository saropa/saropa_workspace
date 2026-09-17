// Unit tests for adb command-template substitution (MOBILE_REMOTE_CONTROL_PLAN section
// 4, build-order step 5). model/adbCommandSubstitution.ts is pure — an entry and a
// project profile in, a runnable command line out, no vscode and no prompt — so every
// rule the execution path depends on is asserted here rather than behind a webview.
//
// The load-bearing claim, which the whole feature rests on: a `{token}` NEVER survives.
// A workspace with no Android project must produce a command that ASKS for a package id,
// not one that runs `adb uninstall {applicationId}` against nothing.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extractAdbTokens,
  needsInteractiveInput,
  substituteAdbCommand,
} from "../model/adbCommandSubstitution";
import { ADB_COMMAND_CATALOG, type AdbCommandEntry } from "../model/adbCommandCatalog";
import {
  buildAndroidProjectProfile,
  emptyAndroidProjectProfile,
  type AndroidProjectProfile,
} from "../model/androidProjectProfile";

// A substituted command with every `${prompt:...}` / `${pick:...}` removed. What remains
// must contain no brace at all: that is the "no {token} survives" invariant, stated in a
// way that does not trip over the interactive tokens' own braces.
function withoutInteractive(command: string): string {
  return command.replace(/\$\{[^}]*\}/g, "");
}

function entry(id: string): AdbCommandEntry {
  const found = ADB_COMMAND_CATALOG.find((e) => e.id === id);
  assert.ok(found, `catalog entry ${id} must exist`);
  return found as AdbCommandEntry;
}

// A single-flavor Android app with one declared deep link and one permission.
function singleFlavorProfile(): AndroidProjectProfile {
  return buildAndroidProjectProfile({
    hasAndroidDir: true,
    gradleText: `
android {
  defaultConfig {
    applicationId "com.example.app"
    minSdkVersion 24
  }
}
`,
    manifestText: `<?xml version="1.0"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
  <uses-permission android:name="android.permission.CAMERA" />
  <application>
    <activity android:name=".MainActivity" android:exported="true">
      <intent-filter>
        <action android:name="android.intent.action.VIEW" />
        <data android:scheme="https" android:host="example.com" />
      </intent-filter>
    </activity>
  </application>
</manifest>`,
  });
}

// --- extractAdbTokens ------------------------------------------------------

test("every {token} in a template is found once, in order", () => {
  assert.deepEqual(
    extractAdbTokens("adb shell input swipe {x} {y} {x2} {y2} {durationMs}"),
    ["x", "y", "x2", "y2", "durationMs"]
  );
});

test("a repeated token is reported once", () => {
  assert.deepEqual(extractAdbTokens("adb reverse tcp:{port} tcp:{port}"), ["port"]);
});

test("a template with no token yields none", () => {
  assert.deepEqual(extractAdbTokens("adb devices -l"), []);
});

// --- token present in the profile ------------------------------------------

test("an application id is auto-filled from the project profile", () => {
  const result = substituteAdbCommand(entry("appControl.uninstall"), singleFlavorProfile());
  assert.equal(result.command, "adb uninstall com.example.app");
  assert.deepEqual(result.resolved, { applicationId: "com.example.app" });
  assert.deepEqual(result.interactive, []);
  assert.deepEqual(result.missingFromProfile, []);
  assert.equal(needsInteractiveInput(result), false);
});

test("a deep link's scheme and host both come from the manifest", () => {
  const result = substituteAdbCommand(entry("deepLinks.open"), singleFlavorProfile());
  assert.equal(
    result.command,
    "adb shell am start -a android.intent.action.VIEW -d https://example.com"
  );
  assert.deepEqual(result.missingFromProfile, []);
});

// --- multiple tokens in one template ---------------------------------------

test("several tokens in one template are each resolved or asked independently", () => {
  const result = substituteAdbCommand(entry("deepLinks.open-path"), singleFlavorProfile());
  // scheme/host/applicationId come from the project; the path is only the user's to know.
  assert.equal(
    result.command,
    "adb shell am start -a android.intent.action.VIEW -d https://example.com" +
      "${prompt:Deep-link path and query, e.g. /order/42?ref=email} com.example.app"
  );
  assert.deepEqual(Object.keys(result.resolved).sort(), [
    "applicationId",
    "host",
    "scheme",
  ]);
  assert.deepEqual(result.interactive, ["path"]);
  assert.equal(withoutInteractive(result.command).includes("{"), false, "no {token} survives");
});

test("a repeated token is substituted at every occurrence", () => {
  const result = substituteAdbCommand(entry("connection.reverse"));
  assert.equal(
    result.command,
    "adb reverse tcp:${prompt:Port number} tcp:${prompt:Port number}"
  );
  assert.deepEqual(result.interactive, ["port"], "asked once, substituted twice");
});

// --- token absent from the profile -----------------------------------------

test("no Android project degrades an application id to a prompt, never a broken string", () => {
  const result = substituteAdbCommand(
    entry("appControl.clear-data"),
    emptyAndroidProjectProfile()
  );
  assert.equal(result.command, "adb shell pm clear ${prompt:Application id (package name)}");
  assert.equal(result.command.includes("{applicationId}"), false);
  assert.deepEqual(result.missingFromProfile, ["applicationId"]);
  assert.deepEqual(result.interactive, ["applicationId"]);
  assert.deepEqual(result.resolved, {});
});

test("a profile omitted entirely behaves exactly like a non-Android profile", () => {
  const none = substituteAdbCommand(entry("appControl.clear-data"));
  const empty = substituteAdbCommand(
    entry("appControl.clear-data"),
    emptyAndroidProjectProfile()
  );
  assert.deepEqual(none, empty);
});

test("an Android project whose gradle yields no application id still reports it missing", () => {
  const profile = buildAndroidProjectProfile({ hasAndroidDir: true });
  assert.equal(profile.hasAndroidProject, true);
  const result = substituteAdbCommand(entry("appControl.force-stop"), profile);
  assert.deepEqual(result.missingFromProfile, ["applicationId"]);
});

test("a non-project token is asked for without being called a missing project value", () => {
  const result = substituteAdbCommand(entry("files.push"), singleFlavorProfile());
  assert.deepEqual(result.interactive, ["localPath", "remotePath"]);
  assert.deepEqual(
    result.missingFromProfile,
    [],
    "a file path was never the project's to know"
  );
});

test("a connection host is asked for, not taken from the manifest's deep links", () => {
  const result = substituteAdbCommand(entry("connection.connect"), singleFlavorProfile());
  assert.equal(result.command.includes("example.com"), false);
  assert.deepEqual(result.interactive, ["host", "port"]);
  assert.deepEqual(result.missingFromProfile, []);
});

// --- several candidates become a pick --------------------------------------

test("a multi-flavor project offers its application ids as a pick", () => {
  const profile = buildAndroidProjectProfile({
    hasAndroidDir: true,
    gradleText: `
android {
  defaultConfig { applicationId "com.example.app" }
  productFlavors {
    dev { applicationIdSuffix ".dev" }
    staging { applicationIdSuffix ".staging" }
  }
}
`,
  });
  const result = substituteAdbCommand(entry("appControl.uninstall"), profile);
  assert.match(result.command, /^adb uninstall \$\{pick:/);
  assert.ok(result.command.includes("com.example.app.dev"));
  assert.deepEqual(result.interactive, ["applicationId"]);
  assert.deepEqual(result.missingFromProfile, [], "the project knows them, it just has several");
});

test("declared permissions become a pick, an undeclared one stays a free prompt", () => {
  const withPermissions = substituteAdbCommand(
    entry("permissions.grant"),
    singleFlavorProfile()
  );
  // Exactly one declared permission collapses to a literal: nothing to choose.
  assert.equal(
    withPermissions.command,
    "adb shell pm grant com.example.app android.permission.CAMERA"
  );
  const withNone = substituteAdbCommand(entry("permissions.grant"), emptyAndroidProjectProfile());
  assert.ok(withNone.command.includes("${prompt:"));
  assert.deepEqual(
    withNone.missingFromProfile,
    ["applicationId"],
    "a permission is the user's call, so its absence is not a missing project value"
  );
});

// --- caller-supplied params ------------------------------------------------

test("a caller-supplied value wins over the profile and over asking", () => {
  const result = substituteAdbCommand(entry("appControl.uninstall"), singleFlavorProfile(), {
    applicationId: "com.example.other",
  });
  assert.equal(result.command, "adb uninstall com.example.other");
  assert.deepEqual(result.interactive, []);
});

test("a supplied value satisfies a token the profile could never answer", () => {
  const result = substituteAdbCommand(entry("files.push"), undefined, {
    localPath: "./build/app.apk",
    remotePath: "/sdcard/app.apk",
  });
  assert.equal(result.command, "adb push ./build/app.apk /sdcard/app.apk");
  assert.equal(needsInteractiveInput(result), false);
});

// --- destructive entries ---------------------------------------------------

test("a destructive entry substitutes exactly like any other — the flag gates the confirm, not the string", () => {
  const destructive = ADB_COMMAND_CATALOG.filter((e) => e.destructive);
  assert.ok(destructive.length > 0);
  for (const e of destructive) {
    const result = substituteAdbCommand(e, singleFlavorProfile());
    assert.equal(
      withoutInteractive(result.command).includes("{"),
      false,
      `${e.id} left an unresolved token: ${result.command}`
    );
    assert.ok(result.command.startsWith("adb "), `${e.id} must still be an adb invocation`);
  }
});

// --- the whole catalog -----------------------------------------------------

test("no catalog entry can ever emit an unresolved {token}, with or without a project", () => {
  for (const profile of [undefined, emptyAndroidProjectProfile(), singleFlavorProfile()]) {
    for (const e of ADB_COMMAND_CATALOG) {
      const result = substituteAdbCommand(e, profile);
      assert.equal(
        withoutInteractive(result.command).includes("{"),
        false,
        `${e.id} left an unresolved token: ${result.command}`
      );
    }
  }
});

test("every token the catalog uses has a human prompt label", () => {
  for (const e of ADB_COMMAND_CATALOG) {
    for (const token of extractAdbTokens(e.commandTemplate)) {
      const result = substituteAdbCommand(e, undefined, {});
      // A token that falls back to its own bare name would render as "${prompt:x2}";
      // assert the catalog's tokens all resolve to a real sentence instead.
      if (result.interactive.includes(token)) {
        assert.equal(
          result.command.includes(`\${prompt:${token}}`),
          false,
          `token "${token}" (used by ${e.id}) has no adb.token.${token} string`
        );
      }
    }
  }
});
