// Guards the declared default for the "aiContext.enabled" setting (#87). The AI
// context recipes (recipes/aiContextRecipes.ts) only detect/surface prompt-history
// folders when this setting is opted into, so an accidental flip of the manifest
// default to `true` would silently start scanning a workspace's chat-history
// folders for every user on upgrade, with no opt-in action on their part. Reading
// the manifest as JSON (rather than importing the runtime config reader) pins the
// exact declared value shipped in the .vsix, independent of any getConfiguration()
// default-fallback logic in code.

import { test } from "node:test";
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";

// Paths resolve from the bundle location (out/test) up to the extension root, so
// the test does not depend on the runner's working directory (same convention as
// menuStructure.test.ts).
const extensionRoot = path.join(__dirname, "..", "..");

interface ConfigurationProperty {
  type?: string;
  default?: unknown;
  description?: string;
}

interface ConfigurationSection {
  properties?: Record<string, ConfigurationProperty>;
}

interface Manifest {
  contributes?: {
    // VS Code allows either a single configuration object or an array of sections;
    // this manifest uses the array form, so the test searches every section rather
    // than assuming one.
    configuration?: ConfigurationSection | ConfigurationSection[];
  };
}

function readManifest(): Manifest {
  return JSON.parse(
    fs.readFileSync(path.join(extensionRoot, "package.json"), "utf8")
  ) as Manifest;
}

// Finds a "saropaWorkspace.<key>" configuration property across every declared
// configuration section (the manifest may split settings into themed sections).
function findConfigProperty(manifest: Manifest, key: string): ConfigurationProperty | undefined {
  const raw = manifest.contributes?.configuration;
  const sections = Array.isArray(raw) ? raw : raw ? [raw] : [];
  for (const section of sections) {
    const hit = section.properties?.[key];
    if (hit) {
      return hit;
    }
  }
  return undefined;
}

test("aiContext.enabled is declared as a boolean defaulting to false", () => {
  const property = findConfigProperty(readManifest(), "saropaWorkspace.aiContext.enabled");
  assert.ok(property, "saropaWorkspace.aiContext.enabled is not declared in package.json");
  assert.equal(property?.type, "boolean");
  // The load-bearing assertion: this setting must ship opt-in (false), never
  // opt-out, so an upgrade never starts scanning a workspace's chat-history
  // folders without the user explicitly turning it on.
  assert.strictEqual(property?.default, false);
});
