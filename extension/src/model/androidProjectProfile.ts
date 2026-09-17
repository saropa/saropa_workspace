import * as vscode from "vscode";

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

// ---------------------------------------------------------------------------
// Gradle (Groovy / Kotlin DSL)
// ---------------------------------------------------------------------------

// Strip // and /* */ comments while leaving string literals intact, so a commented
// -out `applicationId` is not mistaken for the real one and a "http://..." inside a
// string is not truncated at the //. Quote-aware, one pass, no regex.
function stripComments(text: string): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"' || ch === "'") {
      out += ch;
      i++;
      while (i < text.length) {
        const c = text[i];
        out += c;
        i++;
        if (c === "\\" && i < text.length) {
          out += text[i];
          i++;
          continue;
        }
        if (c === ch) {
          break;
        }
      }
      continue;
    }
    if (ch === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") {
        i++;
      }
      continue;
    }
    if (ch === "/" && text[i + 1] === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) {
        i++;
      }
      i += 2;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

// Index of the `}` closing the `{` at `open`, or -1 when the file is truncated /
// unbalanced (a half-written gradle file mid-edit, which must not throw).
function matchBrace(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "{") {
      depth++;
    } else if (text[i] === "}") {
      depth--;
      if (depth === 0) {
        return i;
      }
    }
  }
  return -1;
}

// Body of the first `name { ... }` block in `text`, or undefined when absent. The
// leading boundary rules out a longer identifier ending in `name`.
function blockBody(text: string, name: string): string | undefined {
  const opener = new RegExp(`(^|[^\\w.])${name}\\s*\\{`, "m");
  const found = opener.exec(text);
  if (!found) {
    return undefined;
  }
  const open = text.indexOf("{", found.index);
  const close = matchBrace(text, open);
  return text.slice(open + 1, close === -1 ? text.length : close);
}

// The declared name of the block whose `{` follows `head`. Covers the Groovy form
// (`dev {`) and the Kotlin DSL forms (`create("dev") {`, `getByName("release") {`).
function blockNameBefore(head: string): string | undefined {
  const trimmed = head.replace(/\s+$/, "");
  const kts = /(?:create|register|getByName|maybeCreate)\s*\(\s*["']([^"']+)["']\s*\)$/.exec(
    trimmed
  );
  if (kts) {
    return kts[1];
  }
  const groovy = /([A-Za-z_][A-Za-z0-9_]*)\s*$/.exec(trimmed);
  return groovy ? groovy[1] : undefined;
}

// Every immediately-nested `name { ... }` block of a body, in source order. Nested
// blocks are skipped wholesale (the scan jumps past each closing brace), so a
// flavor's own inner blocks never read as sibling flavors.
function namedSubBlocks(body: string): Array<{ name: string; body: string }> {
  const blocks: Array<{ name: string; body: string }> = [];
  let i = 0;
  while (i < body.length) {
    if (body[i] !== "{") {
      i++;
      continue;
    }
    const close = matchBrace(body, i);
    const end = close === -1 ? body.length : close;
    const name = blockNameBefore(body.slice(0, i));
    if (name) {
      blocks.push({ name, body: body.slice(i + 1, end) });
    }
    i = end + 1;
  }
  return blocks;
}

// `applicationId "x"` / `applicationId = "x"`. The required quote after the
// optional `=` is what keeps `applicationIdSuffix` from matching here.
function readApplicationId(body: string): string | undefined {
  const found = /(^|[^\w.])applicationId\s*=?\s*["']([^"']*)["']/.exec(body);
  return found ? found[2] : undefined;
}

function readApplicationIdSuffix(body: string): string | undefined {
  const found = /(^|[^\w.])applicationIdSuffix\s*=?\s*["']([^"']*)["']/.exec(body);
  return found ? found[2] : undefined;
}

// A literal SDK level, accepting both the old (`minSdkVersion 21`) and new
// (`minSdk = 21`) spellings. Expressions like `flutter.minSdkVersion` deliberately
// do not match: reporting a wrong number would be worse than reporting none.
function readSdkLevel(body: string, name: "minSdk" | "targetSdk"): number | undefined {
  const found = new RegExp(`(^|[^\\w.])${name}(?:Version)?\\s*=?\\s*(\\d+)`).exec(body);
  return found ? Number(found[2]) : undefined;
}

// Application ids + SDK levels from an android/app/build.gradle(.kts).
//
// Shapes handled: the single-`applicationId` case (defaultConfig only), and the
// common flavorDimensions + `productFlavors { dev { applicationIdSuffix ".dev" } }`
// case, plus buildTypes, which carry suffixes just as often (`debug` →
// ".debug"). A variant may override applicationId outright or only suffix the
// defaultConfig one; both resolve to a ready-to-use id here. Anything else — an
// id built from a computed expression, flavors declared in a loop — yields no
// entry rather than a guess.
export function parseBuildGradle(text: string): {
  applicationIds: AndroidVariantId[];
  defaultApplicationId?: string;
  minSdk?: number;
  targetSdk?: number;
} {
  const source = stripComments(text ?? "");
  const android = blockBody(source, "android") ?? source;
  const defaultConfig = blockBody(android, "defaultConfig");
  // Fall back to the whole android block when there is no defaultConfig: some
  // files (and every malformed one) put the id at the top level.
  const base = defaultConfig ?? android;
  const defaultApplicationId = readApplicationId(base);
  const minSdk = readSdkLevel(base, "minSdk");
  const targetSdk = readSdkLevel(base, "targetSdk");

  const applicationIds: AndroidVariantId[] = [];
  const seen = new Set<string>();
  const push = (entry: AndroidVariantId): void => {
    if (seen.has(entry.variant)) {
      return;
    }
    seen.add(entry.variant);
    applicationIds.push(entry);
  };
  if (defaultApplicationId) {
    push({ variant: "default", applicationId: defaultApplicationId });
  }
  for (const container of ["productFlavors", "buildTypes"] as const) {
    const body = blockBody(android, container);
    if (!body) {
      continue;
    }
    for (const flavor of namedSubBlocks(body)) {
      const own = readApplicationId(flavor.body) ?? defaultApplicationId;
      if (!own) {
        continue;
      }
      const suffix = readApplicationIdSuffix(flavor.body);
      push({
        variant: flavor.name,
        applicationId: suffix ? `${own}${suffix}` : own,
        ...(suffix ? { suffix } : {}),
      });
    }
  }
  return {
    applicationIds,
    ...(defaultApplicationId ? { defaultApplicationId } : {}),
    ...(minSdk === undefined ? {} : { minSdk }),
    ...(targetSdk === undefined ? {} : { targetSdk }),
  };
}

