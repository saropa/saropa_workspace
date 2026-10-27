// Edge cases for the gradle / pubspec / manifest scanners, beyond the happy paths
// in androidProjectProfile.test.ts: comment handling around strings, fallbacks when a
// block is missing, de-duplication of variants, and indentation-only pubspec rules.

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseBuildGradle, parsePubspec, parseAndroidManifest } from "../model/androidProfileParse";

test("comment markers inside a quoted string are not treated as comments", () => {
  const parsed = parseBuildGradle(`android { defaultConfig { applicationId "com.example//app" // trailing\n minSdk = 21 } }`);
  assert.equal(parsed.defaultApplicationId, "com.example//app");
  assert.equal(parsed.minSdk, 21);
});

test("a block comment hides a whole commented-out flavor", () => {
  const parsed = parseBuildGradle(`android {
    defaultConfig { applicationId "com.a" }
    productFlavors {
      /* old { applicationIdSuffix ".old" } */
      live { applicationIdSuffix ".live" }
    }
  }`);
  assert.deepEqual(parsed.applicationIds.map((v) => v.applicationId), ["com.a", "com.a.live"]);
});

test("without a defaultConfig block the id is read from the android block", () => {
  const parsed = parseBuildGradle(`android { applicationId "com.top.level"\n targetSdkVersion 33 }`);
  assert.equal(parsed.defaultApplicationId, "com.top.level");
  assert.equal(parsed.targetSdk, 33);
});

test("without an android block the whole file is scanned", () => {
  const parsed = parseBuildGradle(`applicationId 'com.bare'`);
  assert.deepEqual(parsed.applicationIds, [{ variant: "default", applicationId: "com.bare" }]);
});

test("a flavor named like an existing variant is listed once", () => {
  const parsed = parseBuildGradle(`android {
    defaultConfig { applicationId "com.a" }
    productFlavors { release { applicationIdSuffix ".r" } }
    buildTypes { release { applicationIdSuffix ".other" } }
  }`);
  assert.deepEqual(
    parsed.applicationIds.map((v) => [v.variant, v.applicationId]),
    [["default", "com.a"], ["release", "com.a.r"]]
  );
});

test("a flavor with no usable id is skipped when there is no default id either", () => {
  const parsed = parseBuildGradle(`android { productFlavors { lonely { dimension "x" } } }`);
  assert.deepEqual(parsed.applicationIds, []);
  assert.equal(parsed.defaultApplicationId, undefined);
});

test("undefined or empty text parses to nothing", () => {
  assert.deepEqual(parseBuildGradle(undefined as unknown as string), { applicationIds: [] });
  assert.deepEqual(parsePubspec(undefined as unknown as string), { dependencies: [], isFlutterProject: false });
  assert.deepEqual(parseAndroidManifest(undefined as unknown as string), {
    permissions: [],
    deepLinks: [],
    exportedActivities: [],
  });
});

test("pubspec: a dependency's own keys and other sections are not packages", () => {
  const parsed = parsePubspec(`name: app
dependencies:
  flutter:
    sdk: flutter
  http: ^1.0.0
  local_pkg:
    path: ../local_pkg
dev_dependencies:
  test: ^1.0.0
environment:
  sdk: ">=3.0.0"
`);
  assert.deepEqual(parsed.dependencies, ["flutter", "http", "local_pkg", "test"]);
  assert.equal(parsed.isFlutterProject, true);
});

test("pubspec: a flutter dependency alone marks a Flutter project", () => {
  const parsed = parsePubspec(`dependencies:\n  flutter:\n    sdk: flutter\n`);
  assert.equal(parsed.isFlutterProject, true);
});

test("pubspec: a flutter key only counts at the top level", () => {
  const parsed = parsePubspec(`name: tool\nenvironment:\n  flutter: ">=3.0.0"\n`);
  assert.equal(parsed.isFlutterProject, false);
});

test("manifest: single-quoted attributes and uses-permission-sdk tags are read", () => {
  const parsed = parseAndroidManifest(`<manifest>
    <uses-permission android:name='android.permission.CAMERA'/>
    <uses-permission-sdk-23 android:name="android.permission.READ_CONTACTS"/>
    <activity-alias android:name=".Alias" android:exported="true"/>
    <activity android:name=".Hidden" android:exported="false"/>
  </manifest>`);
  assert.deepEqual(parsed.permissions, ["android.permission.CAMERA", "android.permission.READ_CONTACTS"]);
  assert.deepEqual(parsed.exportedActivities, [".Alias"]);
});

test("manifest: the same link in two filters is reported once", () => {
  const filter = `<intent-filter><data android:scheme="https" android:host="a.test"/></intent-filter>`;
  const parsed = parseAndroidManifest(`<application>${filter}${filter}</application>`);
  assert.deepEqual(parsed.deepLinks, [{ scheme: "https", host: "a.test" }]);
});

test("manifest: hosts without a scheme produce no link", () => {
  const parsed = parseAndroidManifest(`<intent-filter><data android:host="orphan.test"/></intent-filter>`);
  assert.deepEqual(parsed.deepLinks, []);
});
