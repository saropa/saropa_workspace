// Unit tests for the script library manifest loader (loadScriptLibrary) and the
// launcher card builder (scriptLauncherItem). Both are pure functions with no
// VS Code dependency, so they run under Node's built-in test runner.

import { test } from "node:test";
import assert from "node:assert/strict";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { loadScriptLibrary, resolveScriptEntry } from "../model/scriptLibrary";
import { scriptLauncherItem } from "../views/launcherScriptItem";

// loadScriptLibrary reads a manifest from disk, so tests use a real temp dir
// with a crafted library.json. The l10n stub (../i18n/l10n.ts) returns the key
// verbatim under node:test, so labelKey/descriptionKey become the literal label
// and description.

function writeTempManifest(dir: string, content: string): string {
  const libDir = path.join(dir, "scripts", "library");
  fs.mkdirSync(libDir, { recursive: true });
  const manifestPath = path.join(libDir, "library.json");
  fs.writeFileSync(manifestPath, content, "utf-8");
  return dir;
}

test("loadScriptLibrary returns scripts from a valid manifest", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sl-"));
  try {
    const manifest = JSON.stringify({
      version: 1,
      scripts: [
        {
          id: "test-script",
          labelKey: "scripts.test.label",
          descriptionKey: "scripts.test.desc",
          icon: "beaker",
          tags: ["testing", "debug"],
          entry: "test-script/__main__.py",
          config: { command: "python" },
        },
      ],
    });
    writeTempManifest(tmp, manifest);
    const result = loadScriptLibrary(tmp);
    assert.equal(result.length, 1);
    assert.equal(result[0].id, "test-script");
    assert.equal(result[0].icon, "beaker");
    assert.deepEqual(result[0].tags, ["testing", "debug"]);
    assert.equal(result[0].entry, "test-script/__main__.py");
    assert.equal(result[0].config.command, "python");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("loadScriptLibrary returns empty array for missing manifest", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sl-"));
  try {
    const result = loadScriptLibrary(tmp);
    assert.equal(result.length, 0);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("loadScriptLibrary returns empty array for malformed JSON", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sl-"));
  try {
    writeTempManifest(tmp, "not valid json {{{");
    const result = loadScriptLibrary(tmp);
    assert.equal(result.length, 0);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("loadScriptLibrary skips entries missing required fields", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sl-"));
  try {
    const manifest = JSON.stringify({
      version: 1,
      scripts: [
        { id: "good", labelKey: "k", entry: "e", config: {} },
        { id: "no-entry", labelKey: "k", config: {} },
        { labelKey: "k", entry: "e", config: {} },
        { id: "no-config", labelKey: "k", entry: "e" },
      ],
    });
    writeTempManifest(tmp, manifest);
    const result = loadScriptLibrary(tmp);
    // Only the first entry has all required fields.
    assert.equal(result.length, 1);
    assert.equal(result[0].id, "good");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("resolveScriptEntry builds the correct absolute path", () => {
  const resolved = resolveScriptEntry("/ext", "my-script/__main__.py");
  const expected = path.join("/ext", "scripts", "library", "my-script/__main__.py");
  assert.equal(resolved, expected);
});

// scriptLauncherItem tests

test("scriptLauncherItem builds a card with pane scripts and headAction run", () => {
  const card = scriptLauncherItem({
    id: "organize-output",
    label: "Organize output folder",
    description: "Sorts files into dated subfolders.",
    icon: "folder-library",
    tags: ["cleanup", "reports"],
  });
  assert.equal(card.id, "library:organize-output");
  assert.equal(card.pane, "scripts");
  assert.equal(card.runnable, true);
  assert.equal(card.openable, false);
  assert.equal(card.headAction, "run");
  assert.equal(card.copyable, false);
  assert.equal(card.label, "Organize output folder");
  assert.equal(card.sub, "cleanup, reports");
  assert.equal(card.icon, "folder-library");
  assert.equal(card.kind, "script");
  assert.equal(card.groupId, "scripts");
  assert.deepEqual(card.menu, []);
});
