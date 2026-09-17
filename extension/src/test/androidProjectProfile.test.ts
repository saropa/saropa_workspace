// Unit tests for the Android/Flutter project-profile detector (section 1 of
// MOBILE_REMOTE_CONTROL_PLAN). Pure parsing only — inline fixtures in, profile
// out; the cache and the FileSystemWatcher wrapper are deliberately untested here
// because they are thin glue over these functions and need the extension host.
//
// The load-bearing claim of the whole module is that it never throws: it runs on
// every workspace the extension opens, most of which are not Android projects, and
// many of which will be mid-edit when a watcher fires. Several cases below feed it
// truncated and nonsense input for exactly that reason.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseBuildGradle,
  parsePubspec,
  parseAndroidManifest,
  buildAndroidProjectProfile,
  emptyAndroidProjectProfile,
} from "../model/androidProjectProfile";

// --- build.gradle ----------------------------------------------------------

const SIMPLE_GRADLE = `
plugins {
    id 'com.android.application'
}

android {
    namespace 'com.example.simple'
    compileSdkVersion 34

    defaultConfig {
        applicationId "com.example.simple"
        minSdkVersion 21
        targetSdkVersion 34
        versionCode 7
    }

    buildTypes {
        release {
            minifyEnabled true
        }
    }
}
`;

const MULTI_FLAVOR_GRADLE = `
android {
    defaultConfig {
        applicationId "com.example.app"
        minSdk = 23
        targetSdk = 34
    }

    flavorDimensions "environment"

    productFlavors {
        dev {
            dimension "environment"
            applicationIdSuffix ".dev"
        }
        staging {
            dimension "environment"
            applicationIdSuffix ".staging"
        }
        prod {
            dimension "environment"
        }
        whitelabel {
            dimension "environment"
            applicationId "com.other.brand"
        }
    }

    buildTypes {
        debug {
            applicationIdSuffix ".debug"
        }
        release {
            signingConfig signingConfigs.release
        }
    }
}
`;

const KTS_GRADLE = `
android {
    defaultConfig {
        applicationId = "com.example.kts"
        minSdk = 24
        targetSdk = 35
    }
    productFlavors {
        create("free") {
            applicationIdSuffix = ".free"
        }
        create("paid") {
            applicationId = "com.example.kts.paid"
        }
    }
}
`;

test("a single-flavor gradle file yields one default application id and both SDK levels", () => {
  const parsed = parseBuildGradle(SIMPLE_GRADLE);
  assert.equal(parsed.defaultApplicationId, "com.example.simple");
  assert.equal(parsed.minSdk, 21);
  assert.equal(parsed.targetSdk, 34);
  // The declared release build type resolves to the unsuffixed id, so it is
  // listed alongside "default" rather than dropped.
  assert.deepEqual(
    parsed.applicationIds.map((v) => [v.variant, v.applicationId]),
    [
      ["default", "com.example.simple"],
      ["release", "com.example.simple"],
    ]
  );
});

test("product flavors and build types resolve suffixes and overrides", () => {
  const byVariant = new Map(
    parseBuildGradle(MULTI_FLAVOR_GRADLE).applicationIds.map((v) => [v.variant, v])
  );
  assert.equal(byVariant.get("default")?.applicationId, "com.example.app");
  assert.equal(byVariant.get("dev")?.applicationId, "com.example.app.dev");
  assert.equal(byVariant.get("dev")?.suffix, ".dev");
  assert.equal(byVariant.get("staging")?.applicationId, "com.example.app.staging");
  // A flavor with no id of its own inherits the defaultConfig id unchanged.
  assert.equal(byVariant.get("prod")?.applicationId, "com.example.app");
  assert.equal(byVariant.get("prod")?.suffix, undefined);
  // An outright override replaces the base id rather than suffixing it.
  assert.equal(byVariant.get("whitelabel")?.applicationId, "com.other.brand");
  // Build types carry suffixes just as often as flavors do.
  assert.equal(byVariant.get("debug")?.applicationId, "com.example.app.debug");
  assert.equal(byVariant.get("release")?.applicationId, "com.example.app");
});

test("the new minSdk/targetSdk spelling is read as well as the old one", () => {
  const parsed = parseBuildGradle(MULTI_FLAVOR_GRADLE);
  assert.equal(parsed.minSdk, 23);
  assert.equal(parsed.targetSdk, 34);
});

test("the Kotlin DSL create(\"name\") flavor form is recognized", () => {
  const parsed = parseBuildGradle(KTS_GRADLE);
  assert.equal(parsed.defaultApplicationId, "com.example.kts");
  assert.equal(parsed.minSdk, 24);
  const byVariant = new Map(parsed.applicationIds.map((v) => [v.variant, v.applicationId]));
  assert.equal(byVariant.get("free"), "com.example.kts.free");
  assert.equal(byVariant.get("paid"), "com.example.kts.paid");
});

