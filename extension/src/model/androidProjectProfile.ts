import * as vscode from "vscode";
import {
  AndroidVariantId,
  AndroidProjectProfile,
  AndroidProfileSources,
} from "./androidProfileTypes";
import { parseBuildGradle, parsePubspec, parseAndroidManifest } from "./androidProfileParse";

// Re-exported so existing import paths keep working.
export type {
  AndroidVariantId,
  AndroidDeepLink,
  AndroidProjectProfile,
  AndroidProfileSources,
} from "./androidProfileTypes";
export { parseBuildGradle, parsePubspec, parseAndroidManifest } from "./androidProfileParse";

// Project profile detector (MOBILE_REMOTE_CONTROL_PLAN section 1). Parses the
// Android/Flutter shape of a workspace folder — application ids per variant, the
// SDK floor/target, the Dart dependency list, and the manifest's permissions,
// deep links and exported activities — so the (not yet built) adb command catalog
// can auto-fill package names and show only the command groups a project can
// actually use.
//
// House style, same as the recipe detectors (detectorEcosystem.ts, gitMeta.ts):
// cheap, non-recursive, tolerant of parse failure. build.gradle(.kts) is Groovy /
// Kotlin DSL and pubspec.yaml is YAML, but neither is parsed properly — a real
// Gradle evaluation would mean running Gradle, and a real YAML parse would mean a
// dependency. These are line/brace scanners that recognize the shapes that occur
// in practice and return "unknown" (undefined / empty list) for anything else.
// Nothing here throws on malformed input: a profile is a hint for the UI, never a
// correctness boundary, and the extension runs on every kind of project, most of
// which have no android/ directory at all.
//
// The pure parse functions take text and are unit-tested directly; only the thin
// read/cache/watch wrappers at the bottom touch VS Code.

// The profile of a workspace with nothing Android about it. Also what every read
// failure degrades to, so a caller never has to handle undefined.
export function emptyAndroidProjectProfile(): AndroidProjectProfile {
  return {
    hasAndroidProject: false,
    applicationIds: [],
    isFlutterProject: false,
    dependencies: [],
    permissions: [],
    deepLinks: [],
    exportedActivities: [],
  };
}

// Assemble a profile from already-read file contents. Pure — the unit-testable
// half of the detector, and the seam the VS Code reader below sits on.
//
// `hasAndroidProject` is true when an android/ directory exists OR a gradle file
// or manifest was read. pubspec.yaml alone does NOT make it true: a pure Dart
// package (or a Flutter package with no android/ folder) has nothing for adb to
// target, though its Flutter/dependency signals are still reported.
export function buildAndroidProjectProfile(
  sources: AndroidProfileSources
): AndroidProjectProfile {
  const gradle = sources.gradleText
    ? parseBuildGradle(sources.gradleText)
    : { applicationIds: [] as AndroidVariantId[] };
  const pubspec = sources.pubspecText
    ? parsePubspec(sources.pubspecText)
    : { dependencies: [], isFlutterProject: false };
  const manifest = sources.manifestText
    ? parseAndroidManifest(sources.manifestText)
    : { permissions: [], deepLinks: [], exportedActivities: [] };

  return {
    hasAndroidProject:
      sources.hasAndroidDir === true ||
      sources.gradleText !== undefined ||
      sources.manifestText !== undefined,
    applicationIds: gradle.applicationIds,
    ...(gradle.defaultApplicationId
      ? { defaultApplicationId: gradle.defaultApplicationId }
      : {}),
    ...(gradle.minSdk === undefined ? {} : { minSdk: gradle.minSdk }),
    ...(gradle.targetSdk === undefined ? {} : { targetSdk: gradle.targetSdk }),
    isFlutterProject: pubspec.isFlutterProject,
    dependencies: pubspec.dependencies,
    permissions: manifest.permissions,
    deepLinks: manifest.deepLinks,
    exportedActivities: manifest.exportedActivities,
  };
}

// ---------------------------------------------------------------------------
// VS Code glue: read, cache, watch
// ---------------------------------------------------------------------------

// The files this detector reads, relative to a workspace folder. Also the watch
// globs, so what is parsed and what invalidates the cache cannot drift apart.
export const ANDROID_PROFILE_GLOBS = [
  "android/app/build.gradle",
  "android/app/build.gradle.kts",
  "pubspec.yaml",
  "android/app/src/main/AndroidManifest.xml",
] as const;

