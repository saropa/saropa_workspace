// Shape of the Android project profile (see androidProjectProfile.ts for what it is
// for). Types only, split out so the parser and the reader modules share them.

// One resolvable package id: a product flavor, a build type, or the bare
// defaultConfig ("default"). `applicationId` is the id a command should actually
// target — base id with any applicationIdSuffix already appended — so a caller
// never has to re-apply the suffix itself.
export interface AndroidVariantId {
  // Flavor / build-type name as written in build.gradle, or "default" for the
  // defaultConfig applicationId with no variant applied.
  variant: string;
  // Fully resolved package id, e.g. "com.example.app.dev".
  applicationId: string;
  // The suffix that was appended, when the variant declared one. Kept so the UI
  // can explain where a non-obvious id came from.
  suffix?: string;
}

// One scheme/host pair taken from a manifest <intent-filter>, the input to a
// generated `adb shell am start -a android.intent.action.VIEW -d <scheme>://<host>`
// deep-link test command. `host` is "" for a filter that declares a scheme but no
// host (a custom-scheme link with no authority).
export interface AndroidDeepLink {
  scheme: string;
  host: string;
}

// Everything the catalog layer needs to know about the project it is running in.
// Every field degrades to empty/undefined rather than being absent, so a consumer
// can read it unconditionally after checking `hasAndroidProject`.
export interface AndroidProjectProfile {
  // False when the folder has no android/ directory and none of the parsed files
  // were found — the "this is not an Android project" signal that lets callers
  // no-op cleanly instead of rendering an empty mobile section.
  hasAndroidProject: boolean;
  // Every package id the project can produce, defaultConfig first. Empty when no
  // applicationId could be read (an android/ folder whose gradle file is a
  // variant shape this scanner does not recognize).
  applicationIds: AndroidVariantId[];
  // The defaultConfig applicationId (no suffix applied), when one was found. The
  // sensible default target when the user has not picked a flavor.
  defaultApplicationId?: string;
  // minSdkVersion / targetSdkVersion as numbers. Undefined when absent or when
  // the value is an expression rather than a literal (e.g. Flutter's
  // `flutter.minSdkVersion`), since this scanner does not evaluate Gradle.
  minSdk?: number;
  targetSdk?: number;
  // True when pubspec.yaml declares a top-level `flutter:` section or depends on
  // the flutter SDK — i.e. Flutter commands are relevant, as opposed to a bare
  // native Android project (or a pure Dart package, which has neither).
  isFlutterProject: boolean;
  // Package names from pubspec.yaml dependencies + dev_dependencies, deduped and
  // sorted. Names only: versions and git/path sources are not modeled, because
  // the catalog only ever asks "is package X present".
  dependencies: string[];
  // Declared <uses-permission> names, e.g. "android.permission.CAMERA".
  permissions: string[];
  deepLinks: AndroidDeepLink[];
  // Names of activities (and activity-aliases) declared android:exported="true" —
  // the ones an `adb shell am start -n <pkg>/<activity>` can actually launch.
  exportedActivities: string[];
}

// The raw file contents a profile is built from. Passing text (not paths) is what
// keeps the whole parse layer testable with inline fixtures; the reader below is
// the only thing that turns a workspace folder into one of these.
export interface AndroidProfileSources {
  // android/app/build.gradle or android/app/build.gradle.kts.
  gradleText?: string;
  pubspecText?: string;
  // android/app/src/main/AndroidManifest.xml.
  manifestText?: string;
  // Whether an android/ directory exists, so a project mid-setup (android/ there
  // but no app/build.gradle yet) still reads as an Android project.
  hasAndroidDir?: boolean;
}