test("a commented-out application id is ignored in favour of the live one", () => {
  const parsed = parseBuildGradle(`
android {
    defaultConfig {
        // applicationId "com.example.old"
        /* applicationId "com.example.older" */
        applicationId "com.example.current"
    }
}
`);
  assert.equal(parsed.defaultApplicationId, "com.example.current");
});

test("a non-literal SDK level (Flutter's gradle) reports no number rather than a guess", () => {
  const parsed = parseBuildGradle(`
android {
    defaultConfig {
        applicationId "com.example.flutterapp"
        minSdkVersion flutter.minSdkVersion
        targetSdkVersion flutter.targetSdkVersion
    }
}
`);
  assert.equal(parsed.defaultApplicationId, "com.example.flutterapp");
  assert.equal(parsed.minSdk, undefined);
  assert.equal(parsed.targetSdk, undefined);
});

test("a truncated gradle file degrades instead of throwing", () => {
  const parsed = parseBuildGradle(`
android {
    defaultConfig {
        applicationId "com.example.half"
        minSdkVersion 21
`);
  assert.equal(parsed.defaultApplicationId, "com.example.half");
  assert.equal(parsed.minSdk, 21);
});

test("gradle input with nothing recognizable yields an empty result", () => {
  for (const text of ["", "not gradle at all", "}{}{", "android {"]) {
    const parsed = parseBuildGradle(text);
    assert.deepEqual(parsed.applicationIds, []);
    assert.equal(parsed.defaultApplicationId, undefined);
  }
});

// --- pubspec.yaml ----------------------------------------------------------

const FLUTTER_PUBSPEC = `
name: example_app
description: An example.
version: 1.2.3+4

environment:
  sdk: ">=3.0.0 <4.0.0"

dependencies:
  flutter:
    sdk: flutter
  http: ^1.1.0
  provider: ^6.0.0
  saropa_dart_utils:
    git:
      url: https://github.com/saropa/saropa_dart_utils.git

dev_dependencies:
  flutter_test:
    sdk: flutter
  build_runner: ^2.4.0

flutter:
  uses-material-design: true
  assets:
    - assets/images/
`;

test("a Flutter pubspec yields its dependency names and the Flutter signal", () => {
  const parsed = parsePubspec(FLUTTER_PUBSPEC);
  assert.equal(parsed.isFlutterProject, true);
  assert.deepEqual(parsed.dependencies, [
    "build_runner",
    "flutter",
    "flutter_test",
    "http",
    "provider",
    "saropa_dart_utils",
  ]);
  // A dependency's own nested keys are not packages.
  assert.equal(parsed.dependencies.includes("sdk"), false);
  assert.equal(parsed.dependencies.includes("git"), false);
  assert.equal(parsed.dependencies.includes("url"), false);
  // Neither are unrelated top-level sections.
  assert.equal(parsed.dependencies.includes("environment"), false);
});

test("a pure Dart package reads as dependencies without the Flutter signal", () => {
  const parsed = parsePubspec(`
name: dart_only
dependencies:
  meta: ^1.9.0
dev_dependencies:
  test: ^1.24.0
`);
  assert.equal(parsed.isFlutterProject, false);
  assert.deepEqual(parsed.dependencies, ["meta", "test"]);
});

test("pubspec comments and blank lines are skipped", () => {
  const parsed = parsePubspec(`
# a comment
name: commented
dependencies:
  # http is pinned deliberately
  http: 1.1.0

`);
  assert.deepEqual(parsed.dependencies, ["http"]);
});

test("a malformed or empty pubspec yields an empty result rather than throwing", () => {
  for (const text of ["", "::::", "dependencies:", "- just\n- a\n- list"]) {
    const parsed = parsePubspec(text);
    assert.deepEqual(parsed.dependencies, []);
    assert.equal(parsed.isFlutterProject, false);
  }
});

// --- AndroidManifest.xml ---------------------------------------------------

const MANIFEST = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.CAMERA" />
    <uses-permission-sdk-23 android:name="android.permission.ACCESS_FINE_LOCATION" />
    <application android:label="example">
        <activity
            android:name=".MainActivity"
            android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
            <intent-filter android:autoVerify="true">
                <action android:name="android.intent.action.VIEW" />
                <data android:scheme="https" android:host="example.com" />
                <data android:scheme="exampleapp" android:host="open" />
            </intent-filter>
            <intent-filter>
                <data android:scheme="custom" />
            </intent-filter>
        </activity>
        <activity android:name=".SecondActivity" android:exported="false" />
        <activity-alias android:name=".AliasActivity" android:exported="true" />
    </application>
