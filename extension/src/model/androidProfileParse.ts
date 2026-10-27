import { AndroidVariantId, AndroidDeepLink } from "./androidProfileTypes";
// Pure text parsers for the Android project profile: Gradle, pubspec and the
// manifest. No VS Code access; unit-tested directly. Split out of androidProjectProfile.ts.

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