async function readText(
  folder: vscode.WorkspaceFolder,
  ...segments: string[]
): Promise<string | undefined> {
  try {
    const bytes = await vscode.workspace.fs.readFile(
      vscode.Uri.joinPath(folder.uri, ...segments)
    );
    return Buffer.from(bytes).toString("utf8");
  } catch {
    return undefined;
  }
}

async function exists(
  folder: vscode.WorkspaceFolder,
  ...segments: string[]
): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(vscode.Uri.joinPath(folder.uri, ...segments));
    return true;
  } catch {
    return false;
  }
}

// Read and parse a workspace folder's profile, bypassing the cache. Never throws:
// every read that misses (the usual case on a non-Android project) reads as an
// absent source, and the result is the empty profile.
export async function parseAndroidProjectProfile(
  folder: vscode.WorkspaceFolder
): Promise<AndroidProjectProfile> {
  const hasAndroidDir = await exists(folder, "android");
  // pubspec is read even without android/ — a Flutter package still reports its
  // dependencies, and the isFlutterProject flag is useful on its own.
  const [groovy, kts, pubspecText, manifestText] = await Promise.all([
    hasAndroidDir ? readText(folder, "android", "app", "build.gradle") : undefined,
    hasAndroidDir ? readText(folder, "android", "app", "build.gradle.kts") : undefined,
    readText(folder, "pubspec.yaml"),
    hasAndroidDir
      ? readText(folder, "android", "app", "src", "main", "AndroidManifest.xml")
      : undefined,
  ]);
  // Groovy wins when a project somehow carries both: it is the file Gradle itself
  // prefers.
  const gradleText = groovy ?? kts;
  return buildAndroidProjectProfile({
    hasAndroidDir,
    ...(gradleText === undefined ? {} : { gradleText }),
    ...(pubspecText === undefined ? {} : { pubspecText }),
    ...(manifestText === undefined ? {} : { manifestText }),
  });
}

// In-memory cache, one entry per workspace folder, keyed by folder fsPath. Unlike
// ShortcutStore's project file this is DERIVED data, not source data: re-parsing
// four small files costs less than the staleness risk of persisting it to disk, so
// it lives only for the window's lifetime and is rebuilt after a reload. What it
// buys is the plan's actual requirement — not re-parsing on every panel open.
const cache = new Map<string, AndroidProjectProfile>();

// The folder's profile, parsed once and reused until invalidated. Concurrent first
// calls may both parse; the parse is pure and the results identical, so the only
// cost is a duplicated read — not worth an in-flight promise map.
export async function getAndroidProjectProfile(
  folder: vscode.WorkspaceFolder
): Promise<AndroidProjectProfile> {
  const key = folder.uri.fsPath;
  const cached = cache.get(key);
  if (cached) {
    return cached;
  }
  const profile = await parseAndroidProjectProfile(folder);
  cache.set(key, profile);
  return profile;
}

// Drop one folder's cached profile, or every folder's when called with no
// argument (a workspace-folder change, or a test resetting global state).
export function invalidateAndroidProjectProfile(folder?: vscode.WorkspaceFolder): void {
  if (!folder) {
    cache.clear();
    return;
  }
  cache.delete(folder.uri.fsPath);
}

// Invalidate and re-read in one step, returning the fresh profile. The single
// entry point for "a watched file changed, get me the new truth".
export async function refreshAndroidProjectProfile(
  folder: vscode.WorkspaceFolder
): Promise<AndroidProjectProfile> {
  invalidateAndroidProjectProfile(folder);
  return getAndroidProjectProfile(folder);
}

// Watch the profile's source files in one folder; on any create/change/delete,
// invalidate the cache, re-parse, and hand the fresh profile to `onChange`. The
// caller owns the returned disposable (push it on context.subscriptions), matching
// how createConfigDirWatchers in activation/wiringWatchers.ts bundles a watcher
// plus its listeners into one Disposable.from.
//
// Not debounced: these four files change on a hand edit or a branch switch, not in
// bursts, and a re-parse is four small reads. A caller that wants coalescing can
// debounce its own onChange.
export function watchAndroidProjectProfile(
  folder: vscode.WorkspaceFolder,
  onChange: (profile: AndroidProjectProfile) => void
): vscode.Disposable {
  const disposables: vscode.Disposable[] = [];
  const reload = (): void => {
    void refreshAndroidProjectProfile(folder).then(onChange);
  };
  for (const glob of ANDROID_PROFILE_GLOBS) {
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(folder, glob)
    );
    disposables.push(
      watcher,
      watcher.onDidChange(reload),
      watcher.onDidCreate(reload),
      watcher.onDidDelete(reload)
    );
  }
  return vscode.Disposable.from(...disposables);
}