</manifest>
`;

test("manifest permissions include the sdk-gated form and are deduped/sorted", () => {
  const parsed = parseAndroidManifest(MANIFEST);
  assert.deepEqual(parsed.permissions, [
    "android.permission.ACCESS_FINE_LOCATION",
    "android.permission.CAMERA",
    "android.permission.INTERNET",
  ]);
});

test("only exported activities (and aliases) are reported", () => {
  const parsed = parseAndroidManifest(MANIFEST);
  assert.deepEqual(parsed.exportedActivities, [".AliasActivity", ".MainActivity"]);
});

test("deep links pair scheme with host, including a scheme with no host", () => {
  const parsed = parseAndroidManifest(MANIFEST);
  assert.deepEqual(parsed.deepLinks, [
    { scheme: "https", host: "example.com" },
    { scheme: "exampleapp", host: "open" },
    { scheme: "custom", host: "" },
  ]);
});

test("a scheme and host split across sibling data tags are combined", () => {
  const parsed = parseAndroidManifest(`
<intent-filter>
    <data android:scheme="myapp" />
    <data android:host="one" />
    <data android:host="two" />
</intent-filter>
`);
  assert.deepEqual(parsed.deepLinks, [
    { scheme: "myapp", host: "one" },
    { scheme: "myapp", host: "two" },
  ]);
});

test("a manifest with no intent filters or permissions yields empty lists", () => {
  const parsed = parseAndroidManifest(`
<manifest><application><activity android:name=".A" /></application></manifest>
`);
  assert.deepEqual(parsed.permissions, []);
  assert.deepEqual(parsed.deepLinks, []);
  assert.deepEqual(parsed.exportedActivities, []);
});

test("malformed manifest input yields a partial answer rather than throwing", () => {
  for (const text of ["", "<manifest", "<<<>>>", "<intent-filter><data android:scheme="]) {
    const parsed = parseAndroidManifest(text);
    assert.deepEqual(parsed.permissions, []);
    assert.deepEqual(parsed.exportedActivities, []);
  }
  // An unterminated intent-filter simply contributes no links.
  assert.deepEqual(
    parseAndroidManifest(`<intent-filter><data android:scheme="x" android:host="y" />`)
      .deepLinks,
    []
  );
});

// --- assembled profile -----------------------------------------------------

test("a workspace with none of the files is not an Android project", () => {
  const profile = buildAndroidProjectProfile({});
  assert.equal(profile.hasAndroidProject, false);
  assert.deepEqual(profile, emptyAndroidProjectProfile());
});

test("a pure Dart package reports Flutter facts but no Android project", () => {
  const profile = buildAndroidProjectProfile({ pubspecText: FLUTTER_PUBSPEC });
  // No android/ directory means nothing for adb to target, even though the
  // Flutter and dependency signals are still useful to the caller.
  assert.equal(profile.hasAndroidProject, false);
  assert.equal(profile.isFlutterProject, true);
  assert.equal(profile.dependencies.includes("provider"), true);
  assert.deepEqual(profile.applicationIds, []);
});

test("a bare native Android project is an Android project but not a Flutter one", () => {
  const profile = buildAndroidProjectProfile({
    hasAndroidDir: true,
    gradleText: SIMPLE_GRADLE,
    manifestText: MANIFEST,
  });
  assert.equal(profile.hasAndroidProject, true);
  assert.equal(profile.isFlutterProject, false);
  assert.deepEqual(profile.dependencies, []);
  assert.equal(profile.defaultApplicationId, "com.example.simple");
  assert.equal(profile.minSdk, 21);
  assert.equal(profile.permissions.length, 3);
  assert.equal(profile.deepLinks.length, 3);
});

test("a multi-flavor Flutter app reports every variant plus the Flutter signal", () => {
  const profile = buildAndroidProjectProfile({
    hasAndroidDir: true,
    gradleText: MULTI_FLAVOR_GRADLE,
    pubspecText: FLUTTER_PUBSPEC,
    manifestText: MANIFEST,
  });
  assert.equal(profile.hasAndroidProject, true);
  assert.equal(profile.isFlutterProject, true);
  assert.deepEqual(
    profile.applicationIds.map((v) => v.variant).sort(),
    ["debug", "default", "dev", "prod", "release", "staging", "whitelabel"]
  );
  assert.deepEqual(profile.exportedActivities, [".AliasActivity", ".MainActivity"]);
});

test("an android directory with unreadable/absent files still reads as an Android project", () => {
  const profile = buildAndroidProjectProfile({ hasAndroidDir: true });
  assert.equal(profile.hasAndroidProject, true);
  assert.deepEqual(profile.applicationIds, []);
  assert.equal(profile.defaultApplicationId, undefined);
  assert.equal(profile.minSdk, undefined);
});