// ---------------------------------------------------------------------------
// pubspec.yaml
// ---------------------------------------------------------------------------

// Dependency names and the Flutter signal from a pubspec.yaml. Indentation-based,
// not a YAML parse: top-level keys are the unindented `name:` lines, and a
// dependency is a key at the first indent level seen under dependencies /
// dev_dependencies (so a dependency's own `sdk:` / `version:` children, and list
// items, are not mistaken for packages).
export function parsePubspec(text: string): {
  dependencies: string[];
  isFlutterProject: boolean;
} {
  const names = new Set<string>();
  let hasFlutterKey = false;
  let section: "dependencies" | "dev_dependencies" | undefined;
  let childIndent: number | undefined;

  for (const raw of (text ?? "").split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, "");
    if (line === "" || /^\s*#/.test(line)) {
      continue;
    }
    const indent = line.length - line.replace(/^\s*/, "").length;
    const key = /^\s*([A-Za-z0-9_.\-]+)\s*:/.exec(line);
    if (indent === 0) {
      const topKey = key?.[1];
      hasFlutterKey = hasFlutterKey || topKey === "flutter";
      section =
        topKey === "dependencies" || topKey === "dev_dependencies" ? topKey : undefined;
      childIndent = undefined;
      continue;
    }
    if (!section || !key) {
      continue;
    }
    if (childIndent === undefined) {
      childIndent = indent;
    }
    if (indent === childIndent) {
      names.add(key[1]);
    }
  }

  return {
    dependencies: [...names].sort(),
    // A `flutter:` section is the primary signal; depending on the flutter SDK is
    // the same statement made in the dependency list, and a project can carry
    // either alone (a plugin package has the dependency, an app has both).
    isFlutterProject: hasFlutterKey || names.has("flutter"),
  };
}

// ---------------------------------------------------------------------------
// AndroidManifest.xml
// ---------------------------------------------------------------------------

function attr(tag: string, name: string): string | undefined {
  const found = new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`).exec(tag);
  return found ? found[1] : undefined;
}

// Permissions, deep links and exported activities from an AndroidManifest.xml.
// Attribute regexes rather than an XML parse — the file is machine-generated, the
// three things read here are flat attributes, and a malformed manifest must yield
// a partial answer instead of an exception.
export function parseAndroidManifest(text: string): {
  permissions: string[];
  deepLinks: AndroidDeepLink[];
  exportedActivities: string[];
} {
  const source = text ?? "";
  const permissions = new Set<string>();
  for (const tag of source.match(/<uses-permission(?:-sdk-\d+)?\b[^>]*>/g) ?? []) {
    const name = attr(tag, "android:name");
    if (name) {
      permissions.add(name);
    }
  }

  const exportedActivities = new Set<string>();
  for (const tag of source.match(/<activity(?:-alias)?\b[^>]*>/g) ?? []) {
    const name = attr(tag, "android:name");
    if (name && attr(tag, "android:exported") === "true") {
      exportedActivities.add(name);
    }
  }

  // Deep links are collected per <intent-filter>, because scheme and host may be
  // written on one <data> tag or split across several sibling tags. Tags carrying
  // both are taken as authored pairs; leftover schemes and hosts in the same
  // filter are combined, since that split form means "this scheme with these
  // hosts". A scheme with no host at all still yields an entry (custom-scheme
  // links have no authority).
  const links: AndroidDeepLink[] = [];
  const seen = new Set<string>();
  const add = (scheme: string, host: string): void => {
    const key = `${scheme}|${host}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    links.push({ scheme, host });
  };
  for (const filter of source.match(/<intent-filter\b[\s\S]*?<\/intent-filter>/g) ?? []) {
    const loneSchemes: string[] = [];
    const loneHosts: string[] = [];
    for (const tag of filter.match(/<data\b[^>]*>/g) ?? []) {
      const scheme = attr(tag, "android:scheme");
      const host = attr(tag, "android:host");
      if (scheme && host) {
        add(scheme, host);
      } else if (scheme) {
        loneSchemes.push(scheme);
      } else if (host) {
        loneHosts.push(host);
      }
    }
    for (const scheme of loneSchemes) {
      if (loneHosts.length === 0) {
        add(scheme, "");
        continue;
      }
      for (const host of loneHosts) {
        add(scheme, host);
      }
    }
  }

  return {
    permissions: [...permissions].sort(),
    deepLinks: links,
    exportedActivities: [...exportedActivities].sort(),
  };
}

// ---------------------------------------------------------------------------
// Profile assembly
// ---------------------------------------------------------------------------

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
