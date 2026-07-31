import { test } from "node:test";
import assert from "node:assert/strict";
import { toTitleCase, shortcutDisplayName } from "../model/shortcutDisplayName";
import { __setConfig, __resetConfig } from "./_stub/vscode";

// -- toTitleCase (pure, no vscode dependency) --------------------------------

test("toTitleCase: underscored filename with extension", () => {
  assert.equal(toTitleCase("setup_arb_translate.py"), "Setup Arb Translate");
});

test("toTitleCase: hyphenated filename", () => {
  assert.equal(toTitleCase("my-build-script.sh"), "My Build Script");
});

test("toTitleCase: mixed separators", () => {
  assert.equal(toTitleCase("run_tests-ci.bash"), "Run Tests Ci");
});

test("toTitleCase: no extension", () => {
  assert.equal(toTitleCase("makefile"), "Makefile");
});

test("toTitleCase: hidden file (leading dot) preserves dot-prefixed name", () => {
  assert.equal(toTitleCase(".gitignore"), ".gitignore");
});

test("toTitleCase: multi-dot filename strips only last extension", () => {
  assert.equal(toTitleCase("archive.tar.gz"), "Archive.tar");
});

test("toTitleCase: already spaced name", () => {
  assert.equal(toTitleCase("My File.txt"), "My File");
});

test("toTitleCase: consecutive separators collapse", () => {
  assert.equal(toTitleCase("a__b--c.ts"), "A B C");
});

test("toTitleCase: single character stem", () => {
  assert.equal(toTitleCase("x.js"), "X");
});

test("toTitleCase: empty string returns empty", () => {
  assert.equal(toTitleCase(""), "");
});

test("toTitleCase: trailing separator before extension", () => {
  assert.equal(toTitleCase("foo_.py"), "Foo");
});

test("toTitleCase: dotfile with real extension strips last segment", () => {
  assert.equal(toTitleCase(".env.local"), ".env");
});

// -- shortcutDisplayName (uses vscode config stub) ---------------------------

test("shortcutDisplayName: returns label when set", () => {
  const shortcut = { id: "s1", path: "src/foo_bar.ts", label: "Custom Name", scope: "project" as const, order: 0 };
  assert.equal(shortcutDisplayName(shortcut), "Custom Name");
});

test("shortcutDisplayName: returns basename when title case is off", () => {
  __resetConfig();
  const shortcut = { id: "s2", path: "src/foo_bar.ts", scope: "project" as const, order: 0 };
  assert.equal(shortcutDisplayName(shortcut), "foo_bar.ts");
});

test("shortcutDisplayName: returns title-cased basename when setting is on", () => {
  __resetConfig();
  __setConfig("saropaWorkspace", "displayNames.titleCase", true);
  const shortcut = { id: "s3", path: "src/setup_arb_translate.py", scope: "project" as const, order: 0 };
  assert.equal(shortcutDisplayName(shortcut), "Setup Arb Translate");
  __resetConfig();
});

test("shortcutDisplayName: label takes precedence even with title case on", () => {
  __resetConfig();
  __setConfig("saropaWorkspace", "displayNames.titleCase", true);
  const shortcut = { id: "s4", path: "src/foo.ts", label: "My Label", scope: "project" as const, order: 0 };
  assert.equal(shortcutDisplayName(shortcut), "My Label");
  __resetConfig();
});

test("shortcutDisplayName: path with no slashes uses full path as basename", () => {
  __resetConfig();
  const shortcut = { id: "s5", path: "standalone.txt", scope: "global" as const, order: 0 };
  assert.equal(shortcutDisplayName(shortcut), "standalone.txt");
});
