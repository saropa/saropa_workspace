// Tests for the project-file constants and the configurable config-folder name.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as vscode from "vscode";
import {
  DEFAULT_SET_NAME,
  KNOWN_CONFIG_DIRS,
  LEGACY_PROJECT_FILE_RELATIVE,
  PROJECT_FILE_RELATIVE,
  PROJECT_SHORTCUTS_VERSION,
  configDirName,
  configuredProjectFileRelative,
  emptyProjectShortcutsFile,
} from "../model/shortcutFile";

type StubVscode = typeof vscode & {
  __setConfig(section: string, key: string, value: unknown): void;
  __resetConfig(): void;
};
const stub = vscode as StubVscode;

beforeEach(() => stub.__resetConfig());
afterEach(() => stub.__resetConfig());

test("the default and legacy file locations are fixed", () => {
  assert.equal(PROJECT_FILE_RELATIVE, ".saropa/saropa-workspace.json");
  assert.equal(LEGACY_PROJECT_FILE_RELATIVE, ".vscode/saropa-workspace.json");
  assert.deepEqual([...KNOWN_CONFIG_DIRS], [".saropa", ".vscode"]);
});

test("an empty file carries the current version, the default set and no content", () => {
  assert.deepEqual(emptyProjectShortcutsFile(), {
    version: PROJECT_SHORTCUTS_VERSION,
    pins: [],
    groups: [],
    activeSet: DEFAULT_SET_NAME,
    sets: [],
    removedAutoPins: [],
    removedRecipes: [],
    autoGroups: {},
  });
  assert.equal(PROJECT_SHORTCUTS_VERSION, 3);
  assert.equal(DEFAULT_SET_NAME, "Default");
});

test("each empty file is independent, so editing one never leaks into the next", () => {
  const a = emptyProjectShortcutsFile();
  a.pins.push({ id: "x" } as never);
  a.autoGroups.k = "g";
  const b = emptyProjectShortcutsFile();
  assert.deepEqual(b.pins, []);
  assert.deepEqual(b.autoGroups, {});
});

test("the config folder defaults to .saropa", () => {
  assert.equal(configDirName(), ".saropa");
  assert.equal(configuredProjectFileRelative(), ".saropa/saropa-workspace.json");
});

test("a configured folder name is trimmed and used in the file path", () => {
  stub.__setConfig("saropaWorkspace", "configDir", "  .team  ");
  assert.equal(configDirName(), ".team");
  assert.equal(configuredProjectFileRelative(), ".team/saropa-workspace.json");
});

test("a blank folder name falls back to .saropa", () => {
  stub.__setConfig("saropaWorkspace", "configDir", "   ");
  assert.equal(configDirName(), ".saropa");
});
